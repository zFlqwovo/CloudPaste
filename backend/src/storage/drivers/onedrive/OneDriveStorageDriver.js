/**
 * OneDriveStorageDriver
 *
 * Microsoft OneDrive / SharePoint 存储驱动实现
 * - 基于 Microsoft Graph API 实现文件操作
 * - 支持 READER/WRITER/ATOMIC/PROXY/SEARCH 能力（首版）
 * - 可选支持 DIRECT_LINK/MULTIPART 能力（后续扩展）
 *
 *
 * ========== 返回值契约规范（遵循 storage-driver 规范）==========
 *
 * renameItem: 返回 { success: boolean, source: string, target: string, message?: string }
 * copyItem:   返回 { status: "success"|"skipped"|"failed", source: string, target: string, message?: string, skipped?: boolean, reason?: string }
 * batchRemoveItems: 返回 { success: number, failed: Array<{path, error}>, results?: Array<{path, success, error?}> }
 * uploadFile: 返回 { success: boolean, storagePath: string, message?: string }
 * createDirectory: 返回 { success: boolean, path: string, alreadyExists?: boolean }
 * listDirectory: 返回 { path, type: "directory", isRoot, isVirtual, mount_id?, storage_type?, items: Array<FileInfo> }
 * getFileInfo: 返回 { path, name, isDirectory, size, modified, mimetype?, type, typeName, mount_id?, storage_type? }
 * downloadFile: 返回 StorageStreamDescriptor 对象
 */

import { BaseDriver } from "../../interfaces/capabilities/BaseDriver.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";
import { OneDriveAuthManager } from "./auth/OneDriveAuthManager.js";
import { OneDriveGraphClient } from "./client/OneDriveGraphClient.js";
import { DriverError } from "../../../http/errors.js";
import { buildFullProxyUrl } from "../../../constants/proxy.js";
import { getMimeTypeFromFilename } from "../../../utils/fileUtils.js";
import { FILE_TYPES, FILE_TYPE_NAMES } from "../../../constants/index.js";
import { GetFileType } from "../../../utils/fileTypeDetector.js";

// 简单上传（Simple Upload）上限：4MB
const SIMPLE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

export class OneDriveStorageDriver extends BaseDriver {
  /**
   * @param {Object} config  存储配置对象
   * @param {string} encryptionSecret 加密密钥
   */
  constructor(config, encryptionSecret) {
    super(config);
    this.type = "ONEDRIVE";
    this.encryptionSecret = encryptionSecret;

    // 能力：READER/WRITER/ATOMIC/PROXY/SEARCH/DIRECT_LINK
    // MULTIPART 作为可选扩展，在后续版本中实现
    this.capabilities = [
      CAPABILITIES.READER,
      CAPABILITIES.WRITER,
      CAPABILITIES.ATOMIC,
      CAPABILITIES.PROXY,
      CAPABILITIES.SEARCH,
      CAPABILITIES.DIRECT_LINK,
    ];

    // 配置字段
    this.region = config.region || "global";
    this.clientId = config.client_id;
    this.clientSecret = config.client_secret;
    this.refreshToken = config.refresh_token;
    this.tokenRenewEndpoint = config.token_renew_endpoint || null;
    this.redirectUri = config.redirect_uri || null;
    this.useOnlineApi = Boolean(config.use_online_api);

    // 内部组件（延迟初始化）
    this.authManager = null;
    this.graphClient = null;
  }

  /**
   * 初始化存储驱动
   * - 创建 AuthManager 和 GraphClient
   * - 验证配置有效性
   */
  async initialize() {
    // 创建认证管理器
    this.authManager = new OneDriveAuthManager({
      region: this.region,
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      refreshToken: this.refreshToken,
      tokenRenewEndpoint: this.tokenRenewEndpoint,
      redirectUri: this.redirectUri,
      useOnlineApi: this.useOnlineApi,
    });

    // 创建 Graph API 客户端
    this.graphClient = new OneDriveGraphClient({
      region: this.region,
      authManager: this.authManager,
    });

    // 验证 token 可用性（尝试获取一次 access token）
    try {
      await this.authManager.getAccessToken();
    } catch (error) {
      throw new DriverError("OneDrive 驱动初始化失败：无法获取访问令牌", {
        status: 500,
        cause: error,
        details: { region: this.region },
      });
    }

    this.initialized = true;
  }

  // ========== READER 能力：listDirectory / getFileInfo / downloadFile ==========

