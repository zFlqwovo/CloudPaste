import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../../constants/index.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { authGateway } from "../../middlewares/authGatewayMiddleware.js";
import { useRepositories } from "../../utils/repositories.js";
import { deleteFileFromS3 } from "../../utils/s3Utils.js";
import { clearDirectoryCache } from "../../cache/index.js";

export const registerUrlCancelRoutes = (router) => {
  router.post("/api/url/cancel", authGateway.requireFile(), async (c) => {
    const db = c.env.DB;

    const isAdmin = authGateway.utils.isAdmin(c);
    const userId = authGateway.utils.getUserId(c);
    const authType = authGateway.utils.getAuthType(c);

    let authorizedBy = "";
    let adminId = null;
    let apiKeyId = null;

    if (isAdmin) {
      authorizedBy = "admin";
      adminId = userId;
    } else if (authType === "apikey") {
      authorizedBy = "apikey";
      apiKeyId = userId;
    } else {
      throw new HTTPException(ApiStatus.FORBIDDEN, { message: "需要管理员权限或有效的API密钥才能取消URL上传" });
    }

    try {
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

      if (authorizedBy === "apikey" && file.created_by && file.created_by !== `apikey:${apiKeyId}`) {
        throw new HTTPException(ApiStatus.FORBIDDEN, { message: "此API密钥无权取消此文件的上传" });
      }

      const s3ConfigRepository = repositoryFactory.getS3ConfigRepository();
      let s3Config = null;
      if (file.storage_type === "S3") {
        s3Config = await s3ConfigRepository.findById(file.storage_config_id);
      }

      if (file.storage_type === "S3" && s3Config) {
        try {
          const encryptionSecret = getEncryptionSecret(c);
          await deleteFileFromS3(s3Config, file.storage_path, encryptionSecret);
          console.log(`已从S3删除文件: ${file.storage_path}`);
        } catch (s3Error) {
          console.error(`从S3删除文件失败: ${s3Error.message}`);
        }
      } else if (file.storage_type === "S3" && !s3Config) {
        console.warn(`找不到S3配置(ID=${file.storage_config_id})，仅删除文件记录`);
      }

      await fileRepository.deleteFilePasswordRecord(file.id);
      await fileRepository.deleteFile(file.id);

      try {
        await clearDirectoryCache({ db, s3ConfigId: file.s3_config_id });
      } catch (cacheError) {
        console.warn(`清除文件缓存失败: ${cacheError.message}`);
      }

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
    } catch (error) {
      console.error("取消URL上传错误:", error);

      let statusCode = ApiStatus.INTERNAL_ERROR;
      if (error.message.includes("文件不存在")) {
        statusCode = ApiStatus.NOT_FOUND;
      }

      throw new HTTPException(statusCode, { message: `取消URL上传失败: ${error.message}` });
    }
  });
};
