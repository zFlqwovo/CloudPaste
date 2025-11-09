import { HTTPException } from "hono/http-exception";
import { ApiStatus, UserType } from "../../constants/index.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { useRepositories } from "../../utils/repositories.js";
import { FileShareService } from "../../services/fileShareService.js";
import { usePolicy } from "../../security/policies/policies.js";
import { resolvePrincipal } from "../../security/helpers/principal.js";

const requireUrlUpload = usePolicy("urlupload.manage");

export const registerUrlMultipartRoutes = (router) => {
  router.post("/api/url/multipart/init", requireUrlUpload, async (c) => {
    const db = c.env.DB;
    const identity = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
    const isAdmin = identity.isAdmin;
    const userId = identity.userId;
    const authType = identity.type;

    const body = await c.req.json();

    if (!body.url) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少URL参数" });
    }

    if (!body.s3_config_id) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少S3配置ID参数" });
    }

    const repositoryFactory = useRepositories(c);
    const s3ConfigRepository = repositoryFactory.getS3ConfigRepository();

    const s3Config = isAdmin
      ? await s3ConfigRepository.findByIdAndAdmin(body.s3_config_id, userId)
      : await s3ConfigRepository.findPublicById(body.s3_config_id);

    if (!s3Config) {
      throw new HTTPException(ApiStatus.NOT_FOUND, { message: "指定的S3配置不存在或无权访问" });
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
  });

  router.post("/api/url/multipart/complete", requireUrlUpload, async (c) => {
    const db = c.env.DB;
    const identity = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
    const isAdmin = identity.isAdmin;
    const userId = identity.userId;
    const authType = identity.type;

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

    if (authType === UserType.API_KEY && file.created_by && file.created_by !== `apikey:${userId}`) {
      throw new HTTPException(ApiStatus.FORBIDDEN, { message: "此API密钥无权完成此文件的上传" });
    }

    const encryptionSecret = getEncryptionSecret(c);
    const shareService = new FileShareService(db, encryptionSecret);
    const result = await shareService.completeUrlMultipartUpload(body.file_id, body.upload_id, body.parts, userId, authType);

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "分片上传已完成",
      data: result,
      success: true,
    });
  });

  router.post("/api/url/multipart/abort", requireUrlUpload, async (c) => {
    const db = c.env.DB;
    const identity = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
    const isAdmin = identity.isAdmin;
    const userId = identity.userId;
    const authType = identity.type;

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

    if (authType === UserType.API_KEY && file.created_by && file.created_by !== `apikey:${userId}`) {
      throw new HTTPException(ApiStatus.FORBIDDEN, { message: "此API密钥无权终止此文件的上传" });
    }

    const encryptionSecret = getEncryptionSecret(c);
    const shareService = new FileShareService(db, encryptionSecret);
    const result = await shareService.abortUrlMultipartUpload(body.file_id, body.upload_id, userId, authType);

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "分片上传已终止",
      data: result,
      success: true,
    });
  });
};
