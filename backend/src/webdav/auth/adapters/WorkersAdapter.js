/**
 * Cloudflare Workers WebDAV认证适配器
 * 专门处理Cloudflare Workers环境的WebDAV认证逻辑
 */

import { BaseAdapter } from "./BaseAdapter.js";
import { getPlatformConfig } from "../config/WebDAVConfig.js";
import { addCorsHeaders } from "../../utils/errorUtils.js";

/**
 * Workers适配器类
 */
export class WorkersAdapter extends BaseAdapter {
  constructor() {
    super("workers");
    this.config = getPlatformConfig("workers");
  }

  /**
   * 标准化Workers请求对象
   * @param {Object} context - Workers上下文 {request, env, ctx}
   * @returns {Object} 标准化的请求对象
   */
  normalizeRequest(context) {
    try {
      const { request, env, ctx } = context;
      const url = new URL(request.url);

      return {
        method: request.method,
        url: url.pathname + url.search,
        headers: this.normalizeHeaders(request),
        contentType: request.headers.get("Content-Type") || "",
        clientIp: this.getClientIp(context),
        userAgent: this.getUserAgent(context),
        // Workers特定属性
        workersRequest: request,
        env: env,
        ctx: ctx,
        fullUrl: request.url,
      };
    } catch (error) {
      console.error("Workers请求标准化失败:", error);
      throw new Error("请求标准化失败");
    }
  }

  /**
   * 标准化请求头
   * @param {Request} request - Workers Request对象
   * @returns {Object} 标准化的头部对象
   */
  normalizeHeaders(request) {
    const headers = {};

    // 获取Authorization头
    const authHeader = request.headers.get("Authorization");
    if (authHeader) {
      headers.authorization = authHeader;
    }

    // 获取其他重要头部
    const importantHeaders = ["Content-Type", "Content-Length", "User-Agent", "DAV", "Depth", "Destination", "If", "Lock-Token", "Overwrite"];

    for (const headerName of importantHeaders) {
      const value = request.headers.get(headerName);
      if (value) {
        headers[headerName.toLowerCase()] = value;
      }
    }

    return headers;
  }

  /**
   * 标准化响应对象
   * @param {Object} standardResponse - 标准响应对象
   * @param {Object} context - Workers上下文
   * @returns {Response} Workers Response对象
   */
  normalizeResponse(standardResponse, context) {
    const { statusCode, headers, body } = standardResponse;

    return new Response(body || null, {
      status: statusCode,
      headers: headers || {},
    });
  }

  /**
   * 设置认证上下文
   * Workers环境中将认证信息存储到请求头中传递
   *
   * @param {Object} context - Workers上下文
   * @param {Object} authResult - 认证结果
   */
  setAuthContext(context, authResult) {
    try {
      // Workers环境中，我们需要创建新的请求对象来传递认证信息
      const authHeaders = new Headers(context.request.headers);

      // 设置认证信息到头部
      authHeaders.set("X-WebDAV-User-Id", authResult.userId);
      authHeaders.set("X-WebDAV-User-Type", authResult.userType);
      authHeaders.set("X-WebDAV-Auth-Success", "true");

      if (authResult.userType === "apiKey" && authResult.authResult.keyInfo) {
        authHeaders.set("X-WebDAV-API-Key", authResult.authResult.keyInfo.key);
      }

      // 创建新的请求对象
      const newRequest = new Request(context.request, {
        headers: authHeaders,
      });

      // 更新上下文
      context.request = newRequest;
      context.authResult = authResult;

      console.log(`Workers WebDAV认证上下文设置完成: 用户类型=${authResult.userType}`);
    } catch (error) {
      console.error("Workers认证上下文设置失败:", error);
      throw new Error("认证上下文设置失败");
    }
  }

  /**
   * 获取客户端IP地址
   * @param {Object} context - Workers上下文
   * @returns {string} 客户端IP
   */
  getClientIp(context) {
    const request = context.request;

    // Cloudflare Workers特定的IP获取方式
    return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || request.headers.get("X-Real-IP") || "unknown";
  }

  /**
   * 获取用户代理
   * @param {Object} context - Workers上下文
   * @returns {string} 用户代理
   */
  getUserAgent(context) {
    return context.request.headers.get("User-Agent") || "Unknown";
  }

  /**
   * 创建成功响应
   * @returns {null} Workers中成功时返回null继续处理
   */
  createSuccessResponse() {
    // Workers中成功时不需要返回响应，继续处理请求
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
   * 处理Workers环境的WebDAV认证
   * @param {Object} context - Workers上下文 {request, env, ctx}
   * @param {Object} webdavAuth - WebDAV认证实例
   * @returns {Response|null} 响应对象或null
   */
  async handleWorkersWebDAV(context, webdavAuth) {
    try {
      const result = await this.handleWebDAVAuth(context, webdavAuth);

      // 如果返回了响应对象，直接返回
      if (result && result instanceof Response) {
        return result;
      }

      // 否则返回null，表示认证成功，继续处理请求
      return null;
    } catch (error) {
      console.error("Workers WebDAV认证错误:", error);
      return this.createInternalErrorResponse("WebDAV认证错误");
    }
  }

  /**
   * 创建Workers认证处理函数
   * @param {Object} webdavAuth - WebDAV认证实例
   * @returns {Function} Workers认证处理函数
   */
  createAuthHandler(webdavAuth) {
    return async (request, env, ctx) => {
      const context = { request, env, ctx };
      return await this.handleWorkersWebDAV(context, webdavAuth);
    };
  }

  /**
   * 获取支持的功能
   * @returns {Array} 支持的功能列表
   */
  getSupportedFeatures() {
    return [...super.getSupportedFeatures(), "workers_request_handling", "edge_computing_optimization", "cloudflare_headers_support", "auth_handler_creation"];
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
   * 验证Workers特定配置
   * @returns {boolean} 配置是否有效
   */
  validateConfiguration() {
    if (!super.validateConfiguration()) {
      return false;
    }

    try {
      // 检查Workers特定配置
      if (this.config.TIMEOUT && typeof this.config.TIMEOUT !== "number") {
        console.error("WorkersAdapter配置错误: TIMEOUT必须是数字");
        return false;
      }

      if (this.config.MAX_REQUEST_SIZE && typeof this.config.MAX_REQUEST_SIZE !== "number") {
        console.error("WorkersAdapter配置错误: MAX_REQUEST_SIZE必须是数字");
        return false;
      }

      return true;
    } catch (error) {
      console.error("WorkersAdapter配置验证失败:", error);
      return false;
    }
  }
}

/**
 * 创建Workers适配器实例
 * @returns {WorkersAdapter} 适配器实例
 */
export function createWorkersAdapter() {
  const adapter = new WorkersAdapter();

  if (!adapter.validateConfiguration()) {
    throw new Error("WorkersAdapter配置无效");
  }

  return adapter;
}

/**
 * 便捷函数：创建Workers WebDAV认证处理函数
 * @param {Object} webdavAuth - WebDAV认证实例
 * @returns {Function} Workers认证处理函数
 */
export function createWorkersWebDAVHandler(webdavAuth) {
  const adapter = createWorkersAdapter();
  return adapter.createAuthHandler(webdavAuth);
}