  /**
   * 列出目录内容
   * @param {string} path    挂载视图下的路径
   * @param {Object} options 上下文选项（mount/subPath/db/userType 等）
   */
  async listDirectory(path, options = {}) {
    this._ensureInitialized();

    const { mount, subPath, db } = options;
    // 对远端 OneDrive 来说，应当始终使用 subPath 作为实际路径，path 只是挂载视图下的展示路径
    const remotePath = typeof subPath === "string" ? subPath : path;

    const items = await this.graphClient.listChildren(remotePath || "");

    // 转换为标准格式（path 仍然使用挂载视图路径，保证与 FileSystem 约定一致）
    const formattedItems = await Promise.all(
      items.map((item) => this._formatDriveItem(item, path, mount, db)),
    );

    return {
      path,
      type: "directory",
      isRoot: !remotePath || remotePath === "/",
      isVirtual: false,
      mount_id: mount?.id,
      storage_type: this.type,
      items: formattedItems,
    };
  }

  /**
   * 获取文件或目录信息
   * @param {string} path    挂载视图下的路径
   * @param {Object} options 上下文选项（mount/subPath/db/userType/userId/request 等）
   */
  async getFileInfo(path, options = {}) {
    this._ensureInitialized();

    const { mount, subPath, db } = options;
    const remotePath = typeof subPath === "string" ? subPath : path;

    const item = await this.graphClient.getItem(remotePath || "");

    let parentPath = path;
    if (typeof path === "string") {
      const segments = path.split("/").filter(Boolean);
      if (segments.length > 1) {
        parentPath = `/${segments.slice(0, -1).join("/")}`;
      } else if (mount?.mount_path) {
        parentPath = mount.mount_path;
      } else {
        parentPath = "/";
      }
    }

    return this._formatDriveItem(item, parentPath, mount, db);
  }

  /**
   * 下载文件，返回 StorageStreamDescriptor
   * @param {string} path    挂载视图下的路径
   * @param {Object} options 上下文选项（mount/subPath/db/request 等）
   * @returns {Promise<import('../../streaming/types.js').StorageStreamDescriptor>}
   */
  async downloadFile(path, options = {}) {
    this._ensureInitialized();

    const { subPath } = options;
    const remotePath = typeof subPath === "string" ? subPath : path;

    // 获取文件元数据
    const item = await this.graphClient.getItem(remotePath || "");

    if (item.folder) {
      throw new DriverError("无法下载目录", { status: 400 });
    }

    const size = item.size || null;
    const contentType = item.file?.mimeType || getMimeTypeFromFilename(item.name) || "application/octet-stream";
    const etag = item.eTag || null;
    const lastModified = item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : null;

    // 返回 StorageStreamDescriptor
    return {
      size,
      contentType,
      etag,
      lastModified,
      getStream: async (streamOptions = {}) => {
        const { signal } = streamOptions;
        const stream = await this.graphClient.downloadContent(remotePath || "", { signal });
        return {
          stream,
          close: async () => {
            // Web ReadableStream 的关闭由消费者处理
            if (stream.locked === false && typeof stream.cancel === "function") {
              await stream.cancel();
            }
          },
        };
      },
      // getRange 可选实现，未实现时 StorageStreaming 层会降级处理
    };
  }

  // ========== WRITER 能力：uploadFile / createDirectory / rename / copy / remove ==========

