import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../../constants/index.js";
import { authGateway } from "../../middlewares/authGatewayMiddleware.js";
import { FileShareService } from "../../services/fileShareService.js";

export const registerUrlPresignRoutes = (router) => {
  router.post("/api/url/presign", authGateway.requireFile(), async (c) => {
    const db = c.env.DB;

    try {
      const userId = authGateway.utils.getUserId(c);
      const authType = authGateway.utils.getAuthType(c);
      const body = await c.req.json();

      if (!body.url) {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少URL参数" });
      }

      if (!body.s3_config_id) {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少S3配置ID参数" });
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
        use_proxy: body.use_proxy,
      };

      const uploadInfo = await shareService.createUrlUpload(body.url, metadata, userId, authType, options);

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "URL上传准备就绪",
        data: uploadInfo,
        success: true,
      });
    } catch (error) {
      console.error("URL上传准备错误:", error);

      let statusCode = ApiStatus.INTERNAL_ERROR;
      if (error.message.includes("无效的URL") || error.message.includes("仅支持HTTP")) {
        statusCode = ApiStatus.BAD_REQUEST;
      } else if (error.message.includes("无法访问")) {
        statusCode = ApiStatus.BAD_REQUEST;
      } else if (error.message.includes("S3配置不存在")) {
        statusCode = ApiStatus.NOT_FOUND;
      }

      throw new HTTPException(statusCode, { message: error.message });
    }
  });

  router.post("/api/url/commit", authGateway.requireFile(), async (c) => {
    const db = c.env.DB;

    try {
      const userId = authGateway.utils.getUserId(c);
      const authType = authGateway.utils.getAuthType(c);
      const body = await c.req.json();

      if (!body.file_id) {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少文件ID参数" });
      }

      if (!body.etag) {
        console.warn(`URL上传提交时未提供ETag: ${body.file_id}，可能是由于CORS限制导致前端无法获取ETag响应头`);
      }

      const encryptionSecret = c.env.ENCRYPTION_SECRET || "default-encryption-key";
      const shareService = new FileShareService(db, encryptionSecret);
      const uploadResult = {
        etag: body.etag || null,
        size: body.size ? parseInt(body.size) : null,
        slug: body.slug || null,
        remark: body.remark || null,
        password: body.password || null,
        expires_in: body.expires_in || null,
        max_views: body.max_views || null,
      };

      const result = await shareService.commitUpload(body.file_id, uploadResult, userId, authType);

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "文件提交成功",
        data: result,
        success: true,
      });
    } catch (error) {
      console.error("提交文件错误:", error);
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: `提交文件失败: ${error.message}` });
    }
  });
};
