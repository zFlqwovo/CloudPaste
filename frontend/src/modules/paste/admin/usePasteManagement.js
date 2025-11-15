import { ref, reactive, computed } from "vue";
import { usePasteService } from "@/modules/paste";
import { copyToClipboard } from "@/utils/clipboard";
import { useAuthStore } from "@/stores/authStore.js";
import { useAdminBase } from "@/composables/admin-management/useAdminBase.js";
import { generateQRCode as createQRCodeImage } from "@/utils/qrcodeUtils.js";

/**
 * 文本管理专用composable
 * 基于useAdminBase，添加文本管理特有的逻辑
 */
export function usePasteManagement() {
  // 继承基础管理功能
  const base = useAdminBase();
  const pasteService = usePasteService();
  // 文本管理特有状态
  const pastes = ref([]);
  const previewPaste = ref(null);
  const editingPaste = ref(null);
  const showPreview = ref(false);
  const showEdit = ref(false);
  const showQRCodeModal = ref(false);
  const qrCodeDataURL = ref("");
  const qrCodeSlug = ref("");

  // 复制状态跟踪
  const copiedTexts = reactive({});
  const copiedRawTexts = reactive({});

  // 使用认证Store
  const authStore = useAuthStore();

  // 权限计算属性
  const isAdmin = computed(() => authStore.isAdmin);
  const isApiKeyUser = computed(() => authStore.authType === "apikey" && authStore.hasTextPermission);
  const isAuthorized = computed(() => isAdmin.value || isApiKeyUser.value);

  /**
   * 加载文本分享列表
   */
  const loadPastes = async () => {
    return await base.withLoading(async () => {
      try {
        // 改为使用 offset 模式，与文件管理保持一致
        const { items, pagination } = await pasteService.getPastes({
          limit: base.pagination.limit,
          offset: base.pagination.offset,
        });

        pastes.value = items;
        base.updatePagination(pagination, "offset");
        base.updateLastRefreshTime();
        console.log(`文本分享列表加载完成，共 ${pastes.value.length} 条`);
      } catch (err) {
        pastes.value = [];
        throw err;
      }
    });
  };

  /**
   * 处理分页变化 - 改为offset模式
   */
  const handleOffsetChange = (newOffset) => {
    base.handlePaginationChange(newOffset, "offset");
    loadPastes();
  };

  /**
   * 删除单个文本分享
   * @param {string} pasteId - 文本分享的ID
   */
  const deletePaste = async (pasteId) => {
    // 确保pasteId存在
    if (!pasteId) {
      base.showError("删除失败：缺少文本标识信息");
      return;
    }

    if (!confirm("确定要删除此分享吗？此操作不可恢复。")) {
      return;
    }

    return await base.withLoading(async () => {
      await pasteService.deleteSinglePaste(pasteId);
      base.showSuccess("删除成功");
      await loadPastes();
    });
  };

  /**
   * 批量删除文本分享
   */
  const batchDeletePastes = async () => {
    const selectedCount = base.selectedItems.value.length;
    if (selectedCount === 0) {
      base.showError("请先选择要删除的分享");
      return;
    }

    if (!confirm(`确定要删除选中的 ${selectedCount} 个分享吗？此操作不可恢复。`)) {
      return;
    }

    return await base.withLoading(async () => {
      await pasteService.deletePastes(base.selectedItems.value);
      base.showSuccess(`成功删除 ${selectedCount} 个分享`);
      base.clearSelection();
      await loadPastes();
    });
  };

  /**
   * 清理所有过期的文本分享（仅管理员可用）
   */
  const clearExpiredPastes = async () => {
    if (!isAdmin.value) {
      base.showError("只有管理员才能清理过期文本");
      return;
    }

    if (!confirm("确定要清理所有过期的文本分享吗？此操作不可恢复。")) {
      return;
    }

    return await base.withLoading(async () => {
      const message = await pasteService.clearExpiredPastes();
      base.showSuccess(message || "清理完成");
      await loadPastes();
    });
  };

  /**
   * 打开预览弹窗
   * @param {Object} paste - 文本分享对象
   */
  const openPreview = async (paste) => {
    if (!paste || !paste.id) {
      base.showError("预览失败：缺少文本标识信息");
      return;
    }

    try {
      const fullPaste = await pasteService.getPasteById(paste.id);
      previewPaste.value = fullPaste;
      showPreview.value = true;
    } catch (err) {
      console.error("获取分享详情失败:", err);
      base.showError(err.message || "获取分享详情失败，请重试");
    }
  };

  /**
   * 关闭预览弹窗
   */
  const closePreview = () => {
    showPreview.value = false;
    setTimeout(() => {
      previewPaste.value = null;
    }, 300);
  };

  /**
   * 打开编辑弹窗
   * @param {Object} paste - 文本分享对象
   */
  const openEditModal = async (paste) => {
    if (!paste || !paste.id) {
      base.showError("编辑失败：缺少文本标识信息");
      return;
    }

    base.clearMessages();

    try {
      const fullPaste = await pasteService.getPasteById(paste.id);
      editingPaste.value = fullPaste;
      showEdit.value = true;
    } catch (err) {
      console.error("获取分享详情失败:", err);
      base.showError(err.message || "获取分享详情失败，请重试");
    }
  };

  /**
   * 关闭编辑弹窗
   */
  const closeEditModal = () => {
    showEdit.value = false;
    setTimeout(() => {
      editingPaste.value = null;
    }, 300);
  };

  /**
   * 提交编辑
   */
  const submitEdit = async (updatedPaste) => {
    if (updatedPaste.error) {
      base.showError(updatedPaste.error);
      return;
    }

    return await base.withLoading(async () => {
      // PasteEditModal传递的数据结构是 { data: updateData }
      // 需要提取实际的数据
      const actualData = updatedPaste.data || updatedPaste;

      // 确保有slug参数
      const slug = actualData.slug || editingPaste.value?.slug;
      if (!slug) {
        base.showError("更新失败：缺少必要的文本标识信息");
        return;
      }

      // 确保有content字段
      if (!actualData.content) {
        base.showError("更新失败：内容不能为空");
        return;
      }

      await pasteService.updatePaste(slug, actualData);
      base.showSuccess("分享信息更新成功");
      closeEditModal();
      await loadPastes();
    });
  };

  /**
   * 复制分享链接
   * @param {string} slug - 文本分享的slug
   */
  const copyLink = async (slug) => {
    try {
      if (!slug) {
        base.showError("复制失败：缺少文本链接信息");
        return;
      }

      const baseUrl = window.location.origin;
      const pasteUrl = `${baseUrl}/paste/${slug}`;

      await copyToClipboard(pasteUrl);

      // 从pastes列表中查找对应的paste对象获取id，用于显示复制状态
      const paste = pastes.value.find((p) => p.slug === slug);
      if (paste?.id) {
        copiedTexts[paste.id] = true;
        setTimeout(() => {
          delete copiedTexts[paste.id];
        }, 2000);
      }
    } catch (err) {
      console.error("复制失败:", err);
      base.showError("复制失败，请手动复制");
    }
  };

  /**
   * 复制原始文本直链
   */
  const copyRawLink = async (paste) => {
    try {
      // 确保paste对象和slug存在
      if (!paste || !paste.slug) {
        base.showError("复制失败：缺少文本链接信息");
        return;
      }

      let pasteWithPassword = paste;

      // 如果paste对象有加密但没有明文密码，先获取完整信息
      if (paste.has_password && !paste.plain_password) {
        pasteWithPassword = await pasteService.getPasteById(paste.id);
      }

      // 使用pasteService的getRawPasteUrl方法生成正确的原始链接
      const rawUrl = pasteService.getRawPasteUrl(pasteWithPassword.slug, pasteWithPassword.plain_password);

      await copyToClipboard(rawUrl);

      // 设置复制状态
      if (paste.id) {
        copiedRawTexts[paste.id] = true;
        setTimeout(() => {
          delete copiedRawTexts[paste.id];
        }, 2000);
      }
    } catch (err) {
      console.error("复制失败:", err);
      base.showError("复制失败，请手动复制");
    }
  };

  /**
   * 跳转到查看页面
   * @param {string} slug - 文本分享的slug
   */
  const goToViewPage = (slug) => {
    if (!slug) {
      base.showError("跳转失败：缺少文本链接信息");
      return;
    }

    const baseUrl = window.location.origin;
    const viewUrl = `${baseUrl}/paste/${slug}`;
    window.open(viewUrl, "_blank");
  };

  /**
   * 生成并显示二维码
   * @param {string} slug - 文本分享的slug
   * @param {boolean} darkMode - 是否为暗色模式
   */
  const showQRCode = async (slug, darkMode = false) => {
    try {
      if (!slug) {
        base.showError("生成二维码失败：缺少文本链接信息");
        return;
      }

      const baseUrl = window.location.origin;
      const pasteUrl = `${baseUrl}/paste/${slug}`;

      qrCodeDataURL.value = await createQRCodeImage(pasteUrl, { darkMode });

      qrCodeSlug.value = slug;
      showQRCodeModal.value = true;
    } catch (err) {
      console.error("生成二维码失败:", err);
      base.showError("生成二维码失败");
    }
  };

  /**
   * 切换全选状态（文本管理专用）
   */
  const toggleSelectAll = () => {
    base.toggleSelectAll(pastes.value, "id");
  };

  /**
   * 搜索文本分享
   * @param {string} searchTerm - 搜索关键词
   * @param {number} offset - 偏移量，默认为当前分页的offset
   * @returns {Promise<Object>} 搜索结果
   */
  const searchPastes = async (searchTerm, offset = null) => {
    if (!searchTerm || searchTerm.trim().length < 2) {
      return { results: [], pagination: { total: 0, limit: base.pagination.limit, offset: 0 } };
    }

    // 如果没有指定offset，使用当前分页的offset
    const searchOffset = offset !== null ? offset : base.pagination.offset;

    return await base.withLoading(async () => {
      try {
        const { items, pagination } = await pasteService.getPastes({
          limit: base.pagination.limit,
          offset: searchOffset,
          search: searchTerm.trim(),
        });

        return {
          results: items,
          pagination: pagination || {
            total: items.length,
            limit: base.pagination.limit,
            offset: searchOffset,
          },
        };
      } catch (err) {
        base.showError(err.message || "搜索失败");
        return { results: [], pagination: { total: 0, limit: base.pagination.limit, offset: searchOffset } };
      }
    });
  };

  /**
   * 关闭所有弹窗
   */
  const closeAllModals = () => {
    showPreview.value = false;
    showEdit.value = false;
    showQRCodeModal.value = false;
    previewPaste.value = null;
    editingPaste.value = null;
    qrCodeDataURL.value = "";
    qrCodeSlug.value = "";
  };

  return {
    // 继承基础功能
    ...base,

    // 文本管理特有状态
    pastes,
    previewPaste,
    editingPaste,
    showPreview,
    showEdit,
    showQRCodeModal,
    qrCodeDataURL,
    qrCodeSlug,
    copiedTexts,
    copiedRawTexts,

    // 权限状态
    isAdmin,
    isApiKeyUser,
    isAuthorized,

    // 文本管理方法
    loadPastes,
    searchPastes,
    handleOffsetChange,
    deletePaste,
    batchDeletePastes,
    clearExpiredPastes,
    openPreview,
    closePreview,
    openEditModal,
    closeEditModal,
    submitEdit,
    copyLink,
    copyRawLink,
    goToViewPage,
    showQRCode,
    toggleSelectAll,
    closeAllModals,
  };
}