  /**
   * 统一上传入口（文件 / 流）
   * @param {string} path          目标路径（挂载视图或 storage-first 视图）
   * @param {any} fileOrStream     数据源（ReadableStream/Node Stream/Buffer/File/Blob/string 等）
   * @param {Object} options       上下文选项（mount/subPath/db/filename/contentType/contentLength 等）
   */
  async uploadFile(path, fileOrStream, options = {}) {
    this._ensureInitialized();

    const { contentLength, contentType, subPath, filename } = options;

    // 规范化远端文件路径：目录(subPath) + 文件名
    const remoteBase = typeof subPath === "string" ? subPath : path;
    const normalizedBase =
      typeof remoteBase === "string"
        ? remoteBase.replace(/^\/+|\/+$/g, "").replace(/[\\/]+/g, "/")
        : "";
    const safeName =
      filename ||
      (typeof path === "string"
        ? path.split("/").filter(Boolean).pop() || "upload.bin"
        : "upload.bin");
    let remotePath;
    if (!normalizedBase) {
      remotePath = safeName;
    } else {
      const segments = normalizedBase.split("/").filter(Boolean);
      const lastSegment = segments[segments.length - 1] || "";
      if (lastSegment.toLowerCase() === safeName.toLowerCase()) {
        remotePath = normalizedBase;
      } else {
        remotePath = `${normalizedBase}/${safeName}`;
      }
    }

    const effectiveContentType =
      contentType || getMimeTypeFromFilename(safeName) || "application/octet-stream";

    try {
      let item;

      // 小文件：走 Simple Upload（PUT .../content）
      if (
        typeof contentLength === "number" &&
        Number.isFinite(contentLength) &&
        contentLength > 0 &&
        contentLength <= SIMPLE_UPLOAD_MAX_BYTES
      ) {
        console.log(
          `[StorageUpload] type=ONEDRIVE mode=简单上传 status=开始 路径=${path} 子路径=${subPath ?? ""} 远端=${remotePath} 大小=${contentLength}`,
        );

        item = await this.graphClient.uploadSmall(remotePath || "", fileOrStream, {
          contentLength,
          contentType: effectiveContentType,
        });
      } else if (
        typeof contentLength === "number" &&
        Number.isFinite(contentLength) &&
        contentLength > SIMPLE_UPLOAD_MAX_BYTES
      ) {
        // 大文件：使用 Upload Session + 单次 PUT（后端流式上传，不做分片循环）
        console.log(
          `[StorageUpload] type=ONEDRIVE mode=会话上传 status=开始 路径=${path} 子路径=${subPath ?? ""} 远端=${remotePath} 大小=${contentLength}`,
        );

        const session = await this.graphClient.createUploadSession(remotePath || "", {
          conflictBehavior: "rename",
        });
        item = await this.graphClient.uploadSessionSingleChunk(session.uploadUrl, fileOrStream, {
          contentLength,
          contentType: effectiveContentType,
        });
      } else {
        // 未知大小：保守起见使用 Simple Upload，依赖环境自身的大小限制
        console.log(
          `[StorageUpload] type=ONEDRIVE mode=简单上传-未知大小 status=开始 路径=${path} 子路径=${subPath ?? ""} 远端=${remotePath}`,
        );

        item = await this.graphClient.uploadSmall(remotePath || "", fileOrStream, {
          contentLength,
          contentType: effectiveContentType,
        });
      }

      return {
        success: true,
        storagePath: path,
        message: "文件上传成功",
        item,
      };
    } catch (error) {
      throw new DriverError(`文件上传失败: ${error.message}`, {
        status: error.status || 500,
        cause: error,
        details: { path },
      });
    }
  }

  /**
   * 更新文件内容
   * @param {string} path    挂载视图下的文件路径
   * @param {string|Uint8Array|ArrayBuffer} content 新内容
   * @param {Object} options 上下文选项（mount/subPath/db 等）
   */
  async updateFile(path, content, options = {}) {
    this._ensureInitialized();

    const { subPath } = options;

    if (typeof subPath !== "string") {
      throw new DriverError("OneDrive 更新文件缺少子路径上下文（subPath）", {
        status: 500,
        details: { path },
      });
    }

    // subPath 已经是挂载内的完整相对路径（包含文件名）
    const remotePath = subPath
      .replace(/^[/\\]+|[/\\]+$/g, "")
      .replace(/[\\/]+/g, "/");

    const safeName =
      (typeof path === "string"
        ? path.split("/").filter(Boolean).pop()
        : null) || "file";

    const effectiveContentType =
      getMimeTypeFromFilename(safeName) || "text/plain; charset=utf-8";

    // 计算内容长度（仅在字符串时计算，用于大文件判断）
    let contentLength = undefined;
    if (typeof content === "string") {
      contentLength = Buffer.byteLength(content, "utf8");
    }

    try {
      let item;

      console.log(
        `[StorageUpload] type=ONEDRIVE mode=内容更新 status=开始 路径=${path} 子路径=${remotePath} 大小=${contentLength ?? "未知"}`,
      );

      if (
        typeof contentLength === "number" &&
        Number.isFinite(contentLength) &&
        contentLength > SIMPLE_UPLOAD_MAX_BYTES
      ) {
        // 大文件更新：使用 Upload Session 单块覆盖
        const session = await this.graphClient.createUploadSession(remotePath || "", {
          conflictBehavior: "replace",
        });
        item = await this.graphClient.uploadSessionSingleChunk(session.uploadUrl, content, {
          contentLength,
          contentType: effectiveContentType,
        });
      } else {
        // 小文件更新：直接 Simple Upload 覆盖
        item = await this.graphClient.uploadSmall(remotePath || "", content, {
          contentLength,
          contentType: effectiveContentType,
        });
      }

      console.log(
        `[StorageUpload] type=ONEDRIVE mode=内容更新 status=完成 路径=${path} 子路径=${remotePath}`,
      );

      return {
        success: true,
        path,
        message: "文件更新成功",
        item,
      };
    } catch (error) {
      throw new DriverError(`更新文件失败: ${error.message}`, {
        status: error.status || 500,
        cause: error,
        details: { path, subPath: remotePath },
      });
    }
  }

