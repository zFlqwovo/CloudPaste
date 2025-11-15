import { api } from "@/api";

/**
 * FS 领域服务
 *
 * 职责：
 * - 对 api.fs 提供的低层接口做语义包装
 * - 统一目录/文件信息/批量删除/直链等操作
 *
 * 不负责：
 * - UI 文案与 DOM 操作（如创建 <a> 元素、复制提示）
 */
export function useFsService() {
  const getDirectoryList = async (path, options = {}) => {
    const response = await api.fs.getDirectoryList(path, options);
    if (!response?.success) {
      throw new Error(response?.message || "获取目录列表失败");
    }
    return response.data;
  };

  const getFileInfo = async (path) => {
    const response = await api.fs.getFileInfo(path);
    if (!response?.success) {
      throw new Error(response?.message || "获取文件信息失败");
    }
    return response.data;
  };

  const renameItem = async (oldPath, newPath) => {
    const response = await api.fs.renameItem(oldPath, newPath);
    if (!response?.success) {
      throw new Error(response?.message || "重命名失败");
    }
    return true;
  };

  const createDirectory = async (fullPath) => {
    const response = await api.fs.createDirectory(fullPath);
    if (!response?.success) {
      throw new Error(response?.message || "创建文件夹失败");
    }
    return true;
  };

  const batchDeleteItems = async (paths) => {
    const result = await api.fs.batchDeleteItems(paths);
    if (result.failed && result.failed.length > 0) {
      throw new Error(result.failed[0].error || "批量删除失败");
    }
    return {
      success: true,
      raw: result,
    };
  };

  /**
   * 批量复制文件或目录
   * @param {Array<{sourcePath:string,targetPath:string}>} items
   * @param {boolean} [skipExisting=true]
   * @param {Object} [options]
   * @returns {Promise<Object>} 原始复制结果（保持后端结构，供调用方解析 success/统计信息）
   */
  const batchCopyItems = async (items, skipExisting = true, options = {}) => {
    return api.fs.batchCopyItems(items, skipExisting, options);
  };

  const getFileLink = async (path, expiresIn = null, forceDownload = true) => {
    const response = await api.fs.getFileLink(path, expiresIn, forceDownload);
    if (!response?.success || !response.data?.presignedUrl) {
      throw new Error(response?.message || "获取文件直链失败");
    }
    return response.data.presignedUrl;
  };

  return {
    getDirectoryList,
    getFileInfo,
    renameItem,
    createDirectory,
    batchDeleteItems,
    batchCopyItems,
    getFileLink,
  };
}
