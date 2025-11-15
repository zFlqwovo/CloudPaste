import { api } from "@/api";
import { useAuthStore } from "@/stores/authStore.js";

/**
 * Paste 领域 service
 *
 * 职责：
 * - 统一封装与文本分享相关的 API 调用
 * - 根据当前认证状态（管理员 / API Key 用户）选择合适的后端入口
 *
 * 约定：
 * - 成功时返回“领域数据”（数组 / 对象 / { items, pagination }）
 * - 失败时抛出 Error，由上层决定如何展示（toast / 表单错误等）
 */
export function usePasteService() {
  const authStore = useAuthStore();

  const isAdmin = () => authStore.isAdmin;
  const isApiKeyUser = () => authStore.authType === "apikey" && authStore.hasTextPermission;

  const ensureCanManage = () => {
    if (!isAdmin() && !isApiKeyUser()) {
      throw new Error("没有权限执行此操作");
    }
  };

  /**
   * 列表查询（offset 模式）
   * @param {Object} params
   * @param {number} [params.limit]
   * @param {number} [params.offset]
   * @param {string} [params.search]
   * @returns {Promise<{items: any[], pagination: {total:number,limit:number,offset:number,hasMore?:boolean}}>}
   */
  const getPastes = async ({ limit = 20, offset = 0, search } = {}) => {
    ensureCanManage();

    const options = {};
    if (search && search.trim()) {
      options.search = search.trim();
    }

    // 目前管理员与 API Key 文本用户走统一 /api/pastes endpoint
    const resp = await api.paste.getPastes(null, limit, offset, options);
    if (!resp || typeof resp !== "object" || resp.success !== true) {
      const message = resp && typeof resp === "object" && "message" in resp ? resp.message : null;
      throw new Error(message || "加载文本列表失败");
    }

    const payload = resp.data || {};
    const items = Array.isArray(payload.results) ? payload.results : [];
    const pagination = payload.pagination || {};

    const finalPagination = {
      total: typeof pagination.total === "number" ? pagination.total : items.length,
      limit: typeof pagination.limit === "number" ? pagination.limit : limit,
      offset: typeof pagination.offset === "number" ? pagination.offset : offset,
      hasMore: typeof pagination.hasMore === "boolean" ? pagination.hasMore : undefined,
    };

    return { items, pagination: finalPagination };
  };

  /**
   * 根据 ID 获取单条详情（区分 admin / apikey）
   * @param {string|number} id
   * @returns {Promise<Object>} paste 对象
   */
  const getPasteById = async (id) => {
    ensureCanManage();
    const resp = isAdmin() ? await api.admin.getPasteById(id) : await api.user.paste.getPasteById(id);
    if (!resp) {
      throw new Error("获取文本详情失败");
    }

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "获取文本详情失败");
      }
      return resp.data ?? resp;
    }

    return resp;
  };

  /**
   * 更新文本（区分 admin / apikey）
   * @param {string} slug
   * @param {Object} data
   * @returns {Promise<Object|true>} 更新后的 paste 或 true
   */
  const updatePaste = async (slug, data) => {
    ensureCanManage();
    const resp = isAdmin() ? await api.admin.updatePaste(slug, data) : await api.user.paste.updatePaste(slug, data);
    if (!resp) {
      throw new Error("更新文本失败");
    }

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "更新文本失败");
      }
      return resp.data ?? true;
    }

    return resp;
  };

  /**
   * 删除单个文本（底层仍使用批量删除 API）
   * @param {string|number} id
   * @returns {Promise<true>}
   */
  const deleteSinglePaste = async (id) => {
    ensureCanManage();
    const resp = isAdmin() ? await api.admin.batchDeletePastes([id]) : await api.user.paste.batchDeletePastes([id]);
    if (!resp) {
      throw new Error("删除文本失败");
    }

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "删除文本失败");
      }
    }

    return true;
  };

  /**
   * 批量删除文本
   * @param {Array<string|number>} ids
   * @returns {Promise<true>}
   */
  const deletePastes = async (ids) => {
    ensureCanManage();
    const resp = isAdmin() ? await api.admin.batchDeletePastes(ids) : await api.user.paste.batchDeletePastes(ids);
    if (!resp) {
      throw new Error("批量删除文本失败");
    }

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "批量删除文本失败");
      }
    }

    return true;
  };

  /**
   * 清理过期文本（仅管理员）
   * @returns {Promise<string>} 成功消息
   */
  const clearExpiredPastes = async () => {
    if (!isAdmin()) {
      throw new Error("只有管理员可以清理过期文本");
    }
    const resp = await api.system.clearExpiredPastes();
    if (!resp) {
      throw new Error("清理过期文本失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "清理过期文本失败");
      }
      return resp.message || "清理完成";
    }
    return "清理完成";
  };

  /**
   * 根据 slug 获取公开文本详情（支持密码）
   * 公开接口，不做权限限制，统一解包 { success, data } 协议
   */
  const getPasteBySlug = async (slug, password = null) => {
    const resp = await api.paste.getPaste(slug, password);
    if (!resp) {
      throw new Error("获取文本内容失败");
    }

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "获取文本内容失败");
      }
      return resp.data ?? resp;
    }

    return resp;
  };

  /**
   * 创建文本分享（Markdown 编辑器使用）
   * @returns {Promise<string>} 新建分享的 slug
   */
  const createPaste = async (data) => {
    ensureCanManage();
    const resp = await api.paste.createPaste(data);
    if (!resp) {
      throw new Error("创建文本分享失败");
    }

    // 兼容不同响应格式，统一提取 slug
    let slug = null;

    if (typeof resp === "object") {
      if ("success" in resp || "code" in resp) {
        if (resp.success && resp.data && resp.data.slug) {
          slug = resp.data.slug;
        } else {
          throw new Error(resp.message || "创建文本分享失败");
        }
      } else if (resp.slug) {
        slug = resp.slug;
      } else {
        const candidates = ["id", "key", "identifier"];
        for (const field of candidates) {
          if (resp[field]) {
            slug = resp[field];
            break;
          }
        }
      }
    }

    if (!slug) {
      throw new Error("创建文本分享失败：无法获取分享标识");
    }

    return slug;
  };

  /**
   * 获取原始文本直链
   */
  const getRawPasteUrl = (slug, password = null) => {
    return api.paste.getRawPasteUrl(slug, password);
  };

  /**
   * 获取 Markdown 相关设置（通过系统设置分组）
   * @returns {Promise<Array<{key:string,value:string}>>}
   */
  const getMarkdownSettings = async () => {
    const resp = await api.system.getSettingsByGroup(4, false);
    if (!resp) {
      throw new Error("获取 Markdown 设置失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "获取 Markdown 设置失败");
      }
      return Array.isArray(resp.data) ? resp.data : [];
    }
    return Array.isArray(resp) ? resp : [];
  };

  return {
    getPastes,
    getPasteById,
    updatePaste,
    deleteSinglePaste,
    deletePastes,
    clearExpiredPastes,
    getPasteBySlug,
    createPaste,
    getRawPasteUrl,
    getMarkdownSettings,
  };
}
