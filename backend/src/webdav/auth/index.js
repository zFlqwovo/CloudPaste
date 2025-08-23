/**
 * WebDAV统一认证系统 - 统一导出接口
 *
 * - 统一的认证流程，支持Bearer、ApiKey、Basic三种认证
 * - 平台适配器：Hono、Workers、Express三个平台
 */

// 核心模块导入和导出
import { createWebDAVAuth } from "./core/WebDAVAuth.js";
import { createHonoAdapter, createHonoWebDAVMiddleware } from "./adapters/HonoAdapter.js";
import { createWorkersAdapter, createWorkersWebDAVHandler } from "./adapters/WorkersAdapter.js";
import { createExpressAdapter, createExpressWebDAVMiddleware } from "./adapters/ExpressAdapter.js";
import { validateConfig } from "./config/WebDAVConfig.js";

export { WebDAVDetector, createWebDAVDetector, isWebDAVRequest } from "./core/WebDAVDetector.js";
export { WebDAVAuth, createWebDAVAuth, AuthResultType } from "./core/WebDAVAuth.js";
export { WebDAVPermissionChecker, createWebDAVPermissionChecker, PermissionCheckResult } from "./core/PermissionChecker.js";
export { WebDAVAuthCache, createWebDAVAuthCache } from "./core/AuthCache.js";

// 配置模块导出
export {
  WEBDAV_CONFIG,
  WEBDAV_PERMISSIONS,
  PLATFORM_CONFIG,
  getWebDAVConfig,
  getMethodPermission,
  isReadOperation,
  isWriteOperation,
  getPlatformConfig,
  buildResponseHeaders,
  getAuthHeader,
  validateConfig,
} from "./config/WebDAVConfig.js";

// 适配器模块导出
export { BaseAdapter } from "./adapters/BaseAdapter.js";
export { HonoAdapter, createHonoAdapter, createHonoWebDAVMiddleware } from "./adapters/HonoAdapter.js";
export { WorkersAdapter, createWorkersAdapter, createWorkersWebDAVHandler } from "./adapters/WorkersAdapter.js";
export { ExpressAdapter, createExpressAdapter, createExpressWebDAVMiddleware } from "./adapters/ExpressAdapter.js";

/**
 * 统一WebDAV认证系统类
 * 
 */
export class UnifiedWebDAVAuth {
  constructor(db, platform = "hono") {
    this.db = db;
    this.platform = platform;
    this.webdavAuth = createWebDAVAuth(db);
    this.adapter = this.createAdapter(platform);
  }

  /**
   * 创建平台适配器
   * @param {string} platform - 平台名称
   * @returns {BaseAdapter} 适配器实例
   */
  createAdapter(platform) {
    switch (platform.toLowerCase()) {
      case "hono":
        return createHonoAdapter();
      case "workers":
        return createWorkersAdapter();
      case "express":
        return createExpressAdapter();
      default:
        throw new Error(`不支持的平台: ${platform}`);
    }
  }

  /**
   * 创建中间件
   * @returns {Function} 平台特定的中间件函数
   */
  createMiddleware() {
    switch (this.platform.toLowerCase()) {
      case "hono":
        return createHonoWebDAVMiddleware(this.webdavAuth);
      case "workers":
        return createWorkersWebDAVHandler(this.webdavAuth);
      case "express":
        return createExpressWebDAVMiddleware(this.webdavAuth);
      default:
        throw new Error(`不支持的平台: ${this.platform}`);
    }
  }

  /**
   * 获取系统统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      platform: this.platform,
      auth: this.webdavAuth.getAuthStats(),
      adapter: this.adapter.getStats(),
      system: {
        version: "1.0.0",
        features: ["rfc4918_compliant_detection", "unified_authentication", "multi_platform_support", "bit_flag_permissions", "high_performance_caching"],
      },
    };
  }

  /**
   * 验证系统配置
   * @returns {boolean} 配置是否有效
   */
  validateSystem() {
    try {
      // 验证配置
      if (!validateConfig()) {
        console.error("WebDAV配置验证失败");
        return false;
      }

      // 验证适配器
      if (!this.adapter.validateConfiguration()) {
        console.error("适配器配置验证失败");
        return false;
      }

      return true;
    } catch (error) {
      console.error("系统验证失败:", error);
      return false;
    }
  }
}

/**
 * 便捷函数：创建统一WebDAV认证系统
 * @param {D1Database} db - 数据库实例
 * @param {string} platform - 平台名称 (hono/workers/express)
 * @returns {UnifiedWebDAVAuth} 统一认证系统实例
 */
export function createUnifiedWebDAVAuth(db, platform = "hono") {
  const system = new UnifiedWebDAVAuth(db, platform);

  if (!system.validateSystem()) {
    throw new Error("WebDAV认证系统配置无效");
  }

  return system;
}

/**
 * 便捷函数：快速创建WebDAV中间件
 * @param {D1Database} db - 数据库实例
 * @param {string} platform - 平台名称
 * @returns {Function} 中间件函数
 */
export function createWebDAVMiddleware(db, platform = "hono") {
  const system = createUnifiedWebDAVAuth(db, platform);
  return system.createMiddleware();
}

/**
 * 便捷函数：检测WebDAV请求（跨平台）
 * @param {Object} request - 请求对象（任意平台格式）
 * @param {string} platform - 平台名称
 * @returns {boolean} 是否为WebDAV请求
 */
export function detectWebDAVRequest(request, platform = "hono") {
  try {
    const adapter = createAdapter(platform);
    const normalizedRequest = adapter.normalizeRequest(request);
    return isWebDAVRequest(normalizedRequest);
  } catch (error) {
    console.error("WebDAV请求检测失败:", error);
    return false;
  }
}

/**
 * 内部函数：创建适配器
 * @param {string} platform - 平台名称
 * @returns {BaseAdapter} 适配器实例
 */
function createAdapter(platform) {
  switch (platform.toLowerCase()) {
    case "hono":
      return createHonoAdapter();
    case "workers":
      return createWorkersAdapter();
    case "express":
      return createExpressAdapter();
    default:
      throw new Error(`不支持的平台: ${platform}`);
  }
}

/**
 * 默认导出：统一WebDAV认证系统
 */
export default UnifiedWebDAVAuth;
