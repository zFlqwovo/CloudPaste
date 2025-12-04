/**
 * StorageStreaming - 统一的存储内容访问层
 *
 * - 作为所有内容访问路径的唯一入口（FS/WebDAV/Proxy/Share/Object/Preview）
 * - 调用驱动获取 StorageStreamDescriptor
 * - 处理 Range/条件请求
 * - 返回 RangeReader 供协议层构造 HTTP 响应
 * - 驱动层不再构造 HTTP Response
 * - Node/Worker 运行时差异在此层处理
 * - 统一的错误映射和日志
 */

import { parseRangeHeader, evaluateConditionalHeaders, buildResponseHeaders, mapDriverErrorToHttpStatus } from "./utils.js";
import { STREAMING_CHANNELS } from "./types.js";
import { NotFoundError, DriverError } from "../../http/errors.js";
import { ApiStatus } from "../../constants/index.js";

/**
 * @typedef {import('./types.js').StorageStreamDescriptor} StorageStreamDescriptor
 * @typedef {import('./types.js').RangeReader} RangeReader
 * @typedef {import('./types.js').RangeReaderOptions} RangeReaderOptions
 * @typedef {import('./types.js').StreamHandle} StreamHandle
 */

export class StorageStreaming {
  /**
   * @param {Object} options
   * @param {Object} options.mountManager - MountManager 实例
   * @param {Object} options.storageFactory - StorageFactory 类
   * @param {string} options.encryptionSecret - 加密密钥
   */
  constructor({ mountManager, storageFactory, encryptionSecret }) {
    this.mountManager = mountManager;
    this.storageFactory = storageFactory;
    this.encryptionSecret = encryptionSecret;
  }

  /**
   * 获取 RangeReader（主入口）
   * @param {RangeReaderOptions} options
   * @returns {Promise<RangeReader>}
   */
  async getRangeReader(options) {
    const { path, channel, mount, storageConfigId, rangeHeader, request, userIdOrInfo, userType, db } = options;

    const logPrefix = `[StorageStreaming][${channel}]`;
    console.log(`${logPrefix} 开始处理: ${path}`);

    try {
      // 1. 解析路径到驱动
      const { driver, resolvedMount, subPath } = await this._resolveDriver(options);

      // 2. 获取 StorageStreamDescriptor
      const downloadResult = await driver.downloadFile(path, {
        mount: resolvedMount,
        subPath,
        db,
        request,
        userIdOrInfo,
        userType,
      });

      // 验证返回结构
      /** @type {StorageStreamDescriptor} */
      const descriptor = this._adaptToDescriptor(downloadResult);

      // 3. 评估条件请求
      const { shouldReturn304, shouldReturn412 } = evaluateConditionalHeaders(request, descriptor.etag, descriptor.lastModified);

      if (shouldReturn304) {
        console.log(`${logPrefix} 返回 304 Not Modified`);
        return this._create304Reader(descriptor, channel);
      }

      if (shouldReturn412) {
        console.log(`${logPrefix} 返回 412 Precondition Failed`);
        return this._create412Reader(descriptor, channel);
      }

      // 4. 解析 Range 请求
      const range = parseRangeHeader(rangeHeader, descriptor.size);

      if (range && !range.isValid) {
        console.log(`${logPrefix} Range 格式无效`);
        return this._create200Reader(descriptor, channel);
      }

      if (range && !range.isSatisfiable) {
        console.log(`${logPrefix} 返回 416 Range Not Satisfiable`);
        return this._create416Reader(descriptor, channel);
      }

      if (range && range.isSatisfiable) {
        console.log(`${logPrefix} 返回 206 Partial Content: ${range.start}-${range.end}`);
        return this._create206Reader(descriptor, range, channel);
      }

      // 5. 正常 200 响应
      console.log(`${logPrefix} 返回 200 OK`);
      return this._create200Reader(descriptor, channel);
    } catch (error) {
      console.error(`${logPrefix} 错误:`, error?.message || error);
      throw error;
    }
  }

  /**
   * 便捷方法：直接构造 HTTP Response
   * @param {RangeReaderOptions} options
   * @returns {Promise<Response>}
   */
  async createResponse(options) {
    try {
      const reader = await this.getRangeReader(options);
      const { status, headers } = reader;

      // 304/412 无响应体
      if (status === 304 || status === 412 || status === 416) {
        return new Response(null, { status, headers });
      }

      const handle = await reader.getBody();
      if (!handle) {
        return new Response(null, { status, headers });
      }

      const { stream } = handle;

      // 对于 WebReadableStream（有 getReader 方法），直接作为 Response body 交给运行时处理
      if (stream && typeof stream.getReader === "function") {
        return new Response(stream, { status, headers });
      }

      // 对于 Node Readable（本地存储等场景），在 Node 环境存在 WebStreams 桥接 bug，
      // 这里采用一次性缓冲到内存的方式构造 Response，避免 ReadableStream 已关闭异常。
      if (stream && typeof stream[Symbol.asyncIterator] === "function") {
        const chunks = [];
        for await (const chunk of stream) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        const body = Buffer.concat(chunks);
        return new Response(body, { status, headers });
      }

      // 兜底：未知类型，直接交给 Response 处理
      return new Response(stream, { status, headers });
    } catch (error) {
      // 统一将驱动/流层错误映射为标准 HTTP 响应，便于前端获取 code/message
      const { status, message } = mapDriverErrorToHttpStatus(error);
      const code = error?.code || "STREAMING_ERROR";

      const body = JSON.stringify({
        success: false,
        code,
        message,
      });

      const headers = new Headers();
      headers.set("Content-Type", "application/json; charset=utf-8");

      return new Response(body, { status, headers });
    }
  }

