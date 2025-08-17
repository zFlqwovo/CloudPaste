import { createWebDAVErrorResponse, addCorsHeaders } from "../utils/errorUtils.js";

/**
 * 处理WebDAV OPTIONS请求
 * 符合RFC 4918标准，支持CORS预检和WebDAV功能发现
 * @param {Object} c - Hono上下文
 * @param {string} path - 请求路径
 * @param {string|Object} userId - 用户ID或信息
 * @param {string} userType - 用户类型
 * @param {D1Database} db - 数据库实例
 * @returns {Response} HTTP响应
 */
export async function handleOptions(c, path, userId, userType, db) {
  try {
    // 检测是否为CORS预检请求
    const isCorsPreflightRequest = detectCorsPreflightRequest(c);

    if (isCorsPreflightRequest) {
      return handleCorsPreflightRequest(c);
    }

    // WebDAV OPTIONS请求需要认证和权限检查
    return await handleWebDAVOptionsRequest(c, path, userId, userType, db);
  } catch (error) {
    console.error("OPTIONS请求处理失败:", error);
    return createWebDAVErrorResponse("OPTIONS请求处理失败", 500, false);
  }
}

/**
 * 检测是否为CORS预检请求
 * @param {Object} c - Hono上下文
 * @returns {boolean} 是否为CORS预检请求
 */
function detectCorsPreflightRequest(c) {
  const origin = c.req.header("Origin");
  const accessControlRequestMethod = c.req.header("Access-Control-Request-Method");

  // CORS预检请求的特征：有Origin头且有Access-Control-Request-Method头
  return !!(origin && accessControlRequestMethod);
}

/**
 * 处理CORS预检请求
 * @param {Object} c - Hono上下文
 * @returns {Response} CORS预检响应
 */
function handleCorsPreflightRequest(c) {
  console.log("处理CORS预检请求");

  return new Response(null, {
    status: 204, // No Content
    headers: addCorsHeaders({
      "Content-Length": "0",
      "Content-Type": "text/plain",
    }),
  });
}

/**
 * 处理WebDAV OPTIONS请求
 * @param {Object} c - Hono上下文
 * @param {string} path - 请求路径
 * @param {string|Object} userId - 用户ID或信息
 * @param {string} userType - 用户类型
 * @param {D1Database} db - 数据库实例
 * @returns {Response} WebDAV OPTIONS响应
 */
async function handleWebDAVOptionsRequest(c, path, userId, userType, db) {
  // 检测支持的WebDAV功能
  const capabilities = detectWebDAVCapabilities();

  // 构建支持的方法列表
  const supportedMethods = buildSupportedMethodsList(capabilities);

  // 构建DAV合规级别
  const davLevel = buildDAVComplianceLevel(capabilities);

  // 获取客户端信息
  const clientInfo = detectClientInfo(c);

  // 构建响应头
  const headers = buildWebDAVResponseHeaders(supportedMethods, davLevel, clientInfo);

  // 记录日志
  logOptionsRequest(c, path, userType, davLevel, supportedMethods);

  return new Response(null, {
    status: 200,
    headers: headers,
  });
}

/**
 * 检测WebDAV功能支持
 * 符合RFC 4918标准：OPTIONS应该返回服务器支持的功能，而不是用户特定的权限
 * @returns {Object} 功能支持信息
 */
function detectWebDAVCapabilities() {
  // 返回服务器实际支持的功能，不基于用户权限
  const capabilities = {
    // 基础WebDAV功能（Class 1）
    basicWebDAV: true,
    propfind: true,
    get: true,
    put: true,
    delete: true,
    mkcol: true,
    copy: true,
    move: true,

    // 锁定功能（Class 2）
    locking: true, // 我们已经实现了完整的LOCK/UNLOCK

    // 属性修改功能（Class 3）
    proppatch: false, // 当前返回405 Method Not Allowed

    // 扩展功能
    versioning: false,
    acl: false,
    quota: false,
  };

  return capabilities;
}

