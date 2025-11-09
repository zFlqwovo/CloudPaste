/**
 * S3存储配置路由
 */
import { Hono } from "hono";
import {
  getS3ConfigsByAdmin,
  getPublicS3Configs,
  getS3ConfigByIdForAdmin,
  getPublicS3ConfigById,
  createS3Config,
  updateS3Config,
  deleteS3Config,
  setDefaultS3Config,
  testS3Connection,
  getS3ConfigsWithUsage,
} from "../services/s3ConfigService.js";
import { DbTables, ApiStatus, UserType } from "../constants/index.js";
import { HTTPException } from "hono/http-exception";
import { decryptValue } from "../utils/crypto.js";
import { getPagination } from "../utils/common.js";
import { getEncryptionSecret } from "../utils/environmentUtils.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { createS3Client } from "../utils/s3Utils.js";
import { usePolicy } from "../security/policies/policies.js";
import { resolvePrincipal } from "../security/helpers/principal.js";
import { useRepositories } from "../utils/repositories.js";

const s3ConfigRoutes = new Hono();
const requireS3Read = usePolicy("s3.config.read");
const requireAdmin = usePolicy("admin.all");

// 获取S3配置列表（管理员权限或API密钥文件权限，支持分页）
s3ConfigRoutes.get("/api/s3-configs", requireS3Read, async (c) => {
  const db = c.env.DB;
  const repositoryFactory = useRepositories(c);
  const identity = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
  const isAdmin = identity.isAdmin;
  const adminId = identity.userId;

  if (isAdmin) {
    const hasPageParam = c.req.query("page") !== undefined;
    const hasLimitParam = c.req.query("limit") !== undefined;

    if (hasPageParam || hasLimitParam) {
      const { limit, page } = getPagination(c, { limit: 10, page: 1 });
      const result = await getS3ConfigsByAdmin(db, adminId, { page, limit }, repositoryFactory);
      return c.json({
        code: ApiStatus.SUCCESS,
        message: "获取S3配置列表成功",
        data: result.configs,
        total: result.total,
        success: true,
      });
    }

    const result = await getS3ConfigsByAdmin(db, adminId, {}, repositoryFactory);
    return c.json({
      code: ApiStatus.SUCCESS,
      message: "获取S3配置列表成功",
      data: result.configs,
      total: result.total,
      success: true,
    });
  }

  const configs = await getPublicS3Configs(db, repositoryFactory);
  return c.json({
    code: ApiStatus.SUCCESS,
    message: "获取S3配置列表成功",
    data: configs,
    total: configs.length,
    success: true,
  });
});

// 获取单个S3配置详情
s3ConfigRoutes.get("/api/s3-configs/:id", requireS3Read, async (c) => {
  const db = c.env.DB;
  const { id } = c.req.param();
  const repositoryFactory = useRepositories(c);
  const identity = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN, UserType.API_KEY] });
  const isAdmin = identity.isAdmin;
  const adminId = identity.userId;

  const config = isAdmin ? await getS3ConfigByIdForAdmin(db, id, adminId, repositoryFactory) : await getPublicS3ConfigById(db, id, repositoryFactory);

  return c.json({
    code: ApiStatus.SUCCESS,
    message: "获取S3配置成功",
    data: config,
    success: true,
  });
});

// 创建S3配置（管理员权限）
s3ConfigRoutes.post("/api/s3-configs", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const encryptionSecret = getEncryptionSecret(c);

  const body = await c.req.json();
  const repositoryFactory = useRepositories(c);
  const config = await createS3Config(db, body, adminId, encryptionSecret, repositoryFactory);

  return c.json({
    code: ApiStatus.CREATED,
    message: "S3配置创建成功",
    data: config,
    success: true,
  });
});

// 更新S3配置（管理员权限）
s3ConfigRoutes.put("/api/s3-configs/:id", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const { id } = c.req.param();
  const encryptionSecret = getEncryptionSecret(c);
  const repositoryFactory = useRepositories(c);

  const body = await c.req.json();
  await updateS3Config(db, id, body, adminId, encryptionSecret, repositoryFactory);

  await (async () => {
    const { MountManager } = await import("../storage/managers/MountManager.js");
    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    await mountManager.clearConfigCache("S3", id);
    console.log(`S3配置更新后已清理驱动缓存: ${id}`);
  })().catch((cacheError) => {
    console.warn("清理驱动缓存失败:", cacheError);
  });

  return c.json({
    code: ApiStatus.SUCCESS,
    message: "S3配置已更新",
    success: true,
  });
});

// 删除S3配置（管理员权限）
s3ConfigRoutes.delete("/api/s3-configs/:id", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const { id } = c.req.param();
  const encryptionSecret = getEncryptionSecret(c);
  const repositoryFactory = useRepositories(c);

  await (async () => {
    const { MountManager } = await import("../storage/managers/MountManager.js");
    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    await mountManager.clearConfigCache("S3", id);
    console.log(`S3配置删除前已清理驱动缓存: ${id}`);
  })().catch((cacheError) => {
    console.warn("清理驱动缓存失败:", cacheError);
  });

  await deleteS3Config(db, id, adminId, repositoryFactory);

  return c.json({
    code: ApiStatus.SUCCESS,
    message: "S3配置删除成功",
    success: true,
  });
});

// 设置默认S3配置（管理员权限）
s3ConfigRoutes.put("/api/s3-configs/:id/set-default", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const { id } = c.req.param();
  const repositoryFactory = useRepositories(c);
  await setDefaultS3Config(db, id, adminId, repositoryFactory);

  return c.json({
    code: ApiStatus.SUCCESS,
    message: "默认S3配置设置成功",
    success: true,
  });
});

// 测试S3配置连接（管理员权限）
s3ConfigRoutes.post("/api/s3-configs/:id/test", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: [UserType.ADMIN] });
  const { id } = c.req.param();
  const encryptionSecret = getEncryptionSecret(c);
  const requestOrigin = c.req.header("origin");
  const repositoryFactory = useRepositories(c);
  const testResult = await testS3Connection(db, id, adminId, encryptionSecret, requestOrigin, repositoryFactory);

  return c.json({
    code: ApiStatus.SUCCESS,
    message: testResult.message,
    data: {
      success: testResult.success,
      result: testResult.result,
    },
    success: true,
  });
});

export default s3ConfigRoutes;
