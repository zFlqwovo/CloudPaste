import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../constants/index.js";
import { FileShareService } from "../services/fileShareService.js";
import { getQueryBool, getQueryInt } from "../utils/common.js";
import { getEncryptionSecret } from "../utils/environmentUtils.js";
import { usePolicy } from "../security/policies/policies.js";
import { resolvePrincipal } from "../security/helpers/principal.js";

const app = new Hono();
const requireS3Upload = usePolicy("s3.upload");

app.post("/api/s3/presign", requireS3Upload, async (c) => {
  const db = c.env.DB;

  try {
    const { userId, type: authType } = resolvePrincipal(c, { allowedTypes: ["admin", "apikey"] });
    const body = await c.req.json();

    if (!body.s3_config_id) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "必须提供 s3_config_id" });
    }

    if (!body.filename) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "必须提供 filename" });
    }

    const shareService = new FileShareService(db, getEncryptionSecret(c));
    const result = await shareService.createPresignedUpload(body.s3_config_id, body.filename, userId, authType, {
      fileSize: body.size,
      slug: body.slug,
      override: body.override,
      customPath: body.path,
      remark: body.remark,
      password: body.password,
      expires_in: body.expires_in,
      max_views: body.max_views,
      use_proxy: body.use_proxy,
    });

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "获取预签名URL成功",
      data: result,
      success: true,
    });
  } catch (error) {
    console.error("获取预签名URL错误:", error);
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: `获取预签名URL失败: ${error.message}` });
  }
});

app.post("/api/s3/commit", requireS3Upload, async (c) => {
  const db = c.env.DB;

  try {
    const { userId, type: authType } = resolvePrincipal(c, { allowedTypes: ["admin", "apikey"] });
    const body = await c.req.json();

    if (!body.file_id) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少文件ID参数" });
    }

    if (!body.etag) {
      console.warn(`文件提交时未提供ETag: ${body.file_id}，前端可能受CORS限制`);
    }

    const shareService = new FileShareService(db, getEncryptionSecret(c));
    const result = await shareService.commitUpload(
      body.file_id,
      {
        size: body.size,
        etag: body.etag,
      },
      userId,
      authType
    );

    if (body.password || body.expires_in || body.max_views || body.remark) {
      console.warn("commit阶段收到业务参数（应在presign处理）", {
        hasPassword: !!body.password,
        hasExpiresIn: !!body.expires_in,
        hasMaxViews: !!body.max_views,
        hasRemark: !!body.remark,
      });
    }

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "文件提交成功",
      data: result,
      success: true,
    });
  } catch (error) {
    console.error("提交文件错误:", error);
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: `提交文件失败: ${error.message}` });
  }
});

app.put("/api/upload-direct/:filename", requireS3Upload, async (c) => {
  try {
    const db = c.env.DB;
    const filename = c.req.param("filename");
    const { userId, type: authType } = resolvePrincipal(c, { allowedTypes: ["admin", "apikey"] });
    const fileContent = await c.req.arrayBuffer();
    const fileSize = fileContent.byteLength;

    const params = {
      s3_config_id: c.req.query("s3_config_id"),
      slug: c.req.query("slug"),
      path: c.req.query("path") || "",
      remark: c.req.query("remark") || "",
      password: c.req.query("password"),
      expires_in: getQueryInt(c, "expires_in", 0),
      max_views: getQueryInt(c, "max_views", 0),
      override: getQueryBool(c, "override", false),
      original_filename: getQueryBool(c, "original_filename", false),
      use_proxy: getQueryBool(c, "use_proxy", true) ? 1 : 0,
    };

    if (!params.s3_config_id) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "必须提供 s3_config_id" });
    }

    const shareService = new FileShareService(db, getEncryptionSecret(c));
    const result = await shareService.uploadDirectComplete(filename, fileContent, fileSize, userId, authType, params);

    const { fileRecord, config } = result;
    const { generatePresignedUrl } = await import("../utils/s3Utils.js");
    const { getMimeTypeFromFilename } = await import("../utils/fileUtils.js");
    const contentType = getMimeTypeFromFilename(filename);
    const isAdmin = authType === "admin";
    const encryptionSecret = getEncryptionSecret(c);

    const previewDirectUrl = await generatePresignedUrl(config, fileRecord.storage_path, encryptionSecret, null, false, contentType, { enableCache: false });
    const downloadDirectUrl = await generatePresignedUrl(config, fileRecord.storage_path, encryptionSecret, null, true, contentType, { enableCache: false });

    const baseUrl = c.req.url.split("/api/")[0];
    const previewProxyUrl = `${baseUrl}/api/file-view/${fileRecord.slug}`;
    const downloadProxyUrl = `${baseUrl}/api/file-download/${fileRecord.slug}`;
    const previewProxyUrlWithPassword = params.password ? `${previewProxyUrl}?password=${encodeURIComponent(params.password)}` : previewProxyUrl;
    const downloadProxyUrlWithPassword = params.password ? `${downloadProxyUrl}?password=${encodeURIComponent(params.password)}` : downloadProxyUrl;

    let expiresAt = null;
    if (params.expires_in > 0) {
      const expiryDate = new Date();
      expiryDate.setHours(expiryDate.getHours() + params.expires_in);
      expiresAt = expiryDate.toISOString();
    }

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "文件上传成功",
      data: {
        id: fileRecord.id,
        slug: fileRecord.slug,
        filename,
        mimetype: contentType,
        size: fileSize,
        remark: params.remark,
        created_at: new Date().toISOString(),
        requires_password: !!params.password,
        views: 0,
        max_views: params.max_views > 0 ? params.max_views : null,
        expires_at: expiresAt,
        previewUrl: params.use_proxy ? previewProxyUrlWithPassword : previewDirectUrl,
        downloadUrl: params.use_proxy ? downloadProxyUrlWithPassword : downloadDirectUrl,
        s3_direct_preview_url: previewDirectUrl,
        s3_direct_download_url: downloadDirectUrl,
        proxy_preview_url: previewProxyUrlWithPassword,
        proxy_download_url: downloadProxyUrlWithPassword,
        use_proxy: params.use_proxy,
        created_by: isAdmin ? userId : `apikey:${userId}`,
        used_original_filename: params.original_filename,
      },
      success: true,
    });
  } catch (error) {
    console.error("直接上传文件错误:", error);

    const message = error.message || "上传文件失败";
    if (message.includes("链接后缀已被占用")) {
      throw new HTTPException(ApiStatus.CONFLICT, { message });
    }
    if (message.includes("API密钥用户只能使用公开")) {
      throw new HTTPException(ApiStatus.FORBIDDEN, { message });
    }
    if (message.includes("没有可用的S3配置")) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message });
    }
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: `上传文件失败: ${message}` });
  }
});

export default app;
