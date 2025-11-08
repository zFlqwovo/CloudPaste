import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../../constants/index.js";
import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { clearDirectoryCache } from "../../cache/index.js";
import { useRepositories } from "../../utils/repositories.js";

export const registerOpsRoutes = (router, helpers) => {
  const { authGateway, getServiceParams, getS3ConfigByUserType } = helpers;

  router.post("/api/fs/rename", async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
    const encryptionSecret = getEncryptionSecret(c);
    const body = await c.req.json();
    const oldPath = body.oldPath;
    const newPath = body.newPath;

    if (!oldPath || !newPath) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "请提供原路径和新路径" });
    }

    if (!userInfo.hasFullAccess) {
      const basicPath = userIdOrInfo.basicPath;
      const allowedOld = authGateway.utils.checkPathPermissionForOperation(c, basicPath, oldPath);
      const allowedNew = authGateway.utils.checkPathPermissionForOperation(c, basicPath, newPath);
      if (!allowedOld || !allowedNew) {
        throw new HTTPException(ApiStatus.FORBIDDEN, { message: "没有权限重命名此路径的文件" });
      }
    }

    const mountManager = new MountManager(db, encryptionSecret);
    const fileSystem = new FileSystem(mountManager);
    await fileSystem.renameItem(oldPath, newPath, userIdOrInfo, userType);

    try {
      const { mount } = await mountManager.getDriverByPath(oldPath, userIdOrInfo, userType);
      const { mount: newMount } = await mountManager.getDriverByPath(newPath, userIdOrInfo, userType);

      await clearDirectoryCache({ mountId: mount.id });
      if (newMount.id !== mount.id) {
        await clearDirectoryCache({ mountId: newMount.id });
      }
      console.log(`重命名操作完成后缓存已刷新：${oldPath} -> ${newPath}`);
    } catch (cacheError) {
      console.warn(`执行缓存清理时出错: ${cacheError.message}`);
    }

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "重命名成功",
      success: true,
    });
  });

  router.delete("/api/fs/batch-remove", async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
    const encryptionSecret = getEncryptionSecret(c);
    const body = await c.req.json();
    const paths = body.paths;

    if (!paths || !Array.isArray(paths) || paths.length === 0) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "请提供有效的路径数组" });
    }

    if (!userInfo.hasFullAccess) {
      const basicPath = userIdOrInfo.basicPath;
      for (const path of paths) {
        const allowed = authGateway.utils.checkPathPermissionForOperation(c, basicPath, path);
        if (!allowed) {
          throw new HTTPException(ApiStatus.FORBIDDEN, { message: `没有权限删除路径: ${path}` });
        }
      }
    }

    const mountManager = new MountManager(db, encryptionSecret);
    const fileSystem = new FileSystem(mountManager);
    const result = await fileSystem.batchRemoveItems(paths, userIdOrInfo, userType);

    const mountIds = new Set();
    for (const path of paths) {
      try {
        const { mount } = await mountManager.getDriverByPath(path, userIdOrInfo, userType);
        mountIds.add(mount.id);
      } catch (error) {
        console.warn(`获取路径挂载信息失败: ${path}`, error);
      }
    }

    try {
      for (const mountId of mountIds) {
        await clearDirectoryCache({ mountId });
      }
      console.log(`批量删除操作完成后缓存已刷新：${mountIds.size} 个挂载点`);
    } catch (cacheError) {
      console.warn(`执行缓存清理时出错: ${cacheError.message}`);
    }

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "批量删除成功",
      data: result,
      success: true,
    });
  });

  router.post("/api/fs/batch-copy", async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
    const encryptionSecret = getEncryptionSecret(c);
    const body = await c.req.json();
    const items = body.items;
    const skipExisting = body.skipExisting !== false;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "请提供有效的复制项数组" });
    }

    if (!userInfo.hasFullAccess) {
      const basicPath = userIdOrInfo.basicPath;
      for (const item of items) {
        const allowSrc = authGateway.utils.checkPathPermissionForOperation(c, basicPath, item.sourcePath);
        if (!allowSrc) {
          throw new HTTPException(ApiStatus.FORBIDDEN, { message: `没有权限访问源路径: ${item.sourcePath}` });
        }
        const allowDst = authGateway.utils.checkPathPermissionForOperation(c, basicPath, item.targetPath);
        if (!allowDst) {
          throw new HTTPException(ApiStatus.FORBIDDEN, { message: `没有权限访问目标路径: ${item.targetPath}` });
        }
      }
    }

    try {
      const mountManager = new MountManager(db, encryptionSecret);
      const fileSystem = new FileSystem(mountManager);
      const copyItems = items.map((item) => ({ ...item, skipExisting }));
      const result = await fileSystem.batchCopyItems(copyItems, userIdOrInfo, userType);

      const sourceMountIds = new Set();
      const targetMountIds = new Set();
      for (const item of items) {
        try {
          const { mount: sourceMount } = await mountManager.getDriverByPath(item.sourcePath, userIdOrInfo, userType);
          sourceMountIds.add(sourceMount.id);

          const { mount: targetMount } = await mountManager.getDriverByPath(item.targetPath, userIdOrInfo, userType);
          targetMountIds.add(targetMount.id);
        } catch (error) {
          console.warn(`获取路径挂载信息失败: ${item.sourcePath} -> ${item.targetPath}`, error);
        }
      }

      const allMountIds = new Set([...sourceMountIds, ...targetMountIds]);
      try {
        for (const mountId of allMountIds) {
          await clearDirectoryCache({ mountId });
        }
        console.log(
          `批量复制操作完成后缓存已刷新：源挂载点=${sourceMountIds.size}个，目标挂载点=${targetMountIds.size}个，总计=${allMountIds.size}个`
        );
      } catch (cacheError) {
        console.warn(`执行缓存清理时出错: ${cacheError.message}`);
      }

      const totalSuccess = result.success || 0;
      const totalSkipped = result.skipped || 0;
      const totalFailed = (result.failed && result.failed.length) || 0;
      const allDetails = result.details || [];
      const allFailedItems = result.failed || [];
      const hasCrossStorageOperations = result.hasCrossStorageOperations || false;
      const crossStorageResults = result.crossStorageResults || [];

      if (hasCrossStorageOperations) {
        return c.json({
          code: ApiStatus.SUCCESS,
          message: "FILE_COPY_SUCCESS",
          data: {
            crossStorage: true,
            requiresClientSideCopy: true,
            standardCopyResults: {
              success: totalSuccess,
              skipped: totalSkipped,
              failed: totalFailed,
            },
            crossStorageResults,
            failed: allFailedItems,
            details: allDetails,
          },
          success: true,
        });
      }

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "FILE_COPY_SUCCESS",
        data: {
          crossStorage: false,
          success: totalSuccess,
          skipped: totalSkipped,
          failed: totalFailed,
          details: allDetails,
        },
        success: true,
      });
    } catch (error) {
      console.error("批量复制错误:", error);
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "批量复制失败" });
    }
  });

  router.post("/api/fs/batch-copy-commit", async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const body = await c.req.json();
    const { targetMountId, files } = body;

    if (!targetMountId || !Array.isArray(files) || files.length === 0) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "请提供有效的目标挂载点ID和文件列表" });
    }

    try {
      const repositoryFactory = useRepositories(c);
      const mountRepository = repositoryFactory.getMountRepository();
      const mount = await mountRepository.findById(targetMountId);
      if (!mount) {
        throw new HTTPException(ApiStatus.NOT_FOUND, { message: "目标挂载点不存在" });
      }

      const { getEncryptionSecret } = await import("../../utils/environmentUtils.js");
      const s3Config = await getS3ConfigByUserType(db, mount.storage_config_id, userIdOrInfo, userType, getEncryptionSecret(c));
      if (!s3Config) {
        throw new HTTPException(ApiStatus.NOT_FOUND, { message: "存储配置不存在" });
      }

      const results = { success: [], failed: [] };

      for (const file of files) {
        try {
          const { targetPath, s3Path } = file;

          if (!targetPath || !s3Path) {
            results.failed.push({
              targetPath: targetPath || "未指定",
              error: "目标路径或S3路径不能为空",
            });
            continue;
          }

          const fileName = targetPath.split("/").filter(Boolean).pop();
          results.success.push({ targetPath, fileName });
        } catch (fileError) {
          console.error("处理单个文件复制提交时出错:", fileError);
          results.failed.push({
            targetPath: file.targetPath || "未知路径",
            error: fileError.message || "处理文件时出错",
          });
        }
      }

      try {
        await clearDirectoryCache({ mountId: mount.id });
        console.log(`批量复制完成后缓存已刷新：挂载点=${mount.id}, 共处理了${results.success.length}个文件`);
      } catch (cacheError) {
        console.warn(`执行缓存清理时出错: ${cacheError.message}`);
      }

      const hasFailures = results.failed.length > 0;
      const hasSuccess = results.success.length > 0;
      const overallSuccess = hasSuccess;

      return c.json({
        code: overallSuccess ? ApiStatus.SUCCESS : ApiStatus.ACCEPTED,
        message: "FILE_COPY_SUCCESS",
        data: {
          ...results,
          crossStorage: true,
        },
        success: overallSuccess,
      });
    } catch (error) {
      console.error("提交批量复制完成错误:", error);
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "提交批量复制完成失败" });
    }
  });
};
