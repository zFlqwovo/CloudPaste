import { DriverError } from "../../../http/errors.js";
import { ApiStatus } from "../../../constants/index.js";
import { CAPABILITIES } from "../../interfaces/capabilities/index.js";

export async function generatePresignedUrl(fs, path, userIdOrInfo, userType, options = {}) {
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  // 优先用预签名能力
  if (driver.hasCapability(CAPABILITIES.PRESIGNED)) {
    const result = await driver.generatePresignedUrl(path, {
      mount,
      subPath,
      db: fs.mountManager.db,
      userIdOrInfo,
      userType,
      ...options,
    });
    if (typeof result === "string") {
      return { url: result, presignedUrl: result, type: "presigned", expiresIn: options.expiresIn || null };
    }
    const url = result?.url || result?.presignedUrl || result?.downloadUrl || result?.previewUrl || null;
    return {
      url,
      presignedUrl: url,
      type: result?.type || "presigned",
      expiresIn: result?.expiresIn || options.expiresIn || null,
    };
  }

  // 无预签名：若支持代理则回退代理
  if (typeof driver.generateProxyUrl === "function") {
    const proxy = await driver.generateProxyUrl(path, {
      mount,
      request: options.request || null,
      download: options.forceDownload || false,
      db: fs.mountManager.db,
    });
    return {
      url: proxy?.url || null,
      type: "proxy",
      expiresIn: null,
    };
  }

  throw new DriverError(`存储驱动 ${driver.getType()} 不支持直链/代理生成`, {
    status: ApiStatus.NOT_IMPLEMENTED,
    code: "DRIVER_ERROR.NOT_IMPLEMENTED",
    expose: true,
  });
}

export async function commitPresignedUpload(fs, path, filename, userIdOrInfo, userType, options = {}) {
  const { fileSize, etag, contentType } = options;
  const { driver, mount, subPath } = await fs.mountManager.getDriverByPath(path, userIdOrInfo, userType);

  if (!driver.hasCapability(CAPABILITIES.WRITER)) {
    throw new DriverError(`存储驱动 ${driver.getType()} 不支持写入操作`, {
      status: ApiStatus.NOT_IMPLEMENTED,
      code: "DRIVER_ERROR.NOT_IMPLEMENTED",
      expose: true,
    });
  }

  if (typeof driver.handleUploadComplete === "function") {
    const result = await driver.handleUploadComplete(path, {
      mount,
      subPath,
      db: fs.mountManager.db,
      fileName: filename,
      fileSize,
      contentType,
      etag,
    });

    fs.emitCacheInvalidation({ mount, paths: [path], reason: "upload-complete" });
    return result;
  }

  fs.emitCacheInvalidation({ mount, paths: [path], reason: "upload-complete" });
  return { success: true, message: "上传完成" };
}


