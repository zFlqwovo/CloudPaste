import { api } from "@/api";

/**
 * Admin 存储配置 Service
 *
 * 职责：
 * - 封装存储配置的读取 / 新建 / 更新 / 测试
 *
 * 约定：
 * - 成功：返回领域数据（列表 / 单个配置 / 测试结果）
 * - 失败：抛出 Error，由上层统一处理
 */
export function useAdminStorageConfigService() {
  /**
   * 获取存储配置列表（分页）
   * @param {{page?:number,limit?:number}} params
   * @returns {Promise<{items:any[],pagination:{page:number,limit:number,total:number}}>} 
   */
  const getStorageConfigs = async (params = {}) => {
    const resp = await api.admin.getStorageConfigs(params);
    if (!resp) {
      throw new Error("加载存储配置列表失败");
    }

    let payload = resp;
    let total = resp?.total;

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "加载存储配置列表失败");
      }
      payload = resp.data ?? resp;
      if (typeof resp.total === "number") {
        total = resp.total;
      }
    }

    // 尽可能从常见字段中提取列表
    let dataBlock = payload;
    if (!Array.isArray(dataBlock)) {
      dataBlock =
        payload?.data && Array.isArray(payload.data) ? payload.data :
        payload?.items && Array.isArray(payload.items) ? payload.items :
        payload?.records && Array.isArray(payload.records) ? payload.records :
        payload?.data?.items && Array.isArray(payload.data.items) ? payload.data.items :
        payload;
    }

    const items = Array.isArray(dataBlock) ? dataBlock : [];

    if (typeof total !== "number") {
      total =
        typeof payload?.total === "number"
          ? payload.total
          : items.length;
    }

    const page = typeof params.page === "number" ? params.page : 1;
    const limit = typeof params.limit === "number" ? params.limit : items.length || 10;

    return {
      items,
      pagination: {
        page,
        limit,
        total,
      },
    };
  };

  /**
   * 获取单个存储配置（可揭示密钥）
   * @param {number|string} id
   * @param {"masked"|"plain"} mode
   * @returns {Promise<Object>} 存储配置对象
   */
  const getStorageConfigReveal = async (id, mode = "masked") => {
    const resp = await api.storage.getStorageConfigReveal(id, mode);
    if (!resp) {
      throw new Error("获取存储配置失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "获取存储配置失败");
      }
      return resp.data ?? resp;
    }
    return resp;
  };

  /**
   * 创建存储配置
   * @param {Object} data
   * @returns {Promise<Object>} 新建的配置对象
   */
  const createStorageConfig = async (data) => {
    const resp = await api.admin.createStorageConfig(data);
    if (!resp) {
      throw new Error("创建存储配置失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "创建存储配置失败");
      }
      return resp.data ?? data;
    }
    return resp;
  };

  /**
   * 更新存储配置
   * @param {number|string} id
   * @param {Object} data
   * @returns {Promise<Object>} 更新后的配置对象
   */
  const updateStorageConfig = async (id, data) => {
    const resp = await api.admin.updateStorageConfig(id, data);
    if (!resp) {
      throw new Error("更新存储配置失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "更新存储配置失败");
      }
      return resp.data ?? { id, ...data };
    }
    return resp;
  };

  /**
   * 删除存储配置
   * @param {number|string} id
   * @returns {Promise<true>}
   */
  const deleteStorageConfig = async (id) => {
    const resp = await api.admin.deleteStorageConfig(id);
    if (!resp) {
      throw new Error("删除存储配置失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "删除存储配置失败");
      }
    }
    return true;
  };

  /**
   * 设置默认存储配置
   * @param {number|string} id
   * @returns {Promise<true>}
   */
  const setDefaultStorageConfig = async (id) => {
    const resp = await api.admin.setDefaultStorageConfig(id);
    if (!resp) {
      throw new Error("设置默认存储配置失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "设置默认存储配置失败");
      }
    }
    return true;
  };

  /**
   * 测试存储配置连接
   * @param {number|string} id
   * @returns {Promise<Object>} 测试结果对象
   */
  const testStorageConfig = async (id) => {
    const resp = await api.admin.testStorageConfig(id);
    if (!resp) {
      throw new Error("测试存储配置失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "测试存储配置失败");
      }
      // 优先返回 data.result，其次 data 本身
      return resp.data?.result ?? resp.data ?? {};
    }
    return resp.result ?? resp.data?.result ?? resp;
  };

  return {
    getStorageConfigs,
    getStorageConfigReveal,
    createStorageConfig,
    updateStorageConfig,
    deleteStorageConfig,
    setDefaultStorageConfig,
    testStorageConfig,
  };
}
