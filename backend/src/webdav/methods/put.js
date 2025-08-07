/**
 * 处理WebDAV PUT请求
 * 用于上传文件内容
 */
import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { getMimeTypeFromFilename } from "../../utils/fileUtils.js";
import { handleWebDAVError } from "../utils/errorUtils.js";
import { clearDirectoryCache } from "../../cache/index.js";
import { concatUint8Arrays } from "uint8array-extras";
import { getLockManager } from "../utils/LockManager.js";
import { checkLockPermission } from "../utils/lockUtils.js";

// 分片上传阈值，设为5MB以符合S3对分片的最小大小要求
const MULTIPART_THRESHOLD = 5 * 1024 * 1024; // 5MB

// 上传分片重试配置
const MAX_RETRIES = 3; // 最大重试次数
const RETRY_DELAY_BASE = 1000; // 基础重试延迟（毫秒）

// 日志上传进度的间隔（字节）
const PROGRESS_LOG_INTERVAL = 20 * 1024 * 1024; // 每20MB记录一次进度

/**
 * 识别客户端类型
 * @param {Object} c - Hono上下文
 * @returns {Object} 包含客户端类型信息的对象
 */
function identifyClient(c) {
  const userAgent = c.req.header("User-Agent") || "";

  // 客户端类型识别
  const isWindowsClient = userAgent.includes("Microsoft") || userAgent.includes("Windows");
  const isRaiDriveClient = userAgent.includes("RaiDrive") || userAgent.includes("WebDAV Drive");
  const isMacClient = userAgent.includes("Darwin") || userAgent.includes("Mac");

  // 特定客户端类型标识
  const isWindowsExplorerClient = isWindowsClient && (userAgent.includes("Microsoft-WebDAV-MiniRedir") || userAgent.includes("Explorer"));

  // 检测是否使用Chunked传输编码的客户端
  const isChunkedClient = c.req.header("Transfer-Encoding")?.toLowerCase().includes("chunked") || false;

  return {
    isWindowsClient,
    isRaiDriveClient,
    isMacClient,
    isWindowsExplorerClient,
    // 是否为可能导致0KB文件问题的客户端类型
    isPotentiallyProblematicClient: isWindowsClient || isRaiDriveClient,
    // 是否为使用分块传输的客户端
    isChunkedClient,
    userAgent,
  };
}

/**
 * 合并两个Uint8Array（使用优化的库函数）
 * @param {Uint8Array} arr1 - 第一个数组
 * @param {Uint8Array} arr2 - 第二个数组
 * @returns {Uint8Array} 合并后的数组
 */
function mergeUint8Arrays(arr1, arr2) {
  return concatUint8Arrays([arr1, arr2]);
}

/**
 * 确保数据是ArrayBuffer格式（简化版本）
 * @param {any} data - 输入数据
 * @returns {ArrayBuffer} ArrayBuffer格式的数据
 */
function ensureArrayBuffer(data) {
  if (data instanceof ArrayBuffer) {
    return data;
  }
  if (data instanceof Uint8Array) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  throw new Error("数据必须是ArrayBuffer或Uint8Array格式");
}

/**
 * 检查文件大小差异是否可接受
 * @param {number} actualSize - 实际大小
 * @param {number} declaredSize - 声明大小
 * @returns {boolean} 是否可接受
 */
function checkSizeDifference(actualSize, declaredSize) {
  const difference = Math.abs(actualSize - declaredSize);
  const percentageDiff = (difference / declaredSize) * 100;

  // 允许5%的差异或者最多1MB的差异
  return percentageDiff <= 5 || difference <= 1024 * 1024;
}

