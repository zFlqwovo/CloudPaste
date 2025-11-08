import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../../constants/index.js";
import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { getVirtualDirectoryListing, isVirtualPath } from "../../storage/fs/utils/VirtualDirectory.js";

export const registerBrowseRoutes = (router, helpers) => {
  const { authGateway, getServiceParams } = helpers;

  router.get("/api/fs/list", async (c) => {
    const db = c.env.DB;
    const path = c.req.query("path") || "/";
    const refresh = c.req.query("refresh") === "true";
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = c.env.ENCRYPTION_SECRET;

    if (refresh) {
      console.log("[后端路由] 收到强制刷新请求:", { path, refresh });
    }

    try {
      if (userType === "apiKey") {
        const basicPath = userIdOrInfo.basicPath;
        const allowed = authGateway.utils.checkPathPermissionForNavigation(basicPath, path);
        if (!allowed) {
          throw new HTTPException(ApiStatus.FORBIDDEN, { message: "没有权限访问此路径" });
        }
      }

      const mounts = await authGateway.utils.getAccessibleMounts(db, userIdOrInfo, userType);

      if (isVirtualPath(path, mounts)) {
        const basicPath = userType === "apiKey" ? userIdOrInfo.basicPath : null;
        const result = await getVirtualDirectoryListing(mounts, path, basicPath);

        return c.json({
          code: ApiStatus.SUCCESS,
          message: "获取目录列表成功",
          data: result,
          success: true,
        });
      }

      const mountManager = new MountManager(db, encryptionSecret);
      const fileSystem = new FileSystem(mountManager);
      const result = await fileSystem.listDirectory(path, userIdOrInfo, userType, { refresh });

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "获取目录列表成功",
        data: result,
        success: true,
      });
    } catch (error) {
      console.error("获取目录列表错误:", error);
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "获取目录列表失败" });
    }
  });

  router.get("/api/fs/get", async (c) => {
    const db = c.env.DB;
    const path = c.req.query("path");
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = c.env.ENCRYPTION_SECRET;

    if (!path) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "请提供文件路径" });
    }

    if (!userInfo.hasFullAccess) {
      const basicPath = userIdOrInfo.basicPath;
      const allowed = authGateway.utils.checkPathPermissionForOperation(c, basicPath, path);
      if (!allowed) {
        throw new HTTPException(ApiStatus.FORBIDDEN, { message: "没有权限访问此路径" });
      }
    }

    try {
      const mountManager = new MountManager(db, encryptionSecret);
      const fileSystem = new FileSystem(mountManager);
      const result = await fileSystem.getFileInfo(path, userIdOrInfo, userType, c.req.raw);

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "获取文件信息成功",
        data: result,
        success: true,
      });
    } catch (error) {
      console.error("获取文件信息错误:", error);
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "获取文件信息失败" });
    }
  });

  router.get("/api/fs/download", async (c) => {
    const db = c.env.DB;
    const path = c.req.query("path");
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = c.env.ENCRYPTION_SECRET;

    if (!path) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "请提供文件路径" });
    }

    if (!userInfo.hasFullAccess) {
      const basicPath = userIdOrInfo.basicPath;
      const allowed = authGateway.utils.checkPathPermissionForOperation(c, basicPath, path);
      if (!allowed) {
        throw new HTTPException(ApiStatus.FORBIDDEN, { message: "没有权限访问此路径" });
      }
    }

    try {
      const mountManager = new MountManager(db, encryptionSecret);
      const fileSystem = new FileSystem(mountManager);
      const response = await fileSystem.downloadFile(path, null, c.req.raw, userIdOrInfo, userType);
      return response;
    } catch (error) {
      console.error("下载文件错误:", error);
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "下载文件失败" });
    }
  });

  router.get("/api/fs/file-link", async (c) => {
    const db = c.env.DB;
    const path = c.req.query("path");
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = c.env.ENCRYPTION_SECRET;
    const expiresInParam = c.req.query("expires_in");
    const expiresIn = expiresInParam && expiresInParam !== "null" ? parseInt(expiresInParam) : null;
    const forceDownload = c.req.query("force_download") === "true";

    if (!path) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "请提供文件路径" });
    }

    try {
      const mountManager = new MountManager(db, encryptionSecret);
      const fileSystem = new FileSystem(mountManager);
      const result = await fileSystem.generatePresignedUrl(path, userIdOrInfo, userType, {
        operation: "download",
        userType,
        userId: userType === "admin" ? userIdOrInfo : userIdOrInfo.id,
        expiresIn,
        forceDownload,
      });

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "获取文件直链成功",
        data: result,
        success: true,
      });
    } catch (error) {
      console.error("获取文件直链错误:", error);
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "获取文件直链失败" });
    }
  });
};
