/**
 * WebDAV统一配置管理
 */

/**
 * WebDAV基础路径 - 标准配置
 */
export const WEBDAV_BASE_PATH = "/dav";

/**
 * WebDAV核心配置
 */
export const WEBDAV_CONFIG = {
  // 支持的HTTP方法
  SUPPORTED_METHODS: ["OPTIONS", "PROPFIND", "GET", "HEAD", "PUT", "DELETE", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK", "PROPPATCH"],

  // 路径配置
  PATH: {
    PREFIX: WEBDAV_BASE_PATH,
    MAX_LENGTH: 2048,
  },

  // 安全配置
  SECURITY: {
    CACHE_TTL: 300, // 5分钟认证缓存
    MAX_AUTH_ATTEMPTS: 5, // 预留：最大认证尝试次数
    MAX_USER_AGENT_LENGTH: 1000,
  },

  // 标准认证配置
  AUTHENTICATION: {
    // 标准认证头 - 符合RFC 7235和RFC 4918
    STANDARD_AUTH_HEADER: 'Basic realm="WebDAV", Bearer realm="WebDAV"',

    // 简化认证头 - 用于某些特殊客户端
    SIMPLE_AUTH_HEADER: 'Basic realm="WebDAV"',

    // 认证方式优先级
    AUTH_METHODS: ["Bearer", "ApiKey", "Basic"],

    // 认证缓存配置
    CACHE: {
      ENABLED: true,
      TTL: 300, // 5分钟
      MAX_ENTRIES: 1000,
      CLEANUP_INTERVAL: 60, // 1分钟清理一次
    },
  },

  // WebDAV协议配置
  PROTOCOL: {
    // 响应头配置
    RESPONSE_HEADERS: {
      Allow: null, // 动态设置
      Public: null, // 动态设置
      DAV: "1, 2, 3",
      "MS-Author-Via": "DAV",
      "Microsoft-Server-WebDAV-Extensions": "1",
      "X-MSDAVEXT": "1",
    },
  },

  // CORS配置
  CORS: {
    ENABLED: true,
    ALLOW_ORIGIN: "*",
    ALLOW_METHODS: null, // 使用SUPPORTED_METHODS
    ALLOW_HEADERS: ["Authorization", "Content-Type", "Depth", "If", "Lock-Token", "Overwrite", "Destination"],
  },
};

/**
 * 权限配置映射
 * 将HTTP方法映射到所需的权限
 */
export const WEBDAV_PERMISSIONS = {
  // 读取操作 - 需要WEBDAV_READ权限
  READ_OPERATIONS: ["OPTIONS", "PROPFIND", "GET", "HEAD"],

  // 写入操作 - 需要WEBDAV_MANAGE权限
  WRITE_OPERATIONS: ["PUT", "DELETE", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK", "PROPPATCH"],

  // 权限检查映射
  METHOD_PERMISSIONS: {
    OPTIONS: "WEBDAV_READ",
    PROPFIND: "WEBDAV_READ",
    GET: "WEBDAV_READ",
    HEAD: "WEBDAV_READ",
    PUT: "WEBDAV_MANAGE",
    DELETE: "WEBDAV_MANAGE",
    MKCOL: "WEBDAV_MANAGE",
    COPY: "WEBDAV_MANAGE",
    MOVE: "WEBDAV_MANAGE",
    LOCK: "WEBDAV_MANAGE",
    UNLOCK: "WEBDAV_MANAGE",
    PROPPATCH: "WEBDAV_MANAGE",
  },
};

/**
 * 平台特定配置
 *
 */
export const PLATFORM_CONFIG = {
  // Cloudflare Workers特定配置
  WORKERS: {
    HEADERS: {
      "CF-Cache-Status": "DYNAMIC",
    },
  },

  // Express/Docker特定配置
  EXPRESS: {
    TRUST_PROXY: true,
  },

  // Hono特定配置
  HONO: {
    // 暂无特殊配置
  },
};

/**
 * 获取WebDAV配置
 * @param {string} section - 配置节名称
 * @returns {Object} 配置对象
 */
export function getWebDAVConfig(section = null) {
  if (section) {
    return WEBDAV_CONFIG[section] || {};
  }
  return WEBDAV_CONFIG;
}

/**
 * 获取方法所需的权限
 * @param {string} method - HTTP方法
 * @returns {string} 所需权限名称
 */
export function getMethodPermission(method) {
  if (!method) return null;
  return WEBDAV_PERMISSIONS.METHOD_PERMISSIONS[method.toUpperCase()] || null;
}

/**
 * 检查方法是否为读取操作
 * @param {string} method - HTTP方法
 * @returns {boolean} 是否为读取操作
 */
export function isReadOperation(method) {
  if (!method) return false;
  return WEBDAV_PERMISSIONS.READ_OPERATIONS.includes(method.toUpperCase());
}

/**
 * 检查方法是否为写入操作
 * @param {string} method - HTTP方法
 * @returns {boolean} 是否为写入操作
 */
export function isWriteOperation(method) {
  if (!method) return false;
  return WEBDAV_PERMISSIONS.WRITE_OPERATIONS.includes(method.toUpperCase());
}

/**
 * 获取平台特定配置
 * @param {string} platform - 平台名称 (workers/express/hono)
 * @returns {Object} 平台配置
 */
export function getPlatformConfig(platform) {
  if (!platform) return {};
  return PLATFORM_CONFIG[platform.toUpperCase()] || {};
}

/**
 * 构建响应头
 * @param {Object} options - 选项
 * @param {boolean} options.includeCors - 是否包含CORS头
 * @param {Array} options.allowedMethods - 允许的方法列表
 * @returns {Object} 响应头对象
 */
export function buildResponseHeaders(options = {}) {
  const { includeCors = false, allowedMethods = null } = options;
  const headers = {};

  // 基础WebDAV头
  const methods = allowedMethods || WEBDAV_CONFIG.SUPPORTED_METHODS;
  headers["Allow"] = methods.join(", ");
  headers["Public"] = methods.join(", ");

  // 复制协议头
  Object.assign(headers, WEBDAV_CONFIG.PROTOCOL.RESPONSE_HEADERS);

  // CORS头
  if (includeCors && WEBDAV_CONFIG.CORS.ENABLED) {
    headers["Access-Control-Allow-Origin"] = WEBDAV_CONFIG.CORS.ALLOW_ORIGIN;
    headers["Access-Control-Allow-Methods"] = methods.join(", ");
    headers["Access-Control-Allow-Headers"] = WEBDAV_CONFIG.CORS.ALLOW_HEADERS.join(", ");
  }

  return headers;
}

/**
 * 获取认证头
 * @param {boolean} useSimple - 是否使用简化认证头
 * @returns {string} 认证头字符串
 */
export function getAuthHeader(useSimple = false) {
  return useSimple ? WEBDAV_CONFIG.AUTHENTICATION.SIMPLE_AUTH_HEADER : WEBDAV_CONFIG.AUTHENTICATION.STANDARD_AUTH_HEADER;
}

/**
 * 验证配置完整性
 * @returns {boolean} 配置是否有效
 */
export function validateConfig() {
  try {
    // 检查必需的配置节
    const requiredSections = ["SUPPORTED_METHODS", "PATH", "SECURITY", "AUTHENTICATION", "PROTOCOL"];

    for (const section of requiredSections) {
      if (!(section in WEBDAV_CONFIG)) {
        console.error(`WebDAV配置错误: 缺少${section}节`);
        return false;
      }
    }

    // 检查方法权限映射完整性
    for (const method of WEBDAV_CONFIG.SUPPORTED_METHODS) {
      if (!(method in WEBDAV_PERMISSIONS.METHOD_PERMISSIONS)) {
        console.error(`WebDAV配置错误: 方法${method}缺少权限映射`);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error("WebDAV配置验证失败:", error);
    return false;
  }
}
