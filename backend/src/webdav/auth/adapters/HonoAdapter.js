/**
 * Hono框架WebDAV认证适配器
 * 专门处理Hono框架的WebDAV认证逻辑
 *
 */

import { BaseAdapter } from "./BaseAdapter.js";
import { getPlatformConfig } from "../config/WebDAVConfig.js";
import { addCorsHeaders } from "../../utils/errorUtils.js";

/**
 * Hono适配器类
 */
export class HonoAdapter extends BaseAdapter {
  constructor() {
    super("hono");
    this.config = getPlatformConfig("hono");
  }

  /**
   * 标准化Hono请求对象
   * @param {Object} c - Hono Context对象
   * @returns {Object} 标准化的请求对象
   */
  normalizeRequest(c) {
    try {
      const req = c.req;

      return {
        method: req.method,
        url: req.url,
        headers: this.normalizeHeaders(req),
        contentType: req.header("Content-Type") || "",
        clientIp: this.getClientIp(c),
        userAgent: this.getUserAgent(c),
        // Hono特定属性
        honoContext: c,
        env: c.env,
      };
    } catch (error) {
      console.error("Hono请求标准化失败:", error);
      throw new Error("请求标准化失败");
    }
  }

  /**
   * 标准化请求头
   * @param {Object} req - Hono请求对象
   * @returns {Object} 标准化的头部对象
   */
  normalizeHeaders(req) {
    const headers = {};

    // 获取Authorization头
    const authHeader = req.header("Authorization");
    if (authHeader) {
      headers.authorization = authHeader;
    }

    // 获取其他重要头部
    const importantHeaders = ["Content-Type", "Content-Length", "User-Agent", "DAV", "Depth", "Destination", "If", "Lock-Token", "Overwrite"];

    for (const headerName of importantHeaders) {
      const value = req.header(headerName);
      if (value) {
        headers[headerName.toLowerCase()] = value;
      }
    }

    return headers;
  }

  /**
   * 标准化响应对象
   * @param {Object} standardResponse - 标准响应对象
   * @param {Object} c - Hono Context对象
   * @returns {Response} Hono Response对象
   */
  normalizeResponse(standardResponse, c) {
    const { statusCode, headers, body } = standardResponse;

    return new Response(body || null, {
      status: statusCode,
      headers: headers || {},
    });
  }

  /**
   * 设置认证上下文
   * @param {Object} c - Hono Context对象
   * @param {Object} authResult - 认证结果
   */
  setAuthContext(c, authResult) {
    try {
      // 设置用户信息 - 为API密钥用户传递完整的用户信息对象
      if (authResult.userType === "apiKey" && authResult.authResult.keyInfo) {
        // API密钥用户：传递完整的用户信息对象
        c.set("userId", {
          id: authResult.authResult.keyInfo.id,
          name: authResult.authResult.keyInfo.name,
          basicPath: authResult.authResult.keyInfo.basicPath,
          permissions: authResult.authResult.keyInfo.permissions,
          role: authResult.authResult.keyInfo.role,
          isGuest: authResult.authResult.keyInfo.isGuest,
        });
      } else {
        // 管理员用户：传递字符串ID
        c.set("userId", authResult.userId);
      }
      c.set("userType", authResult.userType);
      c.set("authResult", authResult.authResult);

      // 设置认证信息对象
      const authInfo = {
        userId: authResult.userId,
        isAdmin: authResult.userType === "admin",
        apiKey: authResult.userType === "apiKey" ? authResult.authResult.keyInfo?.key : null,
        apiKeyInfo: authResult.userType === "apiKey" ? authResult.authResult.keyInfo : null,
        permissions: authResult.permissions,
        fromCache: authResult.fromCache || false,
      };

      c.set("authInfo", authInfo);

      console.log(`Hono WebDAV认证上下文设置完成: 用户类型=${authResult.userType}`);
    } catch (error) {
      console.error("Hono认证上下文设置失败:", error);
      throw new Error("认证上下文设置失败");
    }
  }

  /**
   * 获取客户端IP地址
   * @param {Object} c - Hono Context对象
   * @returns {string} 客户端IP
   */
  getClientIp(c) {
    // 按优先级获取客户端IP
    return c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || c.req.header("X-Real-IP") || c.req.header("X-Client-IP") || "unknown";
  }