  /**
   * 生成预签名上传URL（基于 OneDrive 上传会话）
   * - 供 /api/fs/presign 使用，前端通过 StorageAdapter 执行直链上传
   * - 这里使用 Graph createUploadSession + uploadUrl，前端一次性 PUT 完整文件
   * @param {string} path    挂载视图下的目录路径或 storage-first 路径
   * @param {Object} options 上下文选项（mount/subPath/db/fileName/fileSize 等）
   */
  async generateUploadUrl(path, options = {}) {
    this._ensureInitialized();

    const { subPath } = options;
    const { fileName, fileSize } = options;

    if (!fileName) {
      throw new DriverError("生成上传URL失败: 缺少文件名", { status: 400 });
    }

    // 对于 FS 视图，使用 subPath/targetPath 作为完整远端路径（包含文件名）；
    // 对于 storage-first 场景，则直接使用传入的 path 作为对象 Key。
    const remoteBase = subPath != null ? subPath : path;
    const remotePath =
      typeof remoteBase === "string"
        ? remoteBase
            .replace(/^[/\\]+/, "")
            .replace(/[/\\]+$/, "")
            .replace(/[\\/]+/g, "/")
        : "";
    const safeName = fileName;

    try {
      console.log(
        `[StorageUpload] type=ONEDRIVE mode=预签名上传 status=开始 路径=${path} 子路径=${remotePath} 文件=${safeName} 大小=${fileSize ?? "未知"}`,
      );

      const session = await this.graphClient.createUploadSession(remotePath || "", {
        conflictBehavior: "rename",
      });

      const detectedContentType = getMimeTypeFromFilename(safeName) || "application/octet-stream";

      console.log(
        `[StorageUpload] type=ONEDRIVE mode=预签名上传 status=生成完成 远端=${remotePath}`,
      );

      // OneDrive uploadUrl 本身是预认证 URL，前端通过 PUT + Content-Range 直接上传
      let headers = {};
      if (typeof fileSize === "number" && Number.isFinite(fileSize) && fileSize > 0) {
        const end = fileSize - 1;
        headers["Content-Range"] = `bytes 0-${end}/${fileSize}`;
      }

      return {
        uploadUrl: session.uploadUrl,
        storagePath: remotePath,
        fileName: safeName,
        fileSize: typeof fileSize === "number" ? fileSize : null,
        contentType: detectedContentType,
        // 额外附带会话信息，供需要时使用
        expirationDateTime: session.expirationDateTime || null,
        headers,
      };
    } catch (error) {
      throw new DriverError(`生成上传URL失败: ${error.message}`, {
        status: error.status || 500,
        cause: error,
        details: { path },
      });
    }
  }

  /**
   * 创建目录
   * @param {string} path     目录路径
   * @param {Object} _options 上下文选项（保留用于接口一致性）
   */
  async createDirectory(path, _options = {}) {
    this._ensureInitialized();

    const { subPath } = _options;
    const rawRemotePath = typeof subPath === "string" ? subPath : path;
    const remotePath =
      typeof rawRemotePath === "string"
        ? rawRemotePath.replace(/^[/\\]+|[/\\]+$/g, "").replace(/[\\/]+/g, "/")
        : "";

    // 特殊处理：挂载点根目录在逻辑上总是存在，
    // 对应的 OneDrive 根目录不需要真正创建，避免向 Graph 发送空名称导致
    // “The item must have a name.” 错误。
    if (!remotePath) {
      console.log(
        `[OneDriveStorageDriver] 跳过创建挂载点根目录（逻辑上总是存在）: ${path}`,
      );
      return {
        success: true,
        path,
        alreadyExists: true,
      };
    }

    try {
      const result = await this.graphClient.createFolder(remotePath);
      return {
        success: true,
        path,
        alreadyExists: false,
        item: result,
      };
    } catch (error) {
      // 如果目录已存在，返回 alreadyExists: true
      if (error.status === 409 || error.code === "nameAlreadyExists") {
        return {
          success: true,
          path,
          alreadyExists: true,
        };
      }
      throw new DriverError(`创建目录失败: ${error.message}`, {
        status: error.status || 500,
        cause: error,
        details: { path },
      });
    }
  }

