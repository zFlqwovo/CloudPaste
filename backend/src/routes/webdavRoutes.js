/**
 * WebDAV路由定义
 */
import { Hono } from "hono";
import { webdavAuthMiddleware, handleWebDAV } from "../webdav/index.js";
import { HTTPException } from "hono/http-exception";
import { WEBDAV_BASE_PATH } from "../webdav/auth/config/WebDAVConfig.js";
import { ApiStatus } from "../constants/index.js";
import { webdavHeaders } from "../middlewares/webdavHeaders.js";

// 创建WebDAV路由处理程序
const webdavRoutes = new Hono();

// WebDAV认证和权限检查
webdavRoutes.use(WEBDAV_BASE_PATH, webdavAuthMiddleware);
webdavRoutes.use(`${WEBDAV_BASE_PATH}/*`, webdavAuthMiddleware);

// WebDAV标准响应头
webdavRoutes.use(WEBDAV_BASE_PATH, webdavHeaders());
webdavRoutes.use(`${WEBDAV_BASE_PATH}/*`, webdavHeaders());

// 明确定义各种WebDAV方法的处理函数，避免使用all通配符
const webdavMethods = ["GET", "PUT", "DELETE", "OPTIONS", "PROPFIND", "PROPPATCH", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK", "HEAD"];

// 注册WebDAV路由处理器
webdavMethods.forEach((method) => {
  webdavRoutes.on(method, WEBDAV_BASE_PATH, async (c) => {
    try {
      return await handleWebDAV(c);
    } catch (error) {
      console.error(`WebDAV ${method} 请求处理错误:`, error);
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "WebDAV服务处理错误" });
    }
  });
});

// 处理WebDAV子路径的请求
webdavMethods.forEach((method) => {
  webdavRoutes.on(method, `${WEBDAV_BASE_PATH}/*`, async (c) => {
    try {
      return await handleWebDAV(c);
    } catch (error) {
      console.error(`WebDAV ${method} 请求处理错误:`, error);
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "WebDAV服务处理错误" });
    }
  });
});

export default webdavRoutes;