  /**
   * 验证驱动返回的 StorageStreamDescriptor 结构
   * @param {any} result - 驱动返回的结果
   * @returns {import('./types.js').StorageStreamDescriptor}
   * @private
   */
  _adaptToDescriptor(result) {
    // 验证是否为有效的 StorageStreamDescriptor
    if (typeof result?.getStream === "function") {
      return result;
    }

    // 无法识别的结构，抛出错误
    throw new DriverError("驱动返回了无效的 StorageStreamDescriptor 结构，缺少 getStream 方法", {
      status: ApiStatus.INTERNAL_ERROR,
      code: "STREAMING_ERROR.INVALID_DOWNLOAD_RESULT",
    });
  }

  /**
   * 解析路径到驱动
   * @private
   */
  async _resolveDriver(options) {
    const { path, mount, storageConfigId, userIdOrInfo, userType, db, repositoryFactory } = options;

    // 如果提供了 storageConfigId，通过存储配置创建驱动（存储路径模式）
    if (storageConfigId && db) {
      // 获取存储配置
      const storageConfigRepo = repositoryFactory?.getStorageConfigRepository?.();
      let storageConfig = null;

      if (storageConfigRepo?.findByIdWithSecrets) {
        storageConfig = await storageConfigRepo.findByIdWithSecrets(storageConfigId);
      } else if (storageConfigRepo?.findById) {
        storageConfig = await storageConfigRepo.findById(storageConfigId);
      }

      if (!storageConfig) {
        throw new NotFoundError("存储配置不存在");
      }

      if (!storageConfig.storage_type) {
        throw new DriverError("存储配置缺少 storage_type", {
          status: ApiStatus.INTERNAL_ERROR,
          code: "STREAMING_ERROR.INVALID_CONFIG",
        });
      }

      // 使用 StorageFactory 创建驱动
      const { StorageFactory } = await import("../factory/StorageFactory.js");
      const driver = await StorageFactory.createDriver(storageConfig.storage_type, storageConfig, this.encryptionSecret);
      return { driver, resolvedMount: null, subPath: path };
    }

    // 否则通过 MountManager 解析（FS 路径模式）
    if (this.mountManager) {
      const { driver, mount: resolvedMount, subPath } = await this.mountManager.getDriverByPath(path, userIdOrInfo, userType);
      return { driver, resolvedMount, subPath };
    }

    throw new DriverError("无法解析存储路径：缺少 mountManager 或 storageConfigId", {
      status: ApiStatus.INTERNAL_ERROR,
      code: "STREAMING_ERROR.NO_RESOLVER",
    });
  }

  /**
   * 创建 200 OK RangeReader
   * @private
   */
  _create200Reader(descriptor, channel) {
    const headers = buildResponseHeaders(descriptor, null, channel);
    let streamHandle = null;
    let closed = false;

    return {
      status: 200,
      headers,
      async getBody() {
        if (closed) return null;
        streamHandle = await descriptor.getStream();
        return streamHandle;
      },
      async close() {
        if (closed) return;
        closed = true;
        if (streamHandle) {
          await streamHandle.close();
        }
      },
    };
  }

  /**
   * 创建 206 Partial Content RangeReader
   * @private
   */
  _create206Reader(descriptor, range, channel) {
    const headers = buildResponseHeaders(descriptor, range, channel);
    let streamHandle = null;
    let closed = false;

    return {
      status: 206,
      headers,
      async getBody() {
        if (closed) return null;

        // 优先使用驱动原生 Range 支持
        if (typeof descriptor.getRange === "function") {
          streamHandle = await descriptor.getRange(range);
        } else {
          // 降级：读取完整流并跳过/限制字节
          // 注意：这对大文件效率较低，但保证兼容性
          streamHandle = await descriptor.getStream();
          // TODO: 实现流的 skip/limit 包装
          console.warn("[StorageStreaming] 驱动不支持原生 Range，使用完整流");
        }
        return streamHandle;
      },
      async close() {
        if (closed) return;
        closed = true;
        if (streamHandle) {
          await streamHandle.close();
        }
      },
    };
  }

  /**
   * 创建 304 Not Modified RangeReader
   * @private
   */
  _create304Reader(descriptor, channel) {
    const headers = new Headers();
    if (descriptor.etag) headers.set("ETag", descriptor.etag);
    if (descriptor.lastModified) headers.set("Last-Modified", descriptor.lastModified.toUTCString());

    return {
      status: 304,
      headers,
      async getBody() {
        return null;
      },
      async close() {},
    };
  }

  /**
   * 创建 412 Precondition Failed RangeReader
   * @private
   */
  _create412Reader(descriptor, channel) {
    const headers = new Headers();
    if (descriptor.etag) headers.set("ETag", descriptor.etag);
    if (descriptor.lastModified) headers.set("Last-Modified", descriptor.lastModified.toUTCString());

    return {
      status: 412,
      headers,
      async getBody() {
        return null;
      },
      async close() {},
    };
  }

  /**
   * 创建 416 Range Not Satisfiable RangeReader
   * @private
   */
  _create416Reader(descriptor, channel) {
    const headers = new Headers();
    if (descriptor.size !== null) {
      headers.set("Content-Range", `bytes */${descriptor.size}`);
    }

    return {
      status: 416,
      headers,
      async getBody() {
        return null;
      },
      async close() {},
    };
  }
}

export { STREAMING_CHANNELS };
