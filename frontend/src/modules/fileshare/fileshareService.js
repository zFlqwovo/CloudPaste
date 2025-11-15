import {
  listSharedFiles,
  getSharedFileById,
  getSharedFileBySlug,
  buildDownloadUrl as gatewayBuildDownloadUrl,
  buildPreviewUrl as gatewayBuildPreviewUrl,
  getOfficePreviewUrl as gatewayGetOfficePreviewUrl,
} from "@/api/services/fileGateway.js";
import {
  updateFile as apiUpdateFile,
  batchDeleteFiles as apiBatchDeleteFiles,
  verifyFilePassword as apiVerifyFilePassword,
} from "@/api/services/fileService.js";

/**
 * Fileshare 领域服务
 *
 * 职责：
 * - 对 fileGateway 提供的低层 API 进行领域级封装
 * - 统一列表 / 搜索 / 单条获取 / 永久链接 / Office 预览等逻辑
 *
 * 不负责：
 * - UI 文案和 DOM 操作（复制剪贴板、window.open 等）
 */
export function useFileshareService() {
  /**
   * 获取分享文件列表（支持搜索）
   *
   * @param {Object} options
   * @param {number} options.limit
   * @param {number} options.offset
   * @param {string} [options.search]
   */
  const fetchList = async ({ limit, offset, search } = {}) => {
    const listOptions = {};
    if (search && search.trim().length > 0) {
      listOptions.search = search.trim();
    }
    // listSharedFiles 已经在 fileGateway 中做了 success 检查并抛错，
    // 这里统一封装为 { files, pagination } 结构
    return await listSharedFiles(limit, offset, listOptions);
  };

  /**
   * 根据 id 获取单个分享文件详情
   */
  const fetchById = async (id) => {
    if (!id) {
      throw new Error("缺少文件 ID");
    }
    return await getSharedFileById(id);
  };

  /**
   * 根据 slug 获取公开分享文件详情
   */
  const fetchBySlug = async (slug) => {
    if (!slug) {
      throw new Error("缺少文件 slug");
    }
    return await getSharedFileBySlug(slug);
  };

  /**
   * 获取永久下载链接
   */
  const getPermanentDownloadUrl = (file) => {
    if (!file || !file.slug) return "";
    return gatewayBuildDownloadUrl(file);
  };

  /**
   * 获取永久预览链接
   */
  const getPermanentPreviewUrl = (file) => {
    if (!file || !file.slug) return "";
    return gatewayBuildPreviewUrl(file);
  };

  /**
   * 获取 Office 预览 URL（使用默认 provider）
   */
  const getOfficePreviewUrl = async (file, options = {}) => {
    if (!file?.slug) return null;
    return await gatewayGetOfficePreviewUrl(file, {
      provider: options.provider || "microsoft",
      returnAll: options.returnAll || false,
    });
  };

  /**
   * 构造前端使用的分享页 URL（/file/:slug）
   *
   * @param {Object} file - 包含 slug 的文件对象
   * @param {string} [origin] - 可选的 origin（例如 window.location.origin），默认使用当前环境
   */
  const buildShareUrl = (file, origin) => {
    if (!file || !file.slug) return "";
    const base =
      typeof origin === "string" && origin.length
        ? origin
        : typeof window !== "undefined"
        ? window.location.origin
        : "";
    if (!base) return `/file/${file.slug}`;
    const normalized = base.replace(/\/+$/, "");
    return `${normalized}/file/${file.slug}`;
  };

  /**
   * 更新文件元数据（用于修改 slug、备注、过期时间等）
   */
  const updateFileMetadata = async (fileId, metadata) => {
    if (!fileId) {
      throw new Error("缺少文件 ID");
    }
    const resp = await apiUpdateFile(fileId, metadata);
    if (resp && typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "更新文件信息失败");
      }
      return resp.data ?? true;
    }
    return true;
  };

  /**
   * 批量删除文件（供 admin/public 视图复用）
   */
  const deleteFiles = async (ids, deleteMode) => {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error("缺少要删除的文件 ID 列表");
    }
    const resp = await apiBatchDeleteFiles(ids, deleteMode);
    if (!resp) {
      throw new Error("删除文件失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "删除文件失败");
      }
    }
    return resp;
  };

  /**
   * 验证受保护分享文件的访问密码
   */
  const verifyFilePassword = async (slug, password) => {
    if (!slug || !password) {
      throw new Error("缺少文件标识或密码");
    }
    const resp = await apiVerifyFilePassword(slug, password);
    if (!resp) {
      throw new Error("验证文件密码失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "验证文件密码失败");
      }
      return resp.data ?? true;
    }
    return resp;
  };

  return {
    fetchList,
    fetchById,
    fetchBySlug,
    getPermanentDownloadUrl,
    getPermanentPreviewUrl,
    getOfficePreviewUrl,
    buildShareUrl,
    updateFileMetadata,
    deleteFiles,
    verifyFilePassword,
  };
}
