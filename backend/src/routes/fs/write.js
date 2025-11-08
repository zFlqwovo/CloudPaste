import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../../constants/index.js";
import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { clearDirectoryCache } from "../../cache/index.js";

export const registerWriteRoutes = (router, helpers) => {
  const { authGateway, getServiceParams } = helpers;

  router.post("/api/fs/mkdir", async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = c.env.ENCRYPTION_SECRET;
    const body = await c.req.json();
    const path = body.path;

    if (!path) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "请提供目录路径" });
    }

    if (!userInfo.hasFullAccess) {
      const basicPath = userIdOrInfo.basicPath;
      const allowed = authGateway.utils.checkPathPermissionForOperation(c, basicPath, path);
      if (!allowed) {
        throw new HTTPException(ApiStatus.FORBIDDEN, { message: "没有权限在此路径创建目录" });
      }
    }

    try {
      const mountManager = new MountManager(db, encryptionSecret);
      const fileSystem = new FileSystem(mountManager);
      await fileSystem.createDirectory(path, userIdOrInfo, userType);

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "目录创建成功",
        success: true,
      });
    } catch (error) {
      console.error("创建目录错误:", error);
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "创建目录失败" });
    }
  });

  router.post("/api/fs/upload", async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = c.env.ENCRYPTION_SECRET;

    try {
      const formData = await c.req.formData();
      const file = formData.get("file");
      const path = formData.get("path");
      const useMultipart = formData.get("use_multipart") === "true";

      if (!file || !path) {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "请提供文件和路径" });
      }

      if (!userInfo.hasFullAccess) {
        const basicPath = userIdOrInfo.basicPath;
        const allowed = authGateway.utils.checkPathPermissionForOperation(c, basicPath, path);
        if (!allowed) {
          throw new HTTPException(ApiStatus.FORBIDDEN, { message: "没有权限在此路径上传文件" });
        }
      }

      const mountManager = new MountManager(db, encryptionSecret);
      const fileSystem = new FileSystem(mountManager);
      const result = await fileSystem.uploadFile(path, file, userIdOrInfo, userType, { useMultipart });

      if (result.useMultipart) {
        return c.json({
          code: ApiStatus.SUCCESS,
          message: "需要使用分片上传",
          data: result,
          success: true,
        });
      }

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "文件上传成功",
        data: result,
        success: true,
      });
    } catch (error) {
      console.error("上传文件错误:", error);
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "上传文件失败" });
    }
  });

  router.post("/api/fs/update", async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = c.env.ENCRYPTION_SECRET;
    const body = await c.req.json();
    const path = body.path;
    const content = body.content;

    if (!path || content === undefined) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "请提供文件路径和内容" });
    }

    if (!userInfo.hasFullAccess) {
      const basicPath = userIdOrInfo.basicPath;
      const allowed = authGateway.utils.checkPathPermissionForOperation(c, basicPath, path);
      if (!allowed) {
        throw new HTTPException(ApiStatus.FORBIDDEN, { message: "没有权限更新此路径的文件" });
      }
    }

    try {
      const mountManager = new MountManager(db, encryptionSecret);
      const fileSystem = new FileSystem(mountManager);
      const result = await fileSystem.updateFile(path, content, userIdOrInfo, userType);

      try {
        const { mount } = await mountManager.getDriverByPath(path, userIdOrInfo, userType);
        await clearDirectoryCache({ mountId: mount.id });
        console.log(`更新文件操作完成后缓存已刷新：挂载点=${mount.id}, 路径=${path}`);
      } catch (cacheError) {
        console.warn(`执行缓存清理时出错: ${cacheError.message}`);
      }

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "文件更新成功",
        data: result,
        success: true,
      });
    } catch (error) {
      console.error("更新文件错误:", error);
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "更新文件失败" });
    }
  });
};
