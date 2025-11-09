import { HTTPException } from "hono/http-exception";
import { ApiStatus, UserType } from "../../constants/index.js";
import { FileShareService } from "../../services/fileShareService.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { usePolicy } from "../../security/policies/policies.js";
import { resolvePrincipal } from "../../security/helpers/principal.js";

const requireUrlUpload = usePolicy("urlupload.manage");

export const registerUrlPresignRoutes = (router) => {
  router.post("/api/url/presign", requireUrlUpload, async (c) => {
    const db = c.env.DB;

  const { userId, type: authType } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
    const body = await c.req.json();

    if (!body.url) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少URL参数" });
    }

    if (!body.s3_config_id) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少S3配置ID参数" });
    }

    const encryptionSecret = getEncryptionSecret(c);
    const shareService = new FileShareService(db, encryptionSecret);
    let metadata;

    if (body.metadata && body.metadata.filename && body.metadata.contentType) {
      metadata = { ...body.metadata, url: body.url };
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
  });

  router.post("/api/url/commit", requireUrlUpload, async (c) => {
    const db = c.env.DB;

  const { userId, type: authType } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
    const body = await c.req.json();

    if (!body.file_id) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少文件ID参数" });
    }

    if (!body.etag) {
      console.warn(`URL上传提交时未提供ETag: ${body.file_id}，可能是由于CORS限制导致前端无法获取ETag响应头`);
    }

    const encryptionSecret = getEncryptionSecret(c);
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
  });
};
