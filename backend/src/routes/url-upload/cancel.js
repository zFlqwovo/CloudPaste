import { HTTPException } from "hono/http-exception";
import { ApiStatus, UserType } from "../../constants/index.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { useRepositories } from "../../utils/repositories.js";
import { deleteFileFromS3 } from "../../utils/s3Utils.js";
import { invalidateFsCache } from "../../cache/invalidation.js";
import { usePolicy } from "../../security/policies/policies.js";
import { resolvePrincipal } from "../../security/helpers/principal.js";

const requireUrlUpload = usePolicy("urlupload.manage");

export const registerUrlCancelRoutes = (router) => {
  router.post("/api/url/cancel", requireUrlUpload, async (c) => {
    const db = c.env.DB;

    const identity = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
    const isAdmin = identity.isAdmin;
    const userId = identity.userId;
    const authType = identity.type;

    let authorizedBy = "";
    let adminId = null;
    let apiKeyId = null;

    if (isAdmin) {
      authorizedBy = "admin";
      adminId = userId;
    } else if (authType === UserType.API_KEY) {
      authorizedBy = UserType.API_KEY;
      apiKeyId = userId;
    } else {
      throw new HTTPException(ApiStatus.FORBIDDEN, { message: "需要管理员权限或有效的API密钥才能取消URL上传" });
    }

    const body = await c.req.json();

    if (!body.file_id) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少文件ID参数" });
    }

    const repositoryFactory = useRepositories(c);
    const fileRepository = repositoryFactory.getFileRepository();
    const file = await fileRepository.findById(body.file_id);

    if (!file) {
      throw new HTTPException(ApiStatus.NOT_FOUND, { message: "文件不存在或已被删除" });
    }

    if (authorizedBy === "admin" && file.created_by && file.created_by !== adminId) {
      throw new HTTPException(ApiStatus.FORBIDDEN, { message: "您无权取消此文件的上传" });
    }

    if (authorizedBy === UserType.API_KEY && file.created_by && file.created_by !== `apikey:${apiKeyId}`) {
      throw new HTTPException(ApiStatus.FORBIDDEN, { message: "此API密钥无权取消此文件的上传" });
    }

    const s3ConfigRepository = repositoryFactory.getS3ConfigRepository();
    let s3Config = null;
    if (file.storage_type === "S3") {
      s3Config = await s3ConfigRepository.findById(file.storage_config_id);
    }

    if (file.storage_type === "S3" && s3Config) {
      const encryptionSecret = getEncryptionSecret(c);
      await deleteFileFromS3(s3Config, file.storage_path, encryptionSecret)
        .then(() => {
          console.log(`已从S3删除文件: ${file.storage_path}`);
        })
        .catch((s3Error) => {
          console.error(`从S3删除文件失败: ${s3Error.message}`);
        });
    } else if (file.storage_type === "S3" && !s3Config) {
      console.warn(`找不到S3配置(ID=${file.storage_config_id})，仅删除文件记录`);
    }

    await fileRepository.deleteFilePasswordRecord(file.id);
    await fileRepository.deleteFile(file.id);

    invalidateFsCache({ s3ConfigId: file.s3_config_id, reason: "url-upload-cancel", db });

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "URL上传已成功取消",
      data: {
        file_id: file.id,
        status: "cancelled",
        message: "文件记录已被删除",
      },
      success: true,
    });
  });
};
