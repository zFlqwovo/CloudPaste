import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../../constants/index.js";
import { generateFileId } from "../../utils/common.js";
import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { clearDirectoryCache } from "../../cache/index.js";

export const registerMultipartRoutes = (router, helpers) => {
  const { authGateway, getServiceParams, getS3ConfigByUserType } = helpers;

  const requireUserContext = (c) => {
    const userInfo = c.get("userInfo");
    if (!userInfo) {
      throw new HTTPException(ApiStatus.UNAUTHORIZED, { message: "未授权访问" });
    }
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    return { db: c.env.DB, encryptionSecret: c.env.ENCRYPTION_SECRET, userInfo, userIdOrInfo, userType };
  };

  router.post("/api/fs/multipart/init", async (c) => {
    try {
      const { db, encryptionSecret, userIdOrInfo, userType } = requireUserContext(c);
      const body = await c.req.json();
      const { path, fileName, fileSize, partSize = 5 * 1024 * 1024, partCount } = body;

      if (!path || !fileName) {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少必要参数" });
      }

      if (userType === "apiKey") {
        const basicPath = userIdOrInfo.basicPath;
        const allowed = authGateway.utils.checkPathPermissionForOperation(c, basicPath, path);
        if (!allowed) {
          throw new HTTPException(ApiStatus.FORBIDDEN, { message: "没有权限执行此操作" });
        }
      }

      const mountManager = new MountManager(db, encryptionSecret);
      const fileSystem = new FileSystem(mountManager);
      const result = await fileSystem.initializeFrontendMultipartUpload(path, fileName, fileSize, userIdOrInfo, userType, partSize, partCount);

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "前端分片上传初始化成功",
        data: result,
        success: true,
      });
    } catch (error) {
      console.error("初始化前端分片上传错误:", error);
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "初始化前端分片上传失败" });
    }
  });

  router.post("/api/fs/multipart/complete", async (c) => {
    try {
      const { db, encryptionSecret, userIdOrInfo, userType } = requireUserContext(c);
      const body = await c.req.json();
      const { path, uploadId, parts, fileName, fileSize } = body;

      if (!path || !uploadId || !Array.isArray(parts) || parts.length === 0) {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少必要参数" });
      }

      const mountManager = new MountManager(db, encryptionSecret);
      const fileSystem = new FileSystem(mountManager);
      const result = await fileSystem.completeFrontendMultipartUpload(path, uploadId, parts, fileName, fileSize, userIdOrInfo, userType);

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "前端分片上传完成",
        data: result,
        success: true,
      });
    } catch (error) {
      console.error("完成前端分片上传错误:", error);
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "完成前端分片上传失败" });
    }
  });

  router.post("/api/fs/multipart/abort", async (c) => {
    try {
      const { db, encryptionSecret, userIdOrInfo, userType } = requireUserContext(c);
      const body = await c.req.json();
      const { path, uploadId, fileName } = body;

      if (!path || !uploadId || !fileName) {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少必要参数" });
      }

      const mountManager = new MountManager(db, encryptionSecret);
      const fileSystem = new FileSystem(mountManager);
      await fileSystem.abortFrontendMultipartUpload(path, uploadId, fileName, userIdOrInfo, userType);

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "已中止分片上传",
        success: true,
      });
    } catch (error) {
      console.error("中止前端分片上传错误:", error);
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "中止前端分片上传失败" });
    }
  });

  router.post("/api/fs/multipart/list-uploads", async (c) => {
    try {
      const { db, encryptionSecret, userIdOrInfo, userType } = requireUserContext(c);
      const body = await c.req.json();
      const { path = "" } = body;

      const mountManager = new MountManager(db, encryptionSecret);
      const fileSystem = new FileSystem(mountManager);
      const result = await fileSystem.listMultipartUploads(path, userIdOrInfo, userType);

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "列出进行中的分片上传成功",
        data: result,
        success: true,
      });
    } catch (error) {
      console.error("列出进行中的分片上传错误:", error);
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "列出进行中的分片上传失败" });
    }
  });

  router.post("/api/fs/multipart/list-parts", async (c) => {
    try {
      const { db, encryptionSecret, userIdOrInfo, userType } = requireUserContext(c);
      const body = await c.req.json();
      const { path, uploadId, fileName } = body;

      if (!path || !uploadId || !fileName) {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少必要参数" });
      }

      const mountManager = new MountManager(db, encryptionSecret);
      const fileSystem = new FileSystem(mountManager);
      const result = await fileSystem.listMultipartParts(path, uploadId, fileName, userIdOrInfo, userType);

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "列出已上传的分片成功",
        data: result,
        success: true,
      });
    } catch (error) {
      console.error("列出已上传的分片错误:", error);
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "列出已上传的分片失败" });
    }
  });

  router.post("/api/fs/multipart/refresh-urls", async (c) => {
    try {
      const { db, encryptionSecret, userIdOrInfo, userType } = requireUserContext(c);
      const body = await c.req.json();
      const { path, uploadId, partNumbers } = body;

      if (!path || !uploadId || !Array.isArray(partNumbers) || partNumbers.length === 0) {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少必要参数" });
      }

      const mountManager = new MountManager(db, encryptionSecret);
      const fileSystem = new FileSystem(mountManager);
      const result = await fileSystem.refreshMultipartUrls(path, uploadId, partNumbers, userIdOrInfo, userType);

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "刷新分片上传预签名URL成功",
        data: result,
        success: true,
      });
    } catch (error) {
      console.error("刷新分片上传预签名URL错误:", error);
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "刷新分片上传预签名URL失败" });
    }
  });

  router.post("/api/fs/presign", async (c) => {
    try {
      const { db, encryptionSecret, userIdOrInfo, userType } = requireUserContext(c);
      const body = await c.req.json();
      const { path, fileName, contentType = "application/octet-stream", fileSize = 0 } = body;

      if (!path || !fileName) {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "请提供上传路径和文件名" });
      }

      const targetPath = path.endsWith("/") ? `${path}${fileName}` : `${path}/${fileName}`;
      if (userType === "apiKey") {
        const basicPath = userIdOrInfo.basicPath;
        const allowed = authGateway.utils.checkPathPermissionForOperation(c, basicPath, targetPath);
        if (!allowed) {
          throw new HTTPException(ApiStatus.FORBIDDEN, { message: "没有权限在此路径上传文件" });
        }
      }

      const mountManager = new MountManager(db, encryptionSecret);
      const { mount } = await mountManager.getDriverByPath(path, userIdOrInfo, userType);

      if (!mount || mount.storage_type !== "S3") {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "当前路径不支持预签名URL上传" });
      }

      const fileSystem = new FileSystem(mountManager);
      const result = await fileSystem.generatePresignedUrl(targetPath, userIdOrInfo, userType, {
        operation: "upload",
        fileName,
        fileSize,
        contentType,
      });

      const fileId = generateFileId();

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "获取预签名URL成功",
        data: {
          presignedUrl: result.uploadUrl,
          fileId,
          s3Path: result.s3Path,
          s3Url: result.s3Url,
          mountId: mount.id,
          s3ConfigId: mount.storage_config_id,
          targetPath,
          contentType: result.contentType,
        },
        success: true,
      });
    } catch (error) {
      console.error("获取预签名URL错误:", error);
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "获取预签名URL失败" });
    }
  });

  router.post("/api/fs/presign/commit", async (c) => {
    try {
      const body = await c.req.json();
      const targetPath = body.targetPath;
      const mountId = body.mountId;
      const fileSize = body.fileSize || 0;

      if (!targetPath || !mountId) {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "请提供完整的上传信息" });
      }

      const fileName = targetPath.split("/").filter(Boolean).pop();

      try {
        await clearDirectoryCache({ mountId });
        console.log(`预签名上传完成后缓存已刷新：挂载点=${mountId}, 文件=${fileName}`);
      } catch (cacheError) {
        console.warn(`执行缓存清理时出错: ${cacheError.message}`);
      }

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "文件上传完成",
        data: {
          fileName,
          targetPath,
          fileSize,
        },
        success: true,
      });
    } catch (error) {
      console.error("提交预签名上传完成错误:", error);
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "提交预签名上传完成失败" });
    }
  });
};
