/**
 * 文件分享查看服务API
 * 统一管理文件分享相关的API调用，包括下载、预览、Office预览
 */

import { get } from "../client";

// 旧的基于 slug 的下载/预览函数已被 Down 路由 + Link JSON 替代

// 预览服务提供商配置
const PREVIEW_PROVIDERS = {
  microsoft: {
    name: "Microsoft Office Online",
    urlTemplate: "https://view.officeapps.live.com/op/view.aspx?src={url}",
  },
  google: {
    name: "Google Docs Viewer",
    urlTemplate: "https://docs.google.com/viewer?url={url}&embedded=true",
  },
};

/**
 * 统一的Office预览服务
 * @param {string|Object} input - 直接访问文件的 URL 字符串或包含 directUrl 的对象
 * @param {Object} options - 选项
 * @param {string} [options.provider='microsoft'] - 预览服务提供商 ('microsoft' | 'google')
 * @param {boolean} [options.returnAll=false] - 是否返回所有提供商的URL
 * @returns {Promise<string|Object>} 预览URL或包含所有URL的对象
 */
export async function getOfficePreviewUrl(input, options = {}) {
  const { provider = "microsoft", returnAll = false } = options;

  try {
    // 获取直接访问URL（不再通过 slug + /api/office-preview 获取）
    let directUrl;
    if (input && typeof input === "object" && input.directUrl) {
      // input 是包含 directUrl 的对象
      directUrl = input.directUrl;
    } else if (typeof input === "string") {
      // 兼容直接传入直链 URL 的情况
      directUrl = input;
    } else {
      throw new Error("无效的输入参数，需要包含 directUrl 的对象或直接传入直链 URL");
    }

    if (!directUrl) {
      throw new Error("无法获取Office预览URL");
    }

    // 生成预览URL
    const encodedUrl = encodeURIComponent(directUrl);

    if (returnAll) {
      // 返回所有提供商的URL
      const result = { directUrl };
      Object.entries(PREVIEW_PROVIDERS).forEach(([key, config]) => {
        result[key] = config.urlTemplate.replace("{url}", encodedUrl);
      });
      return result;
    } else {
      // 返回指定提供商的URL
      const providerConfig = PREVIEW_PROVIDERS[provider];
      if (!providerConfig) {
        throw new Error(`不支持的预览服务提供商: ${provider}`);
      }
      return providerConfig.urlTemplate.replace("{url}", encodedUrl);
    }
  } catch (error) {
    console.error("获取Office预览URL失败:", error);
    throw new Error(`获取Office预览URL失败: ${error.message}`);
  }
}

/**
 * 构建文件下载URL（用于直接链接）
 * @param {string} slug - 文件短链接
 * @param {string} [password] - 文件密码（如果需要）
 * @returns {string} 完整的下载URL
 */
export function buildDownloadUrl(slug, password = null) {
  // 使用 URL API 构建，避免重复 ? 与参数拼接错误
  const baseUrl = window.location.origin;
  const urlObj = new URL(`/api/s/${slug}`, baseUrl);
  urlObj.searchParams.set("mode", "attachment");

  if (password) {
    urlObj.searchParams.set("password", password);
  }

  return urlObj.toString();
}

/**
 * 检查URL是否为文件分享代理URL
 * @param {string} url - 要检查的URL
 * @returns {Object} 检查结果
 */
export function parseFileShareUrl(url) {
  if (!url) return { isFileShare: false };

  // 检查是否为 share 内容路由 URL（/api/s/:slug?mode=...）
  const match = url.match(/\/api\/s\/([^?]+)/);
  if (match) {
    const slug = match[1];
    const urlObj = new URL(url, window.location.origin);
    const password = urlObj.searchParams.get("password");
    const mode = urlObj.searchParams.get("mode") || "inline";

    return {
      isFileShare: true,
      type: mode === "attachment" ? "download" : "preview",
      slug,
      password,
      mode,
    };
  }

  return { isFileShare: false };
}

/**
 * 为现有URL添加密码参数
 * @param {string} url - 原始URL
 * @param {string} password - 要添加的密码
 * @returns {string} 添加密码后的URL
 */
export function addPasswordToUrl(url, password) {
  if (!url || !password) return url;

  // 检查URL中是否已包含密码参数
  if (url.includes("password=")) return url;

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}password=${encodeURIComponent(password)}`;
}

/**
 * 将HTTP状态码映射到国际化错误键
 * @param {number} statusCode - HTTP状态码
 * @returns {string} 国际化错误键
 */
export function getErrorKeyByStatus(statusCode) {
  switch (statusCode) {
    case 401:
      return "fileView.errors.unauthorized";
    case 403:
      return "fileView.errors.forbidden";
    case 404:
      return "fileView.errors.notFound";
    case 410:
      return "fileView.errors.forbidden"; // 文件过期也使用 forbidden
    default:
      return "fileView.errors.serverError";
  }
}