  /**
   * 重命名文件或目录
   * @param {string} oldPath 原路径
   * @param {string} newPath 新路径
   * @param {Object} _options 上下文选项（保留用于接口一致性）
   */
  async renameItem(oldPath, newPath, _options = {}) {
    this._ensureInitialized();

    const { oldSubPath, newSubPath } = _options;

    // OneDrive 精确重命名：严格依赖 FS 提供的子路径上下文
    if (typeof oldSubPath !== "string" || typeof newSubPath !== "string") {
      throw new DriverError("OneDrive 重命名缺少子路径上下文（oldSubPath/newSubPath）", {
        status: 500,
        details: { oldPath, newPath },
      });
    }

    const normalizeRemote = (p) =>
      (p || "")
        .replace(/^[/\\]+|[/\\]+$/g, "")
        .replace(/[\\/]+/g, "/");

    const remoteOldPath = normalizeRemote(oldSubPath);
    const remoteNewPath = normalizeRemote(newSubPath);

    try {
      await this.graphClient.renameItem(remoteOldPath || "", remoteNewPath || "");
      return {
        success: true,
        source: oldPath,
        target: newPath,
      };
    } catch (error) {
      throw new DriverError(`重命名失败: ${error.message}`, {
        status: error.status || 500,
        cause: error,
        details: { oldPath, newPath, remoteOldPath, remoteNewPath },
      });
    }
  }

  /**
   * 批量删除文件/目录
   * @param {Array<string>} paths 路径数组（FS 视图路径，如 /onedrive/file.zip）
   * @param {Object} options     上下文选项
   * @param {Array<string>} [options.subPaths] 预计算的子路径数组（可选）
   * @param {string} [options.subPath]         首个路径的子路径（兼容单路径场景）
   * @param {D1Database} [options.db]          数据库实例
   * @param {string|Object} [options.userIdOrInfo] 用户ID或API密钥信息
   * @param {string} [options.userType]        用户类型
   * @param {Function} [options.findMountPointByPath] 挂载点查找函数
   */
  async batchRemoveItems(paths, options = {}) {
    this._ensureInitialized();

    const results = [];
    const failed = [];
    let successCount = 0;

    const { subPaths, subPath, db, userIdOrInfo, userType, findMountPointByPath } = options;

    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      /** @type {string} */
      let remotePath = path;

      // 1）优先使用显式传入的 subPaths（FS or storage-first 调用方可直接提供）
      if (Array.isArray(subPaths) && typeof subPaths[i] === "string") {
        remotePath = subPaths[i];
      } else if (typeof findMountPointByPath === "function" && db) {
        // 2）否则通过 findMountPointByPath 重新解析挂载点与子路径（与 S3 批量删除保持一致）
        try {
          const mountResult = await findMountPointByPath(db, path, userIdOrInfo, userType);
          if (mountResult && !mountResult.error) {
            remotePath = mountResult.subPath || "";
          } else if (mountResult && mountResult.error) {
            results.push({ path, success: false, error: mountResult.error.message || "删除失败" });
            failed.push({ path, error: mountResult.error.message || "删除失败" });
            continue;
          }
        } catch (error) {
          results.push({ path, success: false, error: error.message || "删除失败" });
          failed.push({ path, error: error.message || "删除失败" });
          continue;
        }
      } else if (typeof subPath === "string" && paths.length === 1) {
        // 3）兼容仅传入单个 subPath 的场景（如 ObjectStore 等）
        remotePath = subPath;
      }

      if (typeof remotePath === "string") {
        remotePath = remotePath
          .replace(/^[/\\]+/, "")
          .replace(/[/\\]+$/, "")
          .replace(/[\\/]+/g, "/");
      }

      try {
        await this.graphClient.deleteItem(remotePath || "");
        results.push({ path, success: true });
        successCount++;
      } catch (error) {
        results.push({ path, success: false, error: error.message });
        failed.push({ path, error: error.message });
      }
    }