/**
 * 构建支持的方法列表
 * @param {Object} capabilities - 功能支持信息
 * @returns {string[]} 支持的HTTP方法列表
 */
function buildSupportedMethodsList(capabilities) {
  const methods = ["OPTIONS", "HEAD"]; // 基础方法

  if (capabilities.get) methods.push("GET");
  if (capabilities.put) methods.push("PUT");
  if (capabilities.delete) methods.push("DELETE");
  if (capabilities.mkcol) methods.push("MKCOL");
  if (capabilities.copy) methods.push("COPY");
  if (capabilities.move) methods.push("MOVE");
  if (capabilities.propfind) methods.push("PROPFIND");
  if (capabilities.proppatch) methods.push("PROPPATCH");
  if (capabilities.locking) {
    methods.push("LOCK");
    methods.push("UNLOCK");
  }

  return methods;
}

/**
 * 构建DAV合规级别
 * @param {Object} capabilities - 功能支持信息
 * @returns {string} DAV合规级别字符串
 */
function buildDAVComplianceLevel(capabilities) {
  const levels = [];

  // Class 1: 基础WebDAV功能
  if (capabilities.basicWebDAV) {
    levels.push("1");
  }

  // Class 2: 锁定功能
  if (capabilities.locking) {
    levels.push("2");
  }

  // Class 3: 属性修改功能
  if (capabilities.proppatch) {
    levels.push("3");
  }

  return levels.join(",");
}

/**
 * 检测客户端信息
 * @param {Object} c - Hono上下文
 * @returns {Object} 客户端信息
 */
function detectClientInfo(c) {
  const userAgent = c.req.header("User-Agent") || "";

  return {
    isWindows: userAgent.includes("Microsoft") || userAgent.includes("Windows"),
    isMac: userAgent.includes("Darwin") || userAgent.includes("Mac"),
    isOffice: userAgent.includes("Microsoft Office") || userAgent.includes("Word") || userAgent.includes("Excel"),
    isWebDAVClient: userAgent.includes("WebDAV") || userAgent.includes("DAV"),
    userAgent: userAgent,
  };
}

/**
 * 构建WebDAV响应头
 * @param {string[]} supportedMethods - 支持的方法列表
 * @param {string} davLevel - DAV合规级别
 * @param {Object} clientInfo - 客户端信息
 * @returns {Object} 响应头对象
 */
function buildWebDAVResponseHeaders(supportedMethods, davLevel, clientInfo) {
  const baseHeaders = {
    // 标准WebDAV头
    DAV: davLevel,
    Allow: supportedMethods.join(", "),
    Public: supportedMethods.join(", "), // 一些客户端使用Public而不是Allow
    "Content-Length": "0",
    "Content-Type": "text/plain",

    // 服务器信息
    Server: "CloudPaste-WebDAV/1.0",

    // 标准HTTP头
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",

    // 安全头
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };

  // 客户端特定头（保持兼容性）
  if (clientInfo.isWindows) {
    baseHeaders["MS-Author-Via"] = "DAV";
  }

  if (clientInfo.isMac) {
    baseHeaders["X-DAV-Powered-By"] = "CloudPaste";
  }

  // 使用统一的CORS头部添加函数
  return addCorsHeaders(baseHeaders);
}

/**
 * 记录OPTIONS请求日志
 * @param {Object} c - Hono上下文
 * @param {string} path - 请求路径
 * @param {string} userType - 用户类型
 * @param {string} davLevel - DAV合规级别
 * @param {string[]} supportedMethods - 支持的方法列表
 */
function logOptionsRequest(c, path, userType, davLevel, supportedMethods) {
  const userAgent = c.req.header("User-Agent") || "Unknown";
  console.log(`WebDAV OPTIONS请求 - 路径: ${path}, 用户类型: ${userType}, DAV级别: ${davLevel}, 方法: ${supportedMethods.length}个, 客户端: ${userAgent.substring(0, 50)}`);
}
