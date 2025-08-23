/**
 * WebDAV工具函数
 */

import { WEBDAV_BASE_PATH } from "../auth/config/WebDAVConfig.js";

/**
 * 解析目标路径
 * WebDAV特有功能：处理WebDAV的Destination头
 * @param {string} destination - 目标路径头
 * @returns {string|null} 规范化的目标路径或null（如果无效）
 */
export function parseDestinationPath(destination) {
  if (!destination) {
    return null;
  }

  let destPath;
  try {
    // 尝试从完整URL中提取路径
    const url = new URL(destination);
    destPath = url.pathname;
  } catch (error) {
    // 如果不是完整URL，直接使用值作为路径
    destPath = destination;
  }

  // 处理WebDAV路径前缀 - 静态配置
  if (WEBDAV_BASE_PATH === "/") {
    // 根路径配置：不需要移除前缀
  } else {
    // 子路径配置
    if (destPath.startsWith(WEBDAV_BASE_PATH + "/")) {
      destPath = destPath.substring(WEBDAV_BASE_PATH.length); // 移除前缀
    } else if (destPath === WEBDAV_BASE_PATH) {
      destPath = destPath.substring(WEBDAV_BASE_PATH.length); // 移除前缀
    }
  }

  // WebDAV路径安全检查
  if (!destPath) {
    return null;
  }

  // 基本路径遍历防护
  if (destPath.includes("..")) {
    console.warn(`WebDAV安全警告: 路径包含非法的父目录引用(..)`);
    return null;
  }

  // 规范化路径，移除多余的斜杠
  destPath = destPath.replace(/\/+/g, "/");

  // 确保路径以斜杠开始
  if (!destPath.startsWith("/")) {
    destPath = "/" + destPath;
  }

  return destPath;
}
