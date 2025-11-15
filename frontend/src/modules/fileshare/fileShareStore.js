import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useFileshareService } from "@/modules/fileshare/fileshareService.js";

/**
 * Fileshare 领域 Store
 *
 * 职责：
 * - 统一管理文件分享列表及分页状态
 * - 提供按 id / slug 的详情获取与简单缓存
 * - 为 admin/public 视图提供共享的数据来源
 *
 * 不负责：
 * - UI 文案与交互（提示、模态框等）
 * - 具体删除/更新 API 调用（交给上层 service 或 composable）
 */
export const useFileShareStore = defineStore("fileShare", () => {
  const service = useFileshareService();

  // 列表及分页
  const items = ref([]);
  const pagination = ref({
    total: 0,
    limit: 20,
    offset: 0,
  });

  const searchTerm = ref("");

  // 状态
  const loading = ref(false);
  const error = ref(null);
  const lastLoadedAt = ref(null);

  // 简单缓存：按 id / slug
  const cacheById = ref(new Map());
  const cacheBySlug = ref(new Map());

  const isSearchMode = computed(() => !!searchTerm.value && searchTerm.value.trim().length > 0);

  /**
   * 从服务端加载文件列表
   *
   * @param {Object} options
   * @param {number} [options.limit]
   * @param {number} [options.offset]
   * @param {string} [options.search]
   */
  const loadList = async ({ limit, offset, search } = {}) => {
    const finalLimit = typeof limit === "number" ? limit : pagination.value.limit;
    const finalOffset = typeof offset === "number" ? offset : pagination.value.offset;
    const normalizedSearch = typeof search === "string" ? search.trim() : searchTerm.value.trim();

    loading.value = true;
    error.value = null;
    searchTerm.value = normalizedSearch;

    try {
      const { files, pagination: serverPagination } = await service.fetchList({
        limit: finalLimit,
        offset: finalOffset,
        search: normalizedSearch || undefined,
      });

      items.value = files;
      const mergedPagination =
        serverPagination && typeof serverPagination === "object"
          ? serverPagination
          : {
              total: files.length,
              limit: finalLimit,
              offset: finalOffset,
            };

      pagination.value = mergedPagination;
      lastLoadedAt.value = Date.now();

      // 预热缓存
      files.forEach((file) => {
        if (!file) return;
        if (file.id != null) {
          cacheById.value.set(file.id, file);
        }
        if (file.slug) {
          cacheBySlug.value.set(file.slug, file);
        }
      });

      return { files, pagination: mergedPagination };
    } catch (e) {
      console.error("加载文件分享列表失败:", e);
      error.value = e.message || "加载文件列表失败";
      items.value = [];
      throw e;
    } finally {
      loading.value = false;
    }
  };

  const reloadCurrent = async () => {
    return loadList({});
  };

  /**
   * 按 ID 获取文件详情（带简单缓存）
   */
  const fetchById = async (id, { useCache = true } = {}) => {
    if (!id) {
      throw new Error("缺少文件 ID");
    }

    if (useCache && cacheById.value.has(id)) {
      return cacheById.value.get(id);
    }

    const file = await service.fetchById(id);
    if (file) {
      if (file.id != null) {
        cacheById.value.set(file.id, file);
      }
      if (file.slug) {
        cacheBySlug.value.set(file.slug, file);
      }
    }
    return file;
  };

  /**
   * 按 slug 获取文件详情（带简单缓存）
   */
  const fetchBySlug = async (slug, { useCache = true } = {}) => {
    if (!slug) {
      throw new Error("缺少文件 slug");
    }

    if (useCache && cacheBySlug.value.has(slug)) {
      return cacheBySlug.value.get(slug);
    }

    const file = await service.fetchBySlug(slug);
    if (file) {
      if (file.id != null) {
        cacheById.value.set(file.id, file);
      }
      if (file.slug) {
        cacheBySlug.value.set(file.slug, file);
      }
    }
    return file;
  };

  /**
   * 使用部分更新合并缓存和当前列表中的文件
   */
  const updateCachedFile = (partial) => {
    if (!partial) return;

    const id = partial.id;
    const slug = partial.slug;

    const existing = id != null ? cacheById.value.get(id) : null;
    const merged = existing ? { ...existing, ...partial } : partial;

    if (id != null) {
      cacheById.value.set(id, merged);
    }
    if (slug) {
      cacheBySlug.value.set(slug, merged);
    }

    if (id != null) {
      items.value = items.value.map((file) => (file && file.id === id ? merged : file));
    }
  };

  /**
   * 从列表和缓存中移除指定 ID 的文件
   */
  const removeFromStore = (id) => {
    if (!id) return;

    const existing = cacheById.value.get(id);
    if (existing && existing.slug) {
      cacheBySlug.value.delete(existing.slug);
    }
    cacheById.value.delete(id);

    const prevTotal = pagination.value.total || 0;
    items.value = items.value.filter((file) => file && file.id !== id);

    pagination.value = {
      ...pagination.value,
      total: prevTotal > 0 ? prevTotal - 1 : 0,
    };
  };

  /**
   * 重置全部状态（退出管理页或切换用户时使用）
   */
  const resetState = () => {
    items.value = [];
    pagination.value = {
      total: 0,
      limit: pagination.value.limit,
      offset: 0,
    };
    searchTerm.value = "";
    loading.value = false;
    error.value = null;
    lastLoadedAt.value = null;
    cacheById.value.clear();
    cacheBySlug.value.clear();
  };

  return {
    // 状态
    items,
    pagination,
    searchTerm,
    loading,
    error,
    lastLoadedAt,
    isSearchMode,

    // 派生
    hasItems: computed(() => items.value.length > 0),

    // 行为
    loadList,
    reloadCurrent,
    fetchById,
    fetchBySlug,
    updateCachedFile,
    removeFromStore,
    resetState,
  };
});

