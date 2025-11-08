import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../../constants/index.js";
import { authGateway } from "../../middlewares/authGatewayMiddleware.js";
import { useRepositories } from "../../utils/repositories.js";
import { FileShareService } from "../../services/fileShareService.js";

export const registerUrlMultipartRoutes = (router) => {
  router.post("/api/url/multipart/init", authGateway.requireFile(), async (c) => {
    const db = c.env.DB;
    const isAdmin = authGateway.utils.isAdmin(c);
    const userId = authGateway.utils.getUserId(c);
    const authType = authGateway.utils.getAuthType(c);

    try {
      const body = await c.req.json();

      if (!body.url) {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少URL参数" });
      }

      if (!body.s3_config_id) {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少S3配置ID参数" });
      }

      const repositoryFactory = useRepositories(c);
      const s3ConfigRepository = repositoryFactory.getS3ConfigRepository();

      let s3Config;
      if (isAdmin) {
        s3Config = await s3ConfigRepository.findByIdAndAdmin(body.s3_config_id, userId);
      } else {
        s3Config = await s3ConfigRepository.findPublicById(body.s3_config_id);
      }

      if (!s3Config) {
        throw new HTTPException(ApiStatus.NOT_FOUND, { message: "指定的S3配置不存在或无权访问" });
      }

      const encryptionSecret = c.env.ENCRYPTION_SECRET || "default-encryption-key";
      const shareService = new FileShareService(db, encryptionSecret);
      let metadata;

      if (body.metadata && body.metadata.filename && body.metadata.contentType) {
        metadata = body.metadata;
        metadata.url = body.url;
      } else {
        metadata = await shareService.validateUrlMetadata(body.url);
      }

      if (body.filename) {
        metadata.filename = body.filename;
      }

      const options = {
        storageConfigId: body.s3_config_id,
        slug: body.slug || null,
        remark: body.remark || null,
        customPath: body.path || null,
        password: body.password || null,
        expires_in: body.expires_in || null,
        max_views: body.max_views || null,
        partSize: body.part_size || null,
        partCount: body.part_count || null,
        override: body.override || false,
        use_proxy: body.use_proxy,
      };

      const result = await shareService.initializeUrlMultipartUpload(body.url, metadata, userId, authType, options);

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "分片上传初始化成功",
        data: result,
        success: true,
      });
    } catch (error) {
      console.error("初始化分片上传错误:", error);

      let statusCode = ApiStatus.INTERNAL_ERROR;
      if (error.message.includes("无效的URL") || error.message.includes("仅支持HTTP")) {
        statusCode = ApiStatus.BAD_REQUEST;
      } else if (error.message.includes("无法访问")) {
        statusCode = ApiStatus.BAD_REQUEST;
      } else if (error.message.includes("S3配置不存在")) {
        statusCode = ApiStatus.NOT_FOUND;
      } else if (error.message.includes("自定义链接")) {
        statusCode = ApiStatus.BAD_REQUEST;
      }

      throw new HTTPException(statusCode, { message: error.message });
    }
  });

  router.post("/api/url/multipart/complete", authGateway.requireFile(), async (c) => {
    const db = c.env.DB;
    const isAdmin = authGateway.utils.isAdmin(c);
    const userId = authGateway.utils.getUserId(c);
    const authType = authGateway.utils.getAuthType(c);

    try {
      const body = await c.req.json();

      if (!body.file_id) {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少文件ID参数" });
      }

      if (!body.parts) {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少分片列表参数" });
      }

      if (!body.upload_id) {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少上传ID参数" });
      }

      const repositoryFactory = useRepositories(c);
      const fileRepository = repositoryFactory.getFileRepository();
      const file = await fileRepository.findById(body.file_id);

      if (!file) {
        throw new HTTPException(ApiStatus.NOT_FOUND, { message: "文件不存在或已被删除" });
      }

      if (isAdmin && file.created_by && file.created_by !== userId) {
        throw new HTTPException(ApiStatus.FORBIDDEN, { message: "您无权完成此文件的上传" });
      }

      if (authType === "apikey" && file.created_by && file.created_by !== `apikey:${userId}`) {
        throw new HTTPException(ApiStatus.FORBIDDEN, { message: "此API密钥无权完成此文件的上传" });
      }

      const encryptionSecret = c.env.ENCRYPTION_SECRET || "default-encryption-key";
      const shareService = new FileShareService(db, encryptionSecret);
      const result = await shareService.completeUrlMultipartUpload(body.file_id, body.upload_id, body.parts, userId, authType);

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "分片上传已完成",
        data: result,
        success: true,
      });
    } catch (error) {
      console.error("完成分片上传错误:", error);

      let statusCode = ApiStatus.INTERNAL_ERROR;
      if (error.message.includes("文件不存在")) {
        statusCode = ApiStatus.NOT_FOUND;
      } else if (error.message.includes("无效的分片信息")) {
        statusCode = ApiStatus.BAD_REQUEST;
      }

      throw new HTTPException(statusCode, { message: error.message });
    }
  });

  router.post("/api/url/multipart/abort", authGateway.requireFile(), async (c) => {
    const db = c.env.DB;
    const isAdmin = authGateway.utils.isAdmin(c);
    const userId = authGateway.utils.getUserId(c);
    const authType = authGateway.utils.getAuthType(c);

    try {
      const body = await c.req.json();

      if (!body.file_id) {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少文件ID参数" });
      }

      if (!body.upload_id) {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少上传ID参数" });
      }

      const repositoryFactory = useRepositories(c);
      const fileRepository = repositoryFactory.getFileRepository();
      const file = await fileRepository.findById(body.file_id);

      if (!file) {
        throw new HTTPException(ApiStatus.NOT_FOUND, { message: "文件不存在或已被删除" });
      }

      if (isAdmin && file.created_by && file.created_by !== userId) {
        throw new HTTPException(ApiStatus.FORBIDDEN, { message: "您无权终止此文件的上传" });
      }

      if (authType === "apikey" && file.created_by && file.created_by !== `apikey:${userId}`) {
        throw new HTTPException(ApiStatus.FORBIDDEN, { message: "此API密钥无权终止此文件的上传" });
      }

      const encryptionSecret = c.env.ENCRYPTION_SECRET || "default-encryption-key";
      const shareService = new FileShareService(db, encryptionSecret);
      const result = await shareService.abortUrlMultipartUpload(body.file_id, body.upload_id, userId, authType);

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "分片上传已终止",
        data: result,
        success: true,
      });
    } catch (error) {
      console.error("终止分片上传错误:", error);

      let statusCode = ApiStatus.INTERNAL_ERROR;
      if (error.message.includes("文件不存在")) {
        statusCode = ApiStatus.NOT_FOUND;
      }

      throw new HTTPException(statusCode, { message: error.message });
    }
  });
};