  /**
   * 获取用户代理
   * @param {Object} c - Hono Context对象
   * @returns {string} 用户代理
   */
  getUserAgent(c) {
    return c.req.header("User-Agent") || "Unknown";
  }

  /**
   * 创建成功响应
   * @returns {null} Hono中间件成功时返回null继续执行
   */
  createSuccessResponse() {
    // Hono中间件成功时不需要返回响应，继续执行下一个中间件
    return null;
  }

  /**
   * 创建挑战响应
   * @param {string} message - 响应消息
   * @param {Object} headers - 响应头
   * @returns {Response} 挑战响应
   */
  createChallengeResponse(message, headers) {
    return new Response(message, {
      status: 401,
      headers: addCorsHeaders(headers || {}),
    });
  }

  /**
   * 创建禁止响应
   * @param {string} message - 响应消息
   * @returns {Response} 禁止响应
   */
  createForbiddenResponse(message) {
    return new Response(message, {
      status: 403,
      headers: addCorsHeaders({
        "Content-Type": "text/plain",
      }),
    });
  }

  /**
   * 创建未授权响应
   * @param {string} message - 响应消息
   * @returns {Response} 未授权响应
   */
  createUnauthorizedResponse(message) {
    return new Response(message, {
      status: 401,
      headers: addCorsHeaders({
        "Content-Type": "text/plain",
      }),
    });
  }

  /**
   * 创建未找到响应
   * @returns {Response} 未找到响应
   */
  createNotFoundResponse() {
    return new Response("Not Found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  }

  /**
   * 创建内部错误响应
   * @param {string} message - 错误消息
   * @returns {Response} 内部错误响应
   */
  createInternalErrorResponse(message) {
    return new Response(message, {
      status: 500,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  }

  /**
   * 创建Hono中间件
   * @param {Object} webdavAuth - WebDAV认证实例
   * @returns {Function} Hono中间件函数
   */
  createMiddleware(webdavAuth) {
    return async (c, next) => {
      try {
        const result = await this.handleWebDAVAuth(c, webdavAuth, next);

        // 如果返回了响应对象，直接返回
        if (result && result instanceof Response) {
          return result;
        }

        // 否则继续执行下一个中间件
        return result;
      } catch (error) {
        console.error("Hono WebDAV中间件错误:", error);
        return this.createInternalErrorResponse("WebDAV认证中间件错误");
      }
    };
  }

  /**
   * 获取支持的功能
   * @returns {Array} 支持的功能列表
   */
  getSupportedFeatures() {
    return [...super.getSupportedFeatures(), "hono_context_handling", "cloudflare_workers_support", "environment_variables_access", "middleware_creation"];
  }

  /**
   * 获取适配器统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      ...this.getAdapterInfo(),
      config: this.config,
      runtime: "cloudflare_workers",
      features: this.getSupportedFeatures(),
    };
  }

  /**
   * 验证Hono特定配置
   * @returns {boolean} 配置是否有效
   */
  validateConfiguration() {
    if (!super.validateConfiguration()) {
      return false;
    }

    try {
      // 检查Hono特定配置
      if (this.config.TIMEOUT && typeof this.config.TIMEOUT !== "number") {
        console.error("HonoAdapter配置错误: TIMEOUT必须是数字");
        return false;
      }

      return true;
    } catch (error) {
      console.error("HonoAdapter配置验证失败:", error);
      return false;
    }
  }
}

/**
 * 创建Hono适配器实例
 * @returns {HonoAdapter} 适配器实例
 */
export function createHonoAdapter() {
  const adapter = new HonoAdapter();

  if (!adapter.validateConfiguration()) {
    throw new Error("HonoAdapter配置无效");
  }

  return adapter;
}

/**
 * 便捷函数：创建Hono WebDAV认证中间件
 * @param {Object} webdavAuth - WebDAV认证实例
 * @returns {Function} Hono中间件函数
 */
export function createHonoWebDAVMiddleware(webdavAuth) {
  const adapter = createHonoAdapter();
  return adapter.createMiddleware(webdavAuth);
}
