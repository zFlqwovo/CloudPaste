import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../../constants/index.js";
import {
  getAdminFileList,
  getAdminFileDetail,
  getUserFileList,
  getUserFileDetail,
  updateFile,
} from "../../services/fileService.js";
import { deleteFileFromS3 } from "../../utils/s3Utils.js";
import { clearDirectoryCache } from "../../cache/index.js";
import { useRepositories } from "../../utils/repositories.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { getPagination } from "../../utils/common.js";

export const registerFilesProtectedRoutes = (router, { unifiedAuth }) => {
  router.get("/api/files", unifiedAuth, async (c) => {
    const db = c.env.DB;
    const userType = c.get("userType");
    const userId = c.get("userId");
    const apiKeyInfo = c.get("apiKeyInfo");

    let result;

    if (userType === "admin") {
      const { limit, offset } = getPagination(c, { limit: 30 });
      const search = c.req.query("search");
      const createdBy = c.req.query("created_by");

      const options = { limit, offset };
      if (search) options.search = search;
      if (createdBy) options.createdBy = createdBy;

      result = await getAdminFileList(db, options);
    } else {
      const { limit, offset } = getPagination(c, { limit: 30 });
      const search = c.req.query("search");

      const options = { limit, offset };
      if (search) options.search = search;

      result = await getUserFileList(db, userId, options);
    }

    const response = {
      code: ApiStatus.SUCCESS,
      message: "获取文件列表成功",
      data: result,
      success: true,
    };

    if (userType === "apikey") {
      response.key_info = apiKeyInfo;
    }

    return c.json(response);
  });

  router.get("/api/files/:id", unifiedAuth, async (c) => {
    const db = c.env.DB;
    const userType = c.get("userType");
    const userId = c.get("userId");
    const { id } = c.req.param();
    const encryptionSecret = getEncryptionSecret(c);

    let result;
    if (userType === "admin") {
      result = await getAdminFileDetail(db, id, encryptionSecret, c.req.raw);
    } else {
      result = await getUserFileDetail(db, id, userId, encryptionSecret, c.req.raw);
    }

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "获取文件成功",
      data: result,
      success: true,
    });
  });

  router.delete("/api/files/batch-delete", unifiedAuth, async (c) => {
    const db = c.env.DB;
    const userType = c.get("userType");
    const userId = c.get("userId");
    const body = await c.req.json();
    const ids = body.ids;
    const deleteMode = body.delete_mode || "both";

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "请提供有效的文件ID数组" });
    }

    if (!["record_only", "both"].includes(deleteMode)) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "删除模式必须是 'record_only' 或 'both'" });
    }

    const result = { success: 0, failed: [] };
    const s3ConfigIds = new Set();
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = useRepositories(c);
    const fileRepository = repositoryFactory.getFileRepository();

    for (const id of ids) {
      try {
        let file;

        if (userType === "admin") {
          file = await fileRepository.findByIdWithStorageConfig(id);
          if (!file) {
            result.failed.push({ id, error: "文件不存在" });
            continue;
          }
        } else {
          file = await fileRepository.findByIdAndCreator(id, `apikey:${userId}`);
          if (!file) {
            result.failed.push({ id, error: "文件不存在或无权删除" });
            continue;
          }
        }

        if (file.storage_type === "S3" && file.storage_config_id) {
          s3ConfigIds.add(file.storage_config_id);
        }

        try {
          if (deleteMode === "both" && file.file_path) {
            const { MountManager } = await import("../../storage/managers/MountManager.js");
            const { FileSystem } = await import("../../storage/fs/FileSystem.js");

            const mountManager = new MountManager(db, encryptionSecret);
            const fileSystem = new FileSystem(mountManager);

            try {
              await fileSystem.batchRemoveItems([file.file_path], userType === "admin" ? userId : `apikey:${userId}`, userType);
            } catch (fsError) {
              console.error(`删除文件系统文件错误 (ID: ${id}):`, fsError);
            }
          }

          if (deleteMode === "both" && file.storage_path && file.bucket_name) {
            const s3Config = {
              id: file.id,
              endpoint_url: file.endpoint_url,
              bucket_name: file.bucket_name,
              region: file.region,
              access_key_id: file.access_key_id,
              secret_access_key: file.secret_access_key,
              path_style: file.path_style,
            };
            await deleteFileFromS3(s3Config, file.storage_path, encryptionSecret);
          }
        } catch (deleteError) {
          console.error(`删除文件错误 (ID: ${id}):`, deleteError);
        }

        if (userType === "admin") {
          await fileRepository.deleteFilePasswordRecord(id);
        }
        await fileRepository.deleteFile(id);

        result.success++;
      } catch (error) {
        console.error(`删除文件失败 (ID: ${id}):`, error);
        result.failed.push({ id, error: error.message || "删除失败" });
      }
    }

    try {
      for (const s3ConfigId of s3ConfigIds) {
        await clearDirectoryCache({ db, s3ConfigId });
      }
      console.log(`批量删除操作完成后缓存已刷新：${s3ConfigIds.size} 个S3配置`);
    } catch (cacheError) {
      console.warn(`执行缓存清理时出错: ${cacheError.message}`);
    }

    return c.json({
      code: ApiStatus.SUCCESS,
      message: `批量删除完成，成功: ${result.success}，失败: ${result.failed.length}`,
      data: result,
      success: true,
    });
  });

  router.put("/api/files/:id", unifiedAuth, async (c) => {
    const db = c.env.DB;
    const userType = c.get("userType");
    const userId = c.get("userId");
    const { id } = c.req.param();
    const body = await c.req.json();

    const result = await updateFile(db, id, body, { userType, userId });
    return c.json({
      code: ApiStatus.SUCCESS,
      message: result.message,
      success: true,
    });
  });
};
