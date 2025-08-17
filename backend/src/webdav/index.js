/**
 * WebDAV服务入口文件
 *
 */

import { handlePropfind } from "./methods/propfind.js";
import { handleOptions } from "./methods/options.js";
import { handlePut } from "./methods/put.js";
import { handleGet } from "./methods/get.js";
import { handleDelete } from "./methods/delete.js";
import { handleMkcol } from "./methods/mkcol.js";
import { handleMove } from "./methods/move.js";
import { handleCopy } from "./methods/copy.js";
import { handleLock } from "./methods/lock.js";
import { handleUnlock } from "./methods/unlock.js";
import { handleProppatch } from "./methods/proppatch.js";
import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../constants/index.js";
import { createWebDAVErrorResponse, addCorsHeaders } from "./utils/errorUtils.js";
import { createWebDAVMiddleware, getWebDAVConfig } from "./auth/index.js";

/**
 * 执行路径安全检查
 * 防止路径遍历攻击和其他安全威胁
 *
 * @param {string} path - 要检查的路径
 * @throws {HTTPException} 路径不安全时抛出异常
 */
function validatePathSecurity(path) {
  const config = getWebDAVConfig();

  // 检查路径长度
  if (path.length > config.PATH.MAX_LENGTH) {
    throw new HTTPException(400, {
      message: `Path too long: maximum ${config.PATH.MAX_LENGTH} characters allowed`,
    });
  }

  // 检查路径遍历攻击
  const dangerousPatterns = ["../", "..\\", "%2e%2e", "%2E%2E", "..%2f", "..%2F", "..%5c", "..%5C"];

  for (const pattern of dangerousPatterns) {
    if (path.includes(pattern)) {
      console.warn("WebDAV安全警告: 检测到路径遍历攻击尝试:", path);
      throw new HTTPException(400, {
        message: "Invalid path: path traversal not allowed",
      });
    }
  }

  // 检查控制字符
  if (/[\x00-\x1f\x7f]/.test(path)) {
    console.warn("WebDAV安全警告: 检测到控制字符:", path);
    throw new HTTPException(400, {
      message: "Invalid path: control characters not allowed",
    });
  }

  // 检查空字节注入
  if (path.includes("\0")) {
    console.warn("WebDAV安全警告: 检测到空字节注入:", path);
    throw new HTTPException(400, {
      message: "Invalid path: null bytes not allowed",
    });
  }
}

/**
 * 标准化路径处理
 *
 *
 * @param {string} rawPath - 原始路径
 * @returns {string} 标准化后的路径
 */
function normalizePath(rawPath) {
  let path;
  const config = getWebDAVConfig();

  // 安全的URL解码
  try {
    path = decodeURIComponent(rawPath);
  } catch (error) {
    console.warn("WebDAV路径解码失败:", error.message);
    throw new HTTPException(400, { message: "Invalid path encoding" });
  }

  // 移除WebDAV前缀
  path = path.replace(new RegExp(`^${config.PATH.PREFIX}/?`), "/");

  // 确保路径以/开头
  if (path === "" || path === "/") {
    path = "/";
  } else if (!path.startsWith("/")) {
    path = "/" + path;
  }

  return path;
}

/**
 * WebDAV统一认证中间件
 *
 * @param {Object} c - Hono上下文
 * @param {Function} next - 下一个中间件
 */
export const webdavAuthMiddleware = (c, next) => {
  const middleware = createWebDAVMiddleware(c.env.DB, "hono");
  return middleware(c, next);
};

/**
 * WebDAV主处理函数
 *
 *
 * @param {Object} c - Hono上下文
 * @returns {Response} HTTP响应
 */
export async function handleWebDAV(c) {
  const method = c.req.method;
  const url = new URL(c.req.url);

  // 获取认证上下文
  const userId = c.get("userId");
  const userType = c.get("userType");

  // 路径处理和安全检查
  const rawPath = url.pathname;
  let path;

  try {
    // 标准化路径
    path = normalizePath(rawPath);

    // 安全检查
    validatePathSecurity(path);
  } catch (error) {
    if (error instanceof HTTPException) {
      return new Response(error.message, {
        status: error.status,
        headers: { "Content-Type": "text/plain" },
      });
    }
    throw error;
  }

  // 获取认证上下文（已在上面获取）
  const db = c.env.DB;

  try {
    // 记录请求日志
    console.log(`WebDAV请求: ${method} ${path}, 用户类型: ${userType}`);

    // 方法分发 - 基于主流WebDAV服务器的方法处理模式
    let response;
    switch (method) {
      case "OPTIONS":
        response = await handleOptions(c, path, userId, userType, db);
        break;
      case "PROPFIND":
        response = await handlePropfind(c, path, userId, userType, db);
        break;
      case "GET":
      case "HEAD":
        response = await handleGet(c, path, userId, userType, db);
        break;
      case "PUT":
        response = await handlePut(c, path, userId, userType, db);
        break;
      case "DELETE":
        response = await handleDelete(c, path, userId, userType, db);
        break;
      case "MKCOL":
        response = await handleMkcol(c, path, userId, userType, db);
        break;
      case "MOVE":
        response = await handleMove(c, path, userId, userType, db);
        break;
      case "COPY":
        response = await handleCopy(c, path, userId, userType, db);
        break;
      case "LOCK":
        response = await handleLock(c, path, userId, userType, db);
        break;
      case "UNLOCK":
        response = await handleUnlock(c, path, userId, userType, db);
        break;
      case "PROPPATCH":
        response = await handleProppatch(c, path, userId, userType, db);
        break;
      default:
        console.warn(`WebDAV不支持的方法: ${method}`);
        throw new HTTPException(ApiStatus.METHOD_NOT_ALLOWED, {
          message: `Method ${method} not supported`,
        });
    }

    // 记录响应日志
    console.log(`WebDAV响应: ${method} ${path}, 状态码: ${response.status}`);
    return response;
  } catch (error) {
    console.error(`WebDAV处理错误: ${method} ${path}`, error);

    // 标准化错误处理
    if (error instanceof HTTPException) {
      return new Response(error.message, {
        status: error.status,
        headers: addCorsHeaders({ "Content-Type": "text/plain" }),
      });
    }

    // 通用错误响应
    return createWebDAVErrorResponse("Internal Server Error", 500);
  }
}
