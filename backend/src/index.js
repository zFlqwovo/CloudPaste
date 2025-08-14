import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import adminRoutes from "./routes/adminRoutes.js";
import apiKeyRoutes from "./routes/apiKeyRoutes.js";
import { backupRoutes } from "./routes/backupRoutes.js";

import s3ConfigRoutes from "./routes/s3ConfigRoutes.js";
import systemRoutes from "./routes/systemRoutes.js";
import mountRoutes from "./routes/mountRoutes.js";
import webdavRoutes from "./routes/webdavRoutes.js";
import fsRoutes from "./routes/fsRoutes.js";
import { DbTables, ApiStatus } from "./constants/index.js";
import { createErrorResponse } from "./utils/common.js";
import filesRoutes from "./routes/filesRoutes.js";
import pastesRoutes from "./routes/pastesRoutes.js";
import s3UploadRoutes from "./routes/s3UploadRoutes.js";
import fileViewRoutes from "./routes/fileViewRoutes.js";
import urlUploadRoutes from "./routes/urlUploadRoutes.js";
import { fsProxyRoutes } from "./routes/fsProxyRoutes.js";
import { authGateway } from "./middlewares/authGatewayMiddleware.js";

// 创建一个Hono应用实例
const app = new Hono();

// 注册中间件
app.use("*", logger());
app.use(
  "*",
  cors({
    // 在使用credentials时，origin不能是'*'，需要指定具体域名
    // 对于开发环境，可以使用函数动态返回请求的origin
    origin: (origin) => {
      // 允许任何origin发送的请求，但返回实际的origin而不是'*'
      // 这是为了支持credentials: true的情况
      return origin || "*";
    },
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-API-KEY",
      "Depth",
      "Destination",
      "Overwrite",
      "If-Match",
      "If-None-Match",
      "If-Modified-Since",
      "If-Unmodified-Since",
      "Lock-Token",
      "Content-Length", // 添加Content-Length头
      "X-Requested-With", // 添加X-Requested-With头，支持AJAX请求
    ],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PROPFIND", "PROPPATCH", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK", "HEAD"],
    exposeHeaders: ["ETag", "Content-Length", "Content-Disposition"], // 暴露更多响应头
    maxAge: 86400,
    credentials: true, // 允许携带凭证
  })
);

// 注册路由
app.route("/", adminRoutes);
app.route("/", apiKeyRoutes);
app.route("/", backupRoutes);
app.route("/", fileViewRoutes);
app.route("/", filesRoutes);
app.route("/", pastesRoutes);
app.route("/", s3UploadRoutes);
app.route("/", urlUploadRoutes);
app.route("/", s3ConfigRoutes);
app.route("/", systemRoutes);
app.route("/", mountRoutes);
app.route("/", webdavRoutes);
app.route("/", fsRoutes);
app.route("/", fsProxyRoutes);

// 健康检查路由
app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// 全局错误处理
app.onError((err, c) => {
  console.error(`[错误] ${err.message}`, err.stack);

  if (err instanceof HTTPException) {
    const status = err.status || ApiStatus.INTERNAL_ERROR;
    const message = err.message || "服务器内部错误";
    return c.json(createErrorResponse(status, message), status);
  }

  return c.json(createErrorResponse(ApiStatus.INTERNAL_ERROR, "服务器内部错误"), ApiStatus.INTERNAL_ERROR);
});

// 404路由处理
app.notFound((c) => {
  return c.json(createErrorResponse(ApiStatus.NOT_FOUND, "未找到请求的资源"), ApiStatus.NOT_FOUND);
});

// 将应用导出为默认值
export default app;
