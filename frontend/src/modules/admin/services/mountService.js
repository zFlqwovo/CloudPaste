import { api } from "@/api";

/**
 * Admin 挂载配置 Service
 *
 * 职责：
 * - 封装挂载点增删改查（当前前端仅用到列表 / 创建 / 更新）
 *
 * 约定：
 * - 成功：返回领域数据（挂载点数组 / 单个挂载点 / true）
 * - 失败：抛出 Error，由上层统一处理
 */
export function useAdminMountService() {
  /**
   * 获取挂载点列表
   * @returns {Promise<Array>} 挂载点数组
   */
  const getMountsList = async () => {
    const resp = await api.mount.getMountsList();
    if (!resp) {
      throw new Error("获取挂载点列表失败");
    }

    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "获取挂载点列表失败");
      }
      const data = resp.data ?? resp.items ?? resp.records ?? [];
      return Array.isArray(data) ? data : [];
    }

    if (Array.isArray(resp)) {
      return resp;
    }
    if (Array.isArray(resp.data)) {
      return resp.data;
    }

    return [];
  };

  /**
   * 更新挂载点
   * @param {string|number} id
   * @param {Object} payload
   * @returns {Promise<Object>} 更新后的挂载点对象
   */
  const updateMount = async (id, payload) => {
    const resp = await api.mount.updateMount(id, payload);
    if (!resp) {
      throw new Error("更新挂载点失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "更新挂载点失败");
      }
      return resp.data ?? { id, ...payload };
    }
    return resp;
  };

  /**
   * 创建挂载点
   * @param {Object} payload
   * @returns {Promise<Object>} 新建的挂载点对象
   */
  const createMount = async (payload) => {
    const resp = await api.mount.createMount(payload);
    if (!resp) {
      throw new Error("创建挂载点失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "创建挂载点失败");
      }
      return resp.data ?? resp;
    }
    return resp;
  };

  /**
   * 删除挂载点
   * @param {string|number} id
   * @returns {Promise<true>}
   */
  const deleteMount = async (id) => {
    const resp = await api.mount.deleteMount(id);
    if (!resp) {
      throw new Error("删除挂载点失败");
    }
    if (typeof resp === "object" && "success" in resp) {
      if (!resp.success) {
        throw new Error(resp.message || "删除挂载点失败");
      }
    }
    return true;
  };

  return {
    getMountsList,
    updateMount,
    createMount,
    deleteMount,
  };
}
