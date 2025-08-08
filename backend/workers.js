import app from "./src/index.js";
import { ApiStatus } from "./src/constants/index.js";
import { checkAndInitDatabase } from "./src/utils/database.js";
import { getWebDAVConfig, getPlatformConfig } from "./src/webdav/auth/index.js";

// 记录数据库是否已初始化的内存标识
let isDbInitialized = false;

// 导出Cloudflare Workers请求处理函数
export default {
  async fetch(request, env, ctx) {
    try {
      // 获取Workers平台配置（仅用于头部设置）
      const platformConfig = getPlatformConfig("workers");

      // 创建一个新的环境对象，将D1数据库连接和加密密钥添加到环境中
      const bindings = {
        ...env,
        DB: env.DB, // D1数据库
        ENCRYPTION_SECRET: env.ENCRYPTION_SECRET || "default-encryption-key", // 加密密钥
      };

      // 只在第一次请求时检查并初始化数据库
      if (!isDbInitialized) {
        console.log("首次请求，检查数据库状态...");
        isDbInitialized = true; // 先设置标记，避免并发请求重复初始化
        try {
          await checkAndInitDatabase(env.DB);
        } catch (error) {
          console.error("数据库初始化出错:", error);
          // 即使初始化出错，我们也继续处理请求
        }
      }

      // 检查是否是直接文件下载请求
      const url = new URL(request.url);
      const pathParts = url.pathname.split("/");

      // 统一WebDAV请求处理
      if (url.pathname === "/dav" || url.pathname.startsWith("/dav/")) {
        console.log(`WebDAV请求在Workers环境中: ${request.method} ${url.pathname}`);

        try {
          // 直接将WebDAV请求传递给Hono应用处理
          // Hono层的webdavAuthMiddleware会处理认证
          const response = await app.fetch(request, bindings, ctx);

          // 为响应添加标准WebDAV头部
          const config = getWebDAVConfig();
          const newResponse = new Response(response.body, response);

          // 添加WebDAV协议头
          const webdavHeaders = {
            Allow: config.SUPPORTED_METHODS.join(", "),
            Public: config.SUPPORTED_METHODS.join(", "),
            DAV: config.PROTOCOL.RESPONSE_HEADERS.DAV,
            "MS-Author-Via": config.PROTOCOL.RESPONSE_HEADERS["MS-Author-Via"],
            "Microsoft-Server-WebDAV-Extensions": config.PROTOCOL.RESPONSE_HEADERS["Microsoft-Server-WebDAV-Extensions"],
            "X-MSDAVEXT": config.PROTOCOL.RESPONSE_HEADERS["X-MSDAVEXT"],
          };

          // 应用平台特定头部
          if (platformConfig.HEADERS) {
            Object.entries(platformConfig.HEADERS).forEach(([key, value]) => {
              webdavHeaders[key] = value;
            });
          }

          // 添加CORS头
          if (config.CORS.ENABLED) {
            webdavHeaders["Access-Control-Allow-Origin"] = config.CORS.ALLOW_ORIGIN;
            webdavHeaders["Access-Control-Allow-Methods"] = config.SUPPORTED_METHODS.join(", ");
            webdavHeaders["Access-Control-Allow-Headers"] = config.CORS.ALLOW_HEADERS.join(", ");
            webdavHeaders["Access-Control-Max-Age"] = "86400";
          }

          // 只添加还没有的响应头
          for (const [key, value] of Object.entries(webdavHeaders)) {
            if (!newResponse.headers.has(key)) {
              newResponse.headers.set(key, value);
            }
          }

          return newResponse;
        } catch (error) {
          console.error("Workers WebDAV处理错误:", error);

          return new Response("WebDAV处理错误", {
            status: 500,
            headers: { "Content-Type": "text/plain" },
          });
        }
      }

      // 处理原始文本内容请求 /api/raw/:slug
      if (pathParts.length >= 4 && pathParts[1] === "api" && pathParts[2] === "raw") {
        // 将请求转发到API应用，它会路由到userPasteRoutes中的/api/raw/:slug处理器
        return app.fetch(request, bindings, ctx);
      }

      // 处理其他API请求
      return app.fetch(request, bindings, ctx);
    } catch (error) {
      console.error("处理请求时发生错误:", error);

      // 兼容前端期望的错误格式
      return new Response(
        JSON.stringify({
          code: ApiStatus.INTERNAL_ERROR,
          message: "服务器内部错误",
          error: error.message,
          success: false,
          data: null,
        }),
        {
          status: ApiStatus.INTERNAL_ERROR,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  },
};
