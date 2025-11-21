import XHRUpload from "@uppy/xhr-upload";
import { createCapabilities, STORAGE_STRATEGIES } from "../types.js";
import { getFullApiUrl } from "@/api/config.js";
import { buildAuthHeadersForRequest } from "@/modules/security/index.js";

/**
 * WebDAV 存储驱动（前端）
 * - 仅支持后端直传 /fs/upload，禁用预签名与分片
 * - share/url 上传暂不支持，直接抛出错误
 */
export class WebDavDriver {
  constructor(config = {}) {
    this.config = config;
    this.capabilities = createCapabilities({
      share: {
        direct: false,
        url: false,
      },
      fs: {
        backendDirect: true,
        presignedSingle: false,
        multipart: false,
      },
    });

    this.share = {
      applyShareUploader: () => {
        throw new Error("WebDAV 暂不支持分享上传");
      },
      applyUrlUploader: () => {
        throw new Error("WebDAV 暂不支持外链拉取上传");
      },
    };

    this.fs = {
      applyFsUploader: this.applyFsUploader.bind(this),
    };
  }

  get storageConfigId() {
    return this.config?.id ?? null;
  }

  /**
   * WebDAV 仅支持后端直传：通过 /fs/upload 由后端完成 PUT
   */
  applyFsUploader(uppy, { path } = {}) {
    if (!uppy) {
      throw new Error("applyFsUploader 需要提供 Uppy 实例");
    }

    const headers = buildAuthHeadersForRequest({});
    try {
      uppy.setMeta({ path: path || "/", use_multipart: "false" });
    } catch {}

    uppy.use(XHRUpload, {
      id: "WebDavBackendDirect",
      endpoint: getFullApiUrl("/fs/upload"),
      method: "POST",
      formData: true,
      fieldName: "file",
      limit: 3,
      allowedMetaFields: ["path", "use_multipart"],
      headers,
    });

    return {
      adapter: null,
      mode: STORAGE_STRATEGIES.S3_BACKEND_DIRECT,
    };
  }
}