/**
 * 带重试机制的分片上传
 * @param {D1Database} db - 数据库实例
 * @param {string} path - 文件路径
 * @param {string} uploadId - 上传ID
 * @param {number} partNumber - 分片编号
 * @param {ArrayBuffer} partData - 分片数据
 * @param {string|Object} userIdOrInfo - 用户ID或信息
 * @param {string} userType - 用户类型
 * @param {string} encryptionSecret - 加密密钥
 * @param {string} s3Key - S3键
 * @param {FileSystem} fileSystem - 文件系统实例
 * @param {number} maxRetries - 最大重试次数
 * @returns {Promise<Object>} 上传结果
 */
async function uploadPartWithRetry(db, path, uploadId, partNumber, partData, userIdOrInfo, userType, encryptionSecret, s3Key, fileSystem, maxRetries = MAX_RETRIES) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 确保partData是有效的ArrayBuffer
      const validData = ensureArrayBuffer(partData);

      return await fileSystem.uploadBackendPart(path, userIdOrInfo, userType, uploadId, partNumber, validData, s3Key);
    } catch (error) {
      lastError = error;
      console.warn(`WebDAV PUT - 分片 #${partNumber} 上传失败 (尝试 ${attempt}/${maxRetries}): ${error.message}`);

      if (attempt < maxRetries) {
        // 指数退避策略 (1秒, 2秒, 4秒...)
        const delayMs = RETRY_DELAY_BASE * Math.pow(2, attempt - 1);
        console.log(`WebDAV PUT - 等待 ${delayMs}ms 后重试...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  // 所有重试都失败，抛出最后一个错误
  console.error(`WebDAV PUT - 分片 #${partNumber} 在 ${maxRetries} 次尝试后仍然失败`);
  throw lastError;
}

/**
 * 分片上传
 * - 达到5MB立即上传
 * - 内存安全检查：MAX_BUFFER_SIZE防止Worker内存溢出
 * - 强制上传机制：超过阈值时强制上传，确保内存可控
 * - 除最后分片外，所有分片≥5MB
 *
 * @param {ReadableStream} stream - 输入流
 * @param {number} partSize - 分片大小（通常5MB）
 * @param {Function} uploadPartCallback - 上传分片的回调函数
 * @param {Object} options - 选项参数
 * @returns {Promise<{parts: Array, totalProcessed: number}>} 处理结果
 */
async function streamingMultipartUpload(stream, partSize, uploadPartCallback, options = {}) {
  const { isSpecialClient = false, contentLength = 0 } = options;

  // 内存安全配置
  const MAX_BUFFER_SIZE = Math.max(partSize * 2, 10 * 1024 * 1024); // 最大缓冲：2个分片大小或10MB
  const FORCE_UPLOAD_THRESHOLD = Math.max(partSize * 1.5, 8 * 1024 * 1024); // 强制上传阈值

  const reader = stream.getReader();
  const parts = [];
  let partNumber = 1;
  let currentChunk = new Uint8Array(0);
  let totalProcessed = 0;
  let lastProgressLog = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // 处理剩余的数据（最后一个分片可以小于5MB）
        if (currentChunk.length > 0) {
          console.log(`WebDAV PUT - 处理最后分片 #${partNumber}，大小: ${(currentChunk.length / (1024 * 1024)).toFixed(2)}MB`);

          const partResult = await uploadPartCallback(partNumber, currentChunk.buffer);
          parts.push(partResult);
          totalProcessed += currentChunk.length;
        }
        break;
      }

      // 合并当前chunk和新数据
      currentChunk = mergeUint8Arrays(currentChunk, new Uint8Array(value));

      // 达到标准分片大小立即上传
      while (currentChunk.length >= partSize) {
        const partData = currentChunk.slice(0, partSize);
        currentChunk = currentChunk.slice(partSize);

        console.log(`WebDAV PUT - 立即上传分片 #${partNumber}，大小: ${(partData.length / (1024 * 1024)).toFixed(2)}MB`);

        //记录分片上传时间
        const partStartTime = Date.now();
        const partResult = await uploadPartCallback(partNumber, partData.buffer);
        const partDuration = Date.now() - partStartTime;
        const partSpeedMBps = (partData.length / 1024 / 1024 / (partDuration / 1000)).toFixed(2);

        console.log(`WebDAV PUT - 分片 #${partNumber} 上传完成，用时: ${partDuration}ms，速度: ${partSpeedMBps}MB/s`);

        parts.push(partResult);
        totalProcessed += partData.length;
        partNumber++;

        // 记录进度（每20MB记录一次）
        if (totalProcessed - lastProgressLog >= PROGRESS_LOG_INTERVAL) {
          const progressMB = (totalProcessed / (1024 * 1024)).toFixed(2);
          const totalMB = contentLength > 0 ? (contentLength / (1024 * 1024)).toFixed(2) : "未知";
          console.log(`WebDAV PUT - 上传进度: ${progressMB}MB / ${totalMB}MB`);
          lastProgressLog = totalProcessed;
        }
      }

      //防止缓冲区过大导致Worker内存溢出
      if (currentChunk.length >= FORCE_UPLOAD_THRESHOLD) {
        console.warn(`WebDAV PUT - 内存安全触发：缓冲区达到${(currentChunk.length / (1024 * 1024)).toFixed(2)}MB，强制上传分片 #${partNumber}`);

        const partData = currentChunk;
        currentChunk = new Uint8Array(0);

        const partResult = await uploadPartCallback(partNumber, partData.buffer);
        parts.push(partResult);
        totalProcessed += partData.length;
        partNumber++;
      }

      // 不能超过最大缓冲区大小
      if (currentChunk.length >= MAX_BUFFER_SIZE) {
        console.error(`WebDAV PUT - 极限安全触发：缓冲区达到${(currentChunk.length / (1024 * 1024)).toFixed(2)}MB，立即强制上传`);

        const partData = currentChunk;
        currentChunk = new Uint8Array(0);

        const partResult = await uploadPartCallback(partNumber, partData.buffer);
        parts.push(partResult);
        totalProcessed += partData.length;
        partNumber++;
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { parts, totalProcessed };
}

/**
 * 主流实现风格的分片上传管理器
 * 提供完整的multipart upload生命周期管理，包括错误恢复
 * @param {ReadableStream} stream - 输入流
 * @param {Object} uploadContext - 上传上下文
 * @param {FileSystem} fileSystem - 文件系统实例
 * @param {Object} options - 选项参数
 * @returns {Promise<Object>} 上传结果
 */
async function managedMultipartUpload(stream, uploadContext, fileSystem, options = {}) {
  const { path, userId, userType, uploadId, s3Key, recommendedPartSize } = uploadContext;
  const { db, encryptionSecret, contentLength = 0 } = options;

  let abortCalled = false;

  try {
    // 创建优化的上传回调函数
    const uploadPartCallback = async (partNumber, partData) => {
      return await uploadPartWithRetry(db, path, uploadId, partNumber, partData, userId, userType, encryptionSecret, s3Key, fileSystem);
    };
    const streamStartTime = Date.now();
    const { parts, totalProcessed } = await streamingMultipartUpload(stream, recommendedPartSize, uploadPartCallback, {
      contentLength,
      ...options,
    });
    const streamDuration = Date.now() - streamStartTime;

    // 完成multipart upload
    console.log(`WebDAV PUT - 流式上传完成，共${parts.length}个分片，总大小: ${(totalProcessed / (1024 * 1024)).toFixed(2)}MB，用时: ${streamDuration}ms`);

    // 检查是否有分片上传 - 处理0字节文件的特殊情况
    if (parts.length === 0) {
      console.log(`WebDAV PUT - 检测到0字节文件，取消分片上传并使用直接上传`);

      // 取消分片上传
      try {
        await fileSystem.abortBackendMultipartUpload(path, userId, userType, uploadId, s3Key);
        console.log(`WebDAV PUT - 已取消分片上传`);
      } catch (abortError) {
        console.warn(`WebDAV PUT - 取消分片上传失败: ${abortError.message}`);
      }

      // 使用直接上传创建空文件
      const filename = path.split("/").pop();
      const contentType = options.contentType || "application/octet-stream";
      const emptyFile = new File([""], filename, { type: contentType });
      const result = await fileSystem.uploadFile(path, emptyFile, userId, userType, {
        useMultipart: false,
      });

      return {
        success: true,
        result,
        totalProcessed: 0,
        partCount: 0,
      };
    }

    const result = await fileSystem.completeBackendMultipartUpload(path, userId, userType, uploadId, parts, s3Key);

    return {
      success: true,
      result,
      totalProcessed,
      partCount: parts.length,
    };
  } catch (error) {
    // 错误处理：自动abort multipart upload
    if (!abortCalled) {
      abortCalled = true;
      try {
        console.warn(`WebDAV PUT - 分片上传失败，正在清理multipart upload: ${error.message}`);
        await fileSystem.abortBackendMultipartUpload(path, userId, userType, uploadId, s3Key);
        console.log(`WebDAV PUT - multipart upload已成功清理`);
      } catch (abortError) {
        console.error(`WebDAV PUT - 清理multipart upload失败: ${abortError.message}`);
      }
    }

    throw error;
  }
}

/**
 * 处理PUT请求
 * @param {Object} c - Hono上下文
 * @param {string} path - 请求路径
 * @param {string} userId - 用户ID
 * @param {string} userType - 用户类型 (admin 或 apiKey)
 * @param {D1Database} db - D1数据库实例
 */
export async function handlePut(c, path, userId, userType, db) {
  const requestStartTime = Date.now();

  try {
    console.log(`WebDAV PUT请求: 路径 ${path}, 用户类型: ${userType}`);

    // 获取锁定管理器实例
    const lockManager = getLockManager();

    // 检查锁定状态
    const ifHeader = c.req.header("If");
    const lockConflict = checkLockPermission(lockManager, path, ifHeader, "PUT");
    if (lockConflict) {
      console.log(`WebDAV PUT - 锁定冲突: ${path}`);
      return new Response(lockConflict.message, {
        status: lockConflict.status,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // 识别客户端类型
    const clientInfo = identifyClient(c);
    console.log(`WebDAV PUT - 客户端信息: ${JSON.stringify(clientInfo)}`);

    // 获取请求头信息
    const contentLength = c.req.header("Content-Length");
    const transferEncoding = c.req.header("Transfer-Encoding");
    const isChunked = transferEncoding && transferEncoding.toLowerCase().includes("chunked");

    // 正确检查是否为空文件
    let declaredContentLength = 0;
    let emptyBodyCheck = false;

    if (contentLength !== undefined) {
      // 有Content-Length头，使用明确的长度
      declaredContentLength = parseInt(contentLength, 10);
      emptyBodyCheck = declaredContentLength === 0;
    } else if (isChunked) {
      // Chunked传输，长度未知，不是空文件
      declaredContentLength = -1; // 表示未知长度
      emptyBodyCheck = false;
    } else {
      // 既没有Content-Length也没有chunked，可能是空文件或错误请求
      declaredContentLength = 0;
      emptyBodyCheck = true;
    }

    console.log(
      `WebDAV PUT - Content-Length: ${contentLength}, Transfer-Encoding: ${transferEncoding}, 是否chunked: ${isChunked}, 声明大小: ${declaredContentLength}字节, 空文件检查: ${emptyBodyCheck}`
    );

    // 从路径中提取文件名
    const filename = path.split("/").pop();

    // 获取请求内容类型
    let contentType = c.req.header("Content-Type") || "application/octet-stream";

    // 如果Content-Type包含字符集，移除它
    if (contentType && contentType.includes(";")) {
      contentType = contentType.split(";")[0].trim();
    }

    // 统一从文件名推断MIME类型，不依赖客户端提供的Content-Type
    contentType = getMimeTypeFromFilename(filename);
    console.log(`WebDAV PUT - 从文件名[${filename}]推断MIME类型: ${contentType}`);

    // 创建FileSystem实例
    const mountManager = new MountManager(db, c.env.ENCRYPTION_SECRET);
    const fileSystem = new FileSystem(mountManager);

    // 获取系统设置中的WebDAV上传模式
    let webdavUploadMode = "direct"; // 默认为直接上传模式
    try {
      // 使用Repository查询系统设置
      const { RepositoryFactory } = await import("../../repositories/index.js");
      const repositoryFactory = new RepositoryFactory(db);
      const systemRepository = repositoryFactory.getSystemRepository();

      const uploadModeSetting = await systemRepository.getSettingMetadata("webdav_upload_mode");
      if (uploadModeSetting && uploadModeSetting.value) {
        webdavUploadMode = uploadModeSetting.value;
      }
    } catch (error) {
      console.warn(`WebDAV PUT - 获取上传模式设置失败，使用默认模式:`, error);
    }

    console.log(`WebDAV PUT - 当前上传模式设置: ${webdavUploadMode}`);

    // 根据系统设置决定使用哪种上传模式
    // 判断是否应该使用直接上传模式：
    // 如果设置为'direct'，则使用直接上传模式，否则使用分片上传模式
    // 注意：空文件已经有专门的处理逻辑
    const shouldUseDirect = webdavUploadMode === "direct";

    // 处理空文件的情况
    if (emptyBodyCheck) {
      console.log(`WebDAV PUT - 检测到0字节文件，使用FileSystem直接上传`);

      // 创建一个空的File对象
      const emptyFile = new File([""], filename, { type: contentType });

      // 使用FileSystem上传空文件
      const result = await fileSystem.uploadFile(path, emptyFile, userId, userType, {
        useMultipart: false,
      });

      // 清理缓存
      const { mount } = await mountManager.getDriverByPath(path, userId, userType);
      if (mount) {
        await clearDirectoryCache({ mountId: mount.id });
      }

      console.log(`WebDAV PUT - 空文件上传成功: ${JSON.stringify(result)}`);

      // 返回成功响应
      return new Response(null, {
        status: 201, // Created
        headers: {
          "Content-Type": "text/plain",
          "Content-Length": "0",
        },
      });
    }

    // 直接上传模式
    if (shouldUseDirect) {
      console.log(`WebDAV PUT - 使用直接上传模式`);

      try {
        // 读取请求体
        const bodyStream = c.req.body;
        if (!bodyStream) {
          return new Response("请求体不可用", {
            status: 400,
            headers: { "Content-Type": "text/plain" },
          });
        }

        // 读取所有数据
        const reader = bodyStream.getReader();
        const chunks = [];
        let bytesRead = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          bytesRead += value.length;
        }

        // 合并所有数据块
        const fileData = new Uint8Array(bytesRead);
        let offset = 0;
        for (const chunk of chunks) {
          fileData.set(chunk, offset);
          offset += chunk.length;
        }

        console.log(`WebDAV PUT - 开始直接上传 ${bytesRead} 字节到FileSystem`);

        // 创建File对象
        const file = new File([fileData], filename, { type: contentType });

        // 使用FileSystem直接上传
        const result = await fileSystem.uploadFile(path, file, userId, userType, {
          useMultipart: false,
        });

        // 清理缓存
        const { mount } = await mountManager.getDriverByPath(path, userId, userType);
        if (mount) {
          await clearDirectoryCache({ mountId: mount.id });
        }

        const uploadDuration = Math.ceil((Date.now() - requestStartTime) / 1000);
        const uploadSpeedMBps = (bytesRead / 1024 / 1024 / uploadDuration).toFixed(2);

        console.log(`WebDAV PUT - 直接上传成功，总用时: ${uploadDuration}秒，平均速度: ${uploadSpeedMBps}MB/s`);
        console.log(`WebDAV PUT - 上传结果: ${JSON.stringify(result)}`);

        // 返回成功响应
        return new Response(null, {
          status: 201, // Created
          headers: {
            "Content-Type": "text/plain",
            "Content-Length": "0",
          },
        });
      } catch (error) {
        console.error(`WebDAV PUT - 直接上传失败:`, error);
        throw error;
      }
    }

    // 分片上传模式
    if (!shouldUseDirect) {
      console.log(`WebDAV PUT - 使用分片上传模式`);

      // 获取请求体流
      const bodyStream = c.req.body;

      if (!bodyStream) {
        return new Response("请求体不可用", {
          status: 400,
          headers: { "Content-Type": "text/plain" },
        });
      }

      // 处理非空文件 - 使用流式分片上传
      console.log(`WebDAV PUT - 文件名: ${filename}, 开始流式分片上传`);

      let uploadId = null;
      let s3Key = null;

      try {
        // 初始化后端分片上传
        const initResult = await fileSystem.initializeBackendMultipartUpload(path, userId, userType, contentType, declaredContentLength, filename);

        uploadId = initResult.uploadId;
        s3Key = initResult.key;
        const recommendedPartSize = initResult.recommendedPartSize || MULTIPART_THRESHOLD;

        //分片上传管理器
        const uploadContext = {
          path,
          userId,
          userType,
          uploadId,
          s3Key,
          recommendedPartSize,
        };

        const uploadOptions = {
          db,
          encryptionSecret: c.env.ENCRYPTION_SECRET,
          contentLength: declaredContentLength,
          contentType,
          isSpecialClient: clientInfo.isPotentiallyProblematicClient || clientInfo.isChunkedClient,
          originalStream: bodyStream,
        };

        const { success, result: completeResult, totalProcessed, partCount } = await managedMultipartUpload(bodyStream, uploadContext, fileSystem, uploadOptions);

        // 检查上传数据是否完整
        if (declaredContentLength > 0 && totalProcessed < declaredContentLength) {
          const acceptable = checkSizeDifference(totalProcessed, declaredContentLength);
          if (!acceptable) {
            console.warn(
              `WebDAV PUT - 警告：文件数据不完整，声明大小：${declaredContentLength}字节，实际上传：${totalProcessed}字节，差异：${(
                (declaredContentLength - totalProcessed) /
                (1024 * 1024)
              ).toFixed(2)}MB`
            );
          }
        }

        // 清理缓存
        const { mount } = await mountManager.getDriverByPath(path, userId, userType);
        if (mount) {
          await clearDirectoryCache({ mountId: mount.id });
        }

        const uploadDuration = Math.ceil((Date.now() - requestStartTime) / 1000);
        const uploadSpeedMBps = (totalProcessed / 1024 / 1024 / uploadDuration).toFixed(2);

        console.log(`WebDAV PUT - 主流风格分片上传完成，${partCount}个分片，总用时: ${uploadDuration}秒，平均速度: ${uploadSpeedMBps}MB/s`);
        console.log(`WebDAV PUT - 完成结果: ${JSON.stringify(completeResult)}`);

        // 成功完成分片上传后返回成功响应
        return new Response(null, {
          status: 201, // Created
          headers: {
            "Content-Type": "text/plain",
            "Content-Length": "0",
          },
        });
      } catch (error) {
        console.error(`WebDAV PUT - 主流风格分片上传失败:`, error);
        // 注意：managedMultipartUpload已经自动处理了multipart upload的清理
        throw error;
      }
    }

    // 如果没有匹配的上传模式，返回错误
    return new Response("不支持的上传模式", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
  } catch (error) {
    console.error("WebDAV PUT处理错误:", error);
    return handleWebDAVError("PUT", error);
  }
}