    return {
      success: successCount,
      failed,
      results,
    };
  }

  /**
   * 复制单个文件或目录
   * @param {string} sourcePath 源路径
   * @param {string} targetPath 目标路径
   * @param {Object} _options   上下文选项（保留用于接口一致性）
   */
  async copyItem(sourcePath, targetPath, _options = {}) {
    this._ensureInitialized();

    const { sourceSubPath, targetSubPath } = _options;

    // 同存储复制：严格依赖 FS 提供的源/目标子路径
    if (typeof sourceSubPath !== "string" || typeof targetSubPath !== "string") {
      throw new DriverError("OneDrive 复制缺少子路径上下文（sourceSubPath/targetSubPath）", {
        status: 500,
        details: { sourcePath, targetPath },
      });
    }

    const normalizeRemote = (p) =>
      (p || "")
        .replace(/^[/\\]+|[/\\]+$/g, "")
        .replace(/[\\/]+/g, "/");

    const remoteSourcePath = normalizeRemote(sourceSubPath);
    const remoteTargetPath = normalizeRemote(targetSubPath);

    try {
      await this.graphClient.copyItem(remoteSourcePath || "", remoteTargetPath || "");
      return {
        status: "success",
        source: sourcePath,
        target: targetPath,
      };
    } catch (error) {
      if (error.status === 409 || error.code === "nameAlreadyExists") {
        return {
          status: "skipped",
          source: sourcePath,
          target: targetPath,
          skipped: true,
          reason: "目标已存在",
        };
      }
      return {
        status: "failed",
        source: sourcePath,
        target: targetPath,
        message: error.message,
      };
    }
  }

  // ========== SEARCH 能力 ==========

  /**
   * 搜索文件和目录
   * @param {string} query    搜索关键词
   * @param {Object} options  选项（mount/searchPath/maxResults/db）
   */
  async search(query, options = {}) {
    this._ensureInitialized();

    const { mount, maxResults = 50, db, searchPath } = options;

    try {
      const items = await this.graphClient.search(query, { maxResults });

      const normalizedMountPath =
        (mount?.mount_path ? mount.mount_path.replace(/\/+$/g, "") : "") || "/";
      const normalizedSearchPath = searchPath ? (searchPath.replace(/\/+$/g, "") || "/") : null;

      const results = [];

      for (const item of items) {
        const parentFsPath = this._resolveFsParentPathForItem(
          item,
          normalizedMountPath,
          normalizedSearchPath,
        );

        if (!parentFsPath) {
          continue;
        }

        const formatted = await this._formatDriveItem(item, parentFsPath, mount, db);
        results.push(formatted);
      }

      return results;
    } catch (error) {
      // 搜索失败时返回空数组，不抛出错误
      console.error("OneDrive 搜索失败:", error.message);
      return [];
    }
  }

  // ========== DIRECT_LINK 能力 ==========

  /**
   * 生成下载直链（DIRECT_LINK 能力）
   * - 基于 Graph API @microsoft.graph.downloadUrl 生成直链
   * - 返回 { url, type, expiresIn?, expiresAt? }
   * @param {string} path
   * @param {Object} options
   */
  async generateDownloadUrl(path, options = {}) {
    this._ensureInitialized();

    try {
      const { subPath } = options;
      const remotePath = typeof subPath === "string" ? subPath : path;

      // 获取文件元数据，包含 downloadUrl
      const item = await this.graphClient.getItem(remotePath || "");

      if (item.folder) {
        throw new DriverError("无法为目录生成下载链接", { status: 400 });
      }

      const downloadUrl = item["@microsoft.graph.downloadUrl"];

      if (!downloadUrl) {
        // 如果没有 downloadUrl，回退到 proxy 模式
        return await this.generateProxyUrl(path, options);
      }

      // Graph API downloadUrl 通常有效期约 1 小时
      const expiresIn = 3600; // 1 小时（秒）
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      return {
        url: downloadUrl,
        type: "native_direct",
        expiresIn,
        expiresAt,
      };
    } catch (error) {
      // 如果获取直链失败，回退到 proxy 模式
      console.error("OneDrive 获取直链失败，回退到 proxy:", error.message);
      return await this.generateProxyUrl(path, options);
    }
  }

  // ========== PROXY 能力 ==========

  /**
   * 生成代理 URL（PROXY 能力）
   * - 返回 { url, type: "proxy", channel? }
   * @param {string} path
   * @param {Object} options
   */
  async generateProxyUrl(path, options = {}) {
    this._ensureInitialized();

    const { request, download = false, channel = "web" } = options;

    // 使用统一的代理 URL 构建器
    const url = buildFullProxyUrl(request, path, download);

    return {
      url,
      type: "proxy",
      channel,
    };
  }

  // ========== 基础方法 ==========

  /**
   * 基础存在性检查
   * @param {string} path
   * @param {Object} _options 上下文选项（保留用于接口一致性）
   * @returns {Promise<boolean>}
   */
  async exists(path, _options = {}) {
    this._ensureInitialized();

    const { subPath } = _options;
    const remotePath = typeof subPath === "string" ? subPath : path;

    try {
      await this.graphClient.getItem(remotePath || "");
      return true;
    } catch (error) {
      if (error.status === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * 获取存储驱动统计信息
   * @returns {Promise<Object>}
   */
  async getStats() {
    this._ensureInitialized();

    return {
      type: this.type,
      capabilities: this.capabilities,
      initialized: this.initialized,
      region: this.region,
      timestamp: new Date().toISOString(),
    };
  }

  // ========== 私有辅助方法 ==========

  /**
   * 将 Graph driveItem 的 parentReference.path 映射到 FS 视图下的父路径
   * - 利用挂载路径 mountPath 构造统一的 /mount/subDir 形式
   * - 不再依赖 root_folder，直接按 OneDrive 根进行映射
   *
   * @param {Object} item Graph API driveItem
   * @param {string} mountPath 规范化后的挂载路径（无结尾斜杠，至少为 "/"）
   * @param {string|null} scopedBasePath 搜索限定路径（FS 视图下，目录级别，无结尾斜杠）
   * @returns {string|null} FS 视图下的父路径（不含文件名）；若应过滤则返回 null
   */
  _resolveFsParentPathForItem(item, mountPath, scopedBasePath) {
    const parentDrivePath = item?.parentReference?.path || "/drive/root:";
    const prefix = "/drive/root:";
    let relativeDir = "";

    if (parentDrivePath.startsWith(prefix)) {
      // 形如 "/drive/root:/cloudpaste/subdir" → "/cloudpaste/subdir"
      relativeDir = parentDrivePath.slice(prefix.length);
    }

    if (relativeDir) {
      relativeDir = relativeDir.replace(/^\/+|\/+$/g, "").replace(/[\\\/]+/g, "/");
    }

    // 直接以 OneDrive 根为基准映射到挂载路径
    const subPathFromRoot = relativeDir;
    let fsParentPath = mountPath || "/";
    if (subPathFromRoot) {
      fsParentPath = `${fsParentPath}/${subPathFromRoot}`;
    }

    fsParentPath = fsParentPath.replace(/\/+/g, "/");
    if (!fsParentPath.startsWith("/")) {
      fsParentPath = `/${fsParentPath}`;
    }

    if (scopedBasePath) {
      const base = scopedBasePath.replace(/\/+$/g, "") || "/";
      if (!(fsParentPath === base || fsParentPath.startsWith(`${base}/`))) {
        return null;
      }
    }

    return fsParentPath;
  }

  /**
   * 将 Graph API driveItem 转换为标准文件信息格式
   * @param {Object} item Graph API driveItem
   * @param {string} parentPath 父路径
   * @param {Object} mount 挂载信息
   * @param {D1Database} [db] 数据库实例（用于文件类型检测）
   */
  async _formatDriveItem(item, parentPath, mount, db) {
    const isDirectory = !!item.folder;
    const name = item.name;
    const path = parentPath ? `${parentPath}/${name}`.replace(/[\\/]+/g, "/") : name;

    const type = isDirectory ? FILE_TYPES.FOLDER : await GetFileType(name, db);
    const typeName = FILE_TYPE_NAMES[type] || (isDirectory ? "folder" : "file");

    return {
      path,
      name,
      isDirectory,
      size: item.size || 0,
      modified: item.lastModifiedDateTime || null,
      mimetype: isDirectory ? null : (item.file?.mimeType || getMimeTypeFromFilename(name)),
      type,
      typeName,
      mount_id: mount?.id,
      storage_type: this.type,
      // OneDrive 特有字段（可选）
      webUrl: item.webUrl || null,
      downloadUrl: item["@microsoft.graph.downloadUrl"] || null,
    };
  }
}
