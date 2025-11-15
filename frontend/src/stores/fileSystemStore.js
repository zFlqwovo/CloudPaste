/**
 * 文件系统 Pinia Store
 * 负责管理 FS 领域的目录数据与加载状态
 * 不再直接耦合 vue-router 或 DOM 副作用
 */

import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useAuthStore } from "./authStore.js";
import { useFsService } from "@/modules/fs";

export const useFileSystemStore = defineStore("fileSystem", () => {
  const fsService = useFsService();
  const authStore = useAuthStore();

  // ===== 状态管理 =====
  const currentPath = ref("/");
  const directoryData = ref(null);
  const loading = ref(false);
  const error = ref(null);

  // 请求去重状态
  const currentLoadingPath = ref(null);

  // ===== 计算属性 =====

  /**
   * 检查当前路径是否有权限访问
   */
  const hasPermissionForCurrentPath = computed(() => authStore.hasPathPermission(currentPath.value));

  /**
   * 目录项目列表
   */
  const directoryItems = computed(() => directoryData.value?.items || []);

  /**
   * 是否为虚拟目录
   */
  const isVirtualDirectory = computed(() => directoryData.value?.isVirtual || false);

  // ===== Actions =====

  /**
   * 加载目录内容
   * @param {string} path - 目录路径
   * @param {boolean} force - 是否强制刷新
   */
  const loadDirectory = async (path, force = false) => {
    const normalizedPath = path || "/";

    // 防止重复请求
    if (!force && currentLoadingPath.value === normalizedPath) {
      console.log(`目录 ${normalizedPath} 正在加载中，跳过重复请求`);
      return;
    }

    // 权限检查
    if (!authStore.hasPathPermission(normalizedPath)) {
      error.value = `没有权限访问路径: ${normalizedPath}`;
      return;
    }

    try {
      loading.value = true;
      currentLoadingPath.value = normalizedPath;
      error.value = null;

      // 调用FS service获取目录内容，传递refresh选项
      const data = await fsService.getDirectoryList(normalizedPath, { refresh: force });
      directoryData.value = data;
      currentPath.value = normalizedPath;
    } catch (err) {
      console.error("加载目录失败:", err);
      error.value = err.message || "加载目录失败";
      directoryData.value = null;
    } finally {
      loading.value = false;
      currentLoadingPath.value = null;
    }
  };

  /**
   * 刷新当前目录
   */
  const refreshDirectory = async () => {
    if (currentPath.value) {
      await loadDirectory(currentPath.value, true);
    }
  };

  /**
   * 重置状态
   */
  const resetState = () => {
    currentPath.value = "/";
    directoryData.value = null;
    loading.value = false;
    error.value = null;
    currentLoadingPath.value = null;
  };

  return {
    // 状态
    currentPath,
    directoryData,
    loading,
    error,

    // 计算属性
    hasPermissionForCurrentPath,
    directoryItems,
    isVirtualDirectory,

    // Actions
    loadDirectory,
    refreshDirectory,
    resetState,
  };
});
