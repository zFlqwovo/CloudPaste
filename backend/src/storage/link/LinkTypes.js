// 通用 StorageLink 类型定义与辅助工具
// kind 仅区分 direct/proxy；presigned/custom_host 通过附加标记表达

/**
 * @typedef {Object} StorageLink
 * @property {string} url              // 直链或可代理的底层 URL
 * @property {"direct"|"proxy"} kind   // 路由决策依据
 * @property {Object<string,string>=} headers
 */

/**
 * 创建一个 direct 类型的 StorageLink
 * @param {string} url
 * @param {Object} [options]
 * @returns {StorageLink}
 */
export function createDirectLink(url, options = {}) {
  return {
    url,
    kind: "direct",
    headers: options.headers || undefined,
  };
}

/**
 * 创建一个 proxy 类型的 StorageLink
 * @param {string} url
 * @param {Object} [options]
 * @returns {StorageLink}
 */
export function createProxyLink(url, options = {}) {
  return {
    url,
    kind: "proxy",
    headers: options.headers || undefined,
  };
}
