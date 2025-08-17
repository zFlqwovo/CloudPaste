/**
 * 文件系统代理路由
 * 处理/p/*路径的文件访问请求
 * 专门用于web_proxy功能的文件代理访问
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../constants/index.js";
import { createErrorResponse } from "../utils/common.js";
import { MountManager } from "../storage/managers/MountManager.js";
import { FileSystem } from "../storage/fs/FileSystem.js";
import { findMountPointByPathForProxy } from "../storage/fs/utils/MountResolver.js";
import { PROXY_CONFIG, safeDecodeProxyPath } from "../constants/proxy.js";
import { ProxySignatureService } from "../services/ProxySignatureService.js";

const fsProxyRoutes = new Hono();

/**
 * 处理OPTIONS预检请求 - 代理路由
 */
fsProxyRoutes.options(`${PROXY_CONFIG.ROUTE_PREFIX}/*`, (c) => {
  // CORS头部将由全局CORS中间件自动处理
  return c.text("", 204); // No Content
});

/**
 * 处理文件代理访问
 * 路径格式：/p/mount/path/file.ext?download=true
 *
 */
fsProxyRoutes.get(`${PROXY_CONFIG.ROUTE_PREFIX}/*`, async (c) => {
  try {
    // 从URL中提取路径部分
    const url = new URL(c.req.url);
    const fullPath = url.pathname;
    // 移除代理前缀，得到实际文件路径，并进行安全解码
    const rawPath = fullPath.replace(new RegExp(`^${PROXY_CONFIG.ROUTE_PREFIX}`), "") || "/";
    const path = safeDecodeProxyPath(rawPath);
    const download = c.req.query("download") === "true";
    const db = c.env.DB;
    const encryptionSecret = c.env.ENCRYPTION_SECRET;

    console.log(`文件系统代理访问: ${path}, 下载模式: ${download}, 完整路径: ${fullPath}, 原始路径: ${rawPath}`);

    // 查找挂载点（已在MountResolver中验证web_proxy配置）
    const mountResult = await findMountPointByPathForProxy(db, path);

    if (mountResult.error) {
      console.warn(`代理访问失败 - 挂载点查找失败: ${mountResult.error.message}`);
      return c.json(createErrorResponse(mountResult.error.status, mountResult.error.message), mountResult.error.status);
    }

    // 挂载点验证成功，mountResult包含mount和subPath信息

    // 检查是否需要签名验证
    const signatureService = new ProxySignatureService(db, encryptionSecret);
    const signatureNeed = await signatureService.needsSignature(mountResult.mount);

    if (signatureNeed.required) {
      const signature = c.req.query(PROXY_CONFIG.SIGN_PARAM);

      if (!signature) {
        console.warn(`代理访问失败 - 缺少签名: ${path} (${signatureNeed.reason})`);
        throw new HTTPException(ApiStatus.UNAUTHORIZED, {
          message: `此文件需要签名访问 (${signatureNeed.description})`,
        });
      }

      const verifyResult = signatureService.verifyStorageSignature(path, signature);
      if (!verifyResult.valid) {
        console.warn(`代理访问失败 - 签名验证失败: ${path} (${verifyResult.reason})`);
        throw new HTTPException(ApiStatus.UNAUTHORIZED, {
          message: `签名验证失败: ${verifyResult.reason}`,
        });
      }

      console.log(`签名验证成功: ${path} (${signatureNeed.level}级别控制)`);
    } else {
      console.log(`无需签名验证: ${path} (${signatureNeed.reason})`);
    }

    // 创建FileSystem实例进行文件访问
    const mountManager = new MountManager(db, encryptionSecret);
    const fileSystem = new FileSystem(mountManager);

    // 获取文件名用于下载
    const fileName = path.split("/").filter(Boolean).pop() || "file";

    // 代理访问使用特殊的用户类型（因为已通过挂载点配置验证）
    const fileResponse = await fileSystem.downloadFile(path, fileName, c.req.raw, PROXY_CONFIG.USER_TYPE, PROXY_CONFIG.USER_TYPE);

    // 将外部Response的头部复制到Hono Context，确保CORS中间件能够正常工作
    for (const [key, value] of fileResponse.headers.entries()) {
      // 跳过一些可能冲突的头部，让Hono和CORS中间件处理
      if (!["access-control-allow-origin", "access-control-allow-credentials", "access-control-expose-headers"].includes(key.toLowerCase())) {
        c.header(key, value);
      }
    }

    // 如果是下载模式，设置下载头
    if (download) {
      c.header("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
    }

    return new Response(fileResponse.body, {
      status: fileResponse.status,
      headers: c.res.headers,
    });
  } catch (error) {
    console.error("文件系统代理访问错误:", error);

    if (error instanceof HTTPException) {
      return c.json(createErrorResponse(error.status, error.message), error.status);
    }

    return c.json(createErrorResponse(ApiStatus.INTERNAL_ERROR, "代理访问失败"), ApiStatus.INTERNAL_ERROR);
  }
});

export { fsProxyRoutes };
