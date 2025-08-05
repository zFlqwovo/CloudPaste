/**
 * 站点配置状态管理Store
 * 管理站点级别的配置信息，如站点标题等
 */

import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { api } from "@/api";

// 配置常量
const STORAGE_KEY = "cloudpaste_site_config";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24小时缓存时间

// ===== Favicon 工具函数 =====

/**
 * 根据URL获取favicon MIME类型
 * @param {string} url - favicon URL
 * @returns {string} MIME类型
 */
const getFaviconType = (url) => {
  if (url.startsWith("data:")) {
    if (url.includes("image/svg")) return "image/svg+xml";
    if (url.includes("image/png")) return "image/png";
    if (url.includes("image/x-icon")) return "image/x-icon";
    if (url.includes("image/jpeg")) return "image/jpeg";
    return "image/x-icon"; // 默认
  }

  const ext = url.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "svg":
      return "image/svg+xml";
    case "png":
      return "image/png";
    case "ico":
      return "image/x-icon";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    default:
      return "image/x-icon";
  }
};

/**
 * 更新页面favicon
 * @param {string} faviconUrl - favicon URL，空字符串表示使用默认图标
 */
const updatePageFavicon = (faviconUrl) => {
  try {
    // 查找现有的favicon link标签
    let faviconLink = document.querySelector('link[rel="icon"]') || document.querySelector('link[rel="shortcut icon"]');

    // 如果没有找到，创建一个新的
    if (!faviconLink) {
      faviconLink = document.createElement("link");
      faviconLink.rel = "icon";
      document.head.appendChild(faviconLink);
    }

    // 设置favicon URL和类型
    if (faviconUrl && faviconUrl.trim()) {
      const finalUrl = faviconUrl.trim();
      faviconLink.href = finalUrl;
      faviconLink.type = getFaviconType(finalUrl);
    } else {
      // 使用默认favicon
      faviconLink.href = "/cloudpaste.svg";
      faviconLink.type = "image/svg+xml";
    }

    console.log("页面favicon已更新:", faviconLink.href);
  } catch (error) {
    console.error("更新页面favicon失败:", error);
    // 失败时设置默认favicon
    try {
      let faviconLink = document.querySelector('link[rel="icon"]');
      if (faviconLink) {
        faviconLink.href = "/cloudpaste.svg";
        faviconLink.type = "image/svg+xml";
      }
    } catch (fallbackError) {
      console.error("设置默认favicon也失败:", fallbackError);
    }
  }
};

export const useSiteConfigStore = defineStore("siteConfig", () => {
  // ===== 状态定义 =====

  // 站点配置
  const siteTitle = ref("CloudPaste"); // 默认站点标题
  const siteFaviconUrl = ref(""); // 站点图标URL
  const siteFooterMarkdown = ref("© 2025 CloudPaste. 保留所有权利。"); // 页脚Markdown内容
  const isLoading = ref(false);
  const lastUpdated = ref(null);
  const isInitialized = ref(false);

  // ===== 计算属性 =====

  /**
   * 检查缓存是否有效
   */
  const isCacheValid = computed(() => {
    if (!lastUpdated.value) return false;
    const now = Date.now();
    return now - lastUpdated.value < CACHE_TTL;
  });

  /**
   * 获取完整的站点配置对象
   */
  const siteConfig = computed(() => ({
    title: siteTitle.value,
    faviconUrl: siteFaviconUrl.value,
    footerMarkdown: siteFooterMarkdown.value,
    lastUpdated: lastUpdated.value,
    isInitialized: isInitialized.value,
  }));

  // ===== 私有方法 =====

  /**
   * 从localStorage加载缓存的配置
   */
  const loadFromStorage = () => {
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        const config = JSON.parse(cached);
        if (config.title) {
          siteTitle.value = config.title;
        }
        if (config.faviconUrl !== undefined) {
          siteFaviconUrl.value = config.faviconUrl || "";
        }
        if (config.footerMarkdown !== undefined) {
          siteFooterMarkdown.value = config.footerMarkdown; // 直接使用缓存值，包括空字符串
        }
        if (config.lastUpdated) {
          lastUpdated.value = config.lastUpdated;
        }
        console.log("从缓存加载站点配置:", config);
        return true;
      }
    } catch (error) {
      console.warn("加载站点配置缓存失败:", error);
      // 清除损坏的缓存
      localStorage.removeItem(STORAGE_KEY);
    }
    return false;
  };

  /**
   * 保存配置到localStorage
   */
  const saveToStorage = () => {
    try {
      const config = {
        title: siteTitle.value,
        faviconUrl: siteFaviconUrl.value,
        footerMarkdown: siteFooterMarkdown.value,
        lastUpdated: lastUpdated.value,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      console.log("站点配置已保存到缓存:", config);
    } catch (error) {
      console.error("保存站点配置到缓存失败:", error);
    }
  };

  /**
   * 从API获取站点配置
   */
  const fetchFromAPI = async () => {
    try {
      // 获取站点设置分组（分组ID = 4）
      const response = await api.system.getSettingsByGroup(4, false);

      if (response && response.success && response.data) {
        // 查找站点标题设置
        const titleSetting = response.data.find((setting) => setting.key === "site_title");
        if (titleSetting && titleSetting.value) {
          siteTitle.value = titleSetting.value;
        } else {
          // 如果没有找到设置或值为空，使用默认值
          siteTitle.value = "CloudPaste";
        }

        // 查找站点图标设置
        const faviconSetting = response.data.find((setting) => setting.key === "site_favicon_url");
        if (faviconSetting) {
          siteFaviconUrl.value = faviconSetting.value || "";
        } else {
          siteFaviconUrl.value = "";
        }

        // 查找页脚Markdown设置
        const footerSetting = response.data.find((setting) => setting.key === "site_footer_markdown");
        if (footerSetting) {
          // 直接使用API返回的值，不填充默认值（保持用户的清空状态）
          siteFooterMarkdown.value = footerSetting.value;
        } else {
          // 如果API中没有这个设置，保持当前值（通常是初始默认值）
          // 不强制设置为空，让首次安装时保持默认值
        }

        lastUpdated.value = Date.now();
        saveToStorage();

        console.log("从API加载站点配置成功:", {
          title: siteTitle.value,
          faviconUrl: siteFaviconUrl.value,
          footerMarkdown: siteFooterMarkdown.value,
        });
        return true;
      } else {
        throw new Error(response?.message || "获取站点配置失败");
      }
    } catch (error) {
      console.error("从API获取站点配置失败:", error);
      // API失败时保持当前值或使用默认值
      if (!siteTitle.value || siteTitle.value === "") {
        siteTitle.value = "CloudPaste";
      }
      return false;
    }
  };

  // ===== 公共方法 =====

  /**
   * 初始化站点配置
   * 优先使用缓存，缓存无效时从API获取
   */
  const initialize = async () => {
    if (isInitialized.value) {
      console.log("站点配置已初始化，跳过重复初始化");
      return;
    }

    console.log("初始化站点配置...");
    isLoading.value = true;

    try {
      // 1. 尝试从缓存加载
      const cacheLoaded = loadFromStorage();

      // 2. 如果缓存有效，直接使用缓存
      if (cacheLoaded && isCacheValid.value) {
        console.log("使用有效的缓存配置");
        // 设置favicon
        updatePageFavicon(siteFaviconUrl.value);
        isInitialized.value = true;
        return;
      }

      // 3. 缓存无效或不存在，从API获取
      console.log("缓存无效或不存在，从API获取站点配置");
      await fetchFromAPI();

      // 设置favicon
      updatePageFavicon(siteFaviconUrl.value);

      isInitialized.value = true;
    } catch (error) {
      console.error("初始化站点配置失败:", error);
      // 初始化失败时使用默认值
      siteTitle.value = "CloudPaste";
      isInitialized.value = true;
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * 刷新站点配置
   * 强制从API重新获取配置
   */
  const refresh = async () => {
    console.log("刷新站点配置...");
    isLoading.value = true;

    try {
      await fetchFromAPI();
      console.log("站点配置刷新成功");
    } catch (error) {
      console.error("刷新站点配置失败:", error);
      throw error;
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * 更新站点标题
   * 用于管理员修改设置后立即更新缓存
   */
  const updateSiteTitle = (newTitle) => {
    if (newTitle && typeof newTitle === "string") {
      siteTitle.value = newTitle.trim() || "CloudPaste";
      lastUpdated.value = Date.now();
      saveToStorage();
      console.log("站点标题已更新:", siteTitle.value);
    }
  };

  /**
   * 更新站点图标
   * 用于管理员修改设置后立即更新缓存和页面favicon
   */
  const updateSiteFavicon = (newFaviconUrl) => {
    if (typeof newFaviconUrl === "string") {
      siteFaviconUrl.value = newFaviconUrl.trim();
      lastUpdated.value = Date.now();
      saveToStorage();

      // 立即更新页面favicon
      updatePageFavicon(siteFaviconUrl.value);

      console.log("站点图标已更新:", siteFaviconUrl.value);
    }
  };

  /**
   * 更新页脚Markdown内容
   * 用于管理员修改设置后立即更新缓存
   */
  const updateSiteFooter = (newFooterMarkdown) => {
    if (typeof newFooterMarkdown === "string") {
      siteFooterMarkdown.value = newFooterMarkdown;
      lastUpdated.value = Date.now();
      saveToStorage();
      console.log("页脚内容已更新:", siteFooterMarkdown.value);
    }
  };

  /**
   * 重置配置
   */
  const reset = () => {
    siteTitle.value = "CloudPaste";
    siteFaviconUrl.value = "";
    siteFooterMarkdown.value = "© 2025 CloudPaste. 保留所有权利。";
    lastUpdated.value = null;
    isInitialized.value = false;
    localStorage.removeItem(STORAGE_KEY);
    // 重置favicon为默认
    updatePageFavicon("");
    console.log("站点配置已重置");
  };

  /**
   * 获取缓存统计信息
   */
  const getCacheStats = () => {
    return {
      isInitialized: isInitialized.value,
      isCacheValid: isCacheValid.value,
      lastUpdated: lastUpdated.value,
      cacheAge: lastUpdated.value ? Date.now() - lastUpdated.value : null,
      title: siteTitle.value,
      faviconUrl: siteFaviconUrl.value,
      footerMarkdown: siteFooterMarkdown.value,
    };
  };

  // 返回store的状态和方法
  return {
    // 状态
    siteTitle,
    siteFaviconUrl,
    siteFooterMarkdown,
    isLoading,
    lastUpdated,
    isInitialized,

    // 计算属性
    isCacheValid,
    siteConfig,

    // 方法
    initialize,
    refresh,
    updateSiteTitle,
    updateSiteFavicon,
    updateSiteFooter,
    reset,
    getCacheStats,
  };
});
