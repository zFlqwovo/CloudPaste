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
import { DbTables, ApiStatus } from "../constants/index.js";
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

const s3ConfigRoutes = new Hono();
const requireS3Read = usePolicy("s3.config.read");
const requireAdmin = usePolicy("admin.all");

// 获取S3配置列表（管理员权限或API密钥文件权限，支持分页）
s3ConfigRoutes.get("/api/s3-configs", requireS3Read, async (c) => {
  const db = c.env.DB;

  try {
    const identity = resolvePrincipal(c, { allowedTypes: ["admin", "apikey"] });
    const isAdmin = identity.isAdmin;
    const adminId = identity.userId;

    if (isAdmin) {
      // 管理员：区分分页请求和兼容性请求
      const hasPageParam = c.req.query("page") !== undefined;
      const hasLimitParam = c.req.query("limit") !== undefined;

      if (hasPageParam || hasLimitParam) {
        // 明确的分页查询
        const { limit, page } = getPagination(c, { limit: 10, page: 1 });
        const result = await getS3ConfigsByAdmin(db, adminId, { page, limit });

        return c.json({
          code: ApiStatus.SUCCESS,
          message: "获取S3配置列表成功",
          data: result.configs,
          total: result.total,
          success: true,
        });
      } else {
        // 兼容性：返回所有数据（用于下拉选项等场景）
        const result = await getS3ConfigsByAdmin(db, adminId);

        return c.json({
          code: ApiStatus.SUCCESS,
          message: "获取S3配置列表成功",
          data: result.configs,
          total: result.total,
          success: true,
        });
      }
    } else {
      // API密钥用户只能看到公开的配置（暂不支持分页）
      const configs = await getPublicS3Configs(db);

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "获取S3配置列表成功",
        data: configs,
        total: configs.length,
        success: true,
      });
    }
  } catch (error) {
    console.error("获取S3配置列表错误:", error);
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "获取S3配置列表失败" });
  }
});

// 获取单个S3配置详情
s3ConfigRoutes.get("/api/s3-configs/:id", requireS3Read, async (c) => {
  const db = c.env.DB;
  const { id } = c.req.param();

  try {
    let config;
    const identity = resolvePrincipal(c, { allowedTypes: ["admin", "apikey"] });
    const isAdmin = identity.isAdmin;
    const adminId = identity.userId;

    if (isAdmin) {
      // 管理员查询
      config = await getS3ConfigByIdForAdmin(db, id, adminId);
    } else {
      // API密钥用户查询
      config = await getPublicS3ConfigById(db, id);
    }

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "获取S3配置成功",
      data: config, // 不返回敏感字段
      success: true, // 添加兼容字段
    });
  } catch (error) {
    console.error("获取S3配置错误:", error);
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "获取S3配置失败" });
  }
});

// 创建S3配置（管理员权限）
s3ConfigRoutes.post("/api/s3-configs", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: ["admin"] });
  const encryptionSecret = getEncryptionSecret(c);

  try {
    const body = await c.req.json();
    const config = await createS3Config(db, body, adminId, encryptionSecret);

    // 返回创建成功响应
    return c.json({
      code: ApiStatus.CREATED,
      message: "S3配置创建成功",
      data: config,
      success: true, // 添加兼容字段
    });
  } catch (error) {
    console.error("创建S3配置错误:", error);
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "创建S3配置失败" });
  }
});

// 更新S3配置（管理员权限）
s3ConfigRoutes.put("/api/s3-configs/:id", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: ["admin"] });
  const { id } = c.req.param();
  const encryptionSecret = getEncryptionSecret(c);

  try {
    const body = await c.req.json();
    await updateS3Config(db, id, body, adminId, encryptionSecret);

    // S3配置更新后，清理相关的驱动缓存
    try {
      const { MountManager } = await import("../storage/managers/MountManager.js");
      const mountManager = new MountManager(db, encryptionSecret);
      await mountManager.clearConfigCache("S3", id);
      console.log(`S3配置更新后已清理驱动缓存: ${id}`);
    } catch (cacheError) {
      console.warn("清理驱动缓存失败:", cacheError);
      // 缓存清理失败不影响主要操作
    }

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "S3配置已更新",
      success: true, // 添加兼容字段
    });
  } catch (error) {
    console.error("更新S3配置错误:", error);
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "更新S3配置失败" });
  }
});

// 删除S3配置（管理员权限）
s3ConfigRoutes.delete("/api/s3-configs/:id", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: ["admin"] });
  const { id } = c.req.param();
  const encryptionSecret = getEncryptionSecret(c);

  try {
    // S3配置删除前，先清理相关的驱动缓存
    try {
      const { MountManager } = await import("../storage/managers/MountManager.js");
      const mountManager = new MountManager(db, encryptionSecret);
      await mountManager.clearConfigCache("S3", id);
      console.log(`S3配置删除前已清理驱动缓存: ${id}`);
    } catch (cacheError) {
      console.warn("清理驱动缓存失败:", cacheError);
      // 缓存清理失败不影响主要操作
    }

    await deleteS3Config(db, id, adminId);

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "S3配置删除成功",
      success: true, // 添加兼容字段
    });
  } catch (error) {
    console.error("删除S3配置错误:", error);
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "删除S3配置失败" });
  }
});

// 设置默认S3配置（管理员权限）
s3ConfigRoutes.put("/api/s3-configs/:id/set-default", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: ["admin"] });
  const { id } = c.req.param();

  try {
    await setDefaultS3Config(db, id, adminId);

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "默认S3配置设置成功",
      success: true,
    });
  } catch (error) {
    console.error("设置默认S3配置错误:", error);
    if (error instanceof HTTPException) {
      throw error;
    }
    throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "设置默认S3配置失败" });
  }
});

// 测试S3配置连接（管理员权限）
s3ConfigRoutes.post("/api/s3-configs/:id/test", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: ["admin"] });
  const { id } = c.req.param();
  const encryptionSecret = getEncryptionSecret(c);
  const requestOrigin = c.req.header("origin");

  try {
    const testResult = await testS3Connection(db, id, adminId, encryptionSecret, requestOrigin);

    return c.json({
      code: ApiStatus.SUCCESS,
      message: testResult.message,
      data: {
        success: testResult.success,
        result: testResult.result,
      },
      success: true, // 添加兼容字段
    });
  } catch (error) {
    console.error("测试S3配置错误:", error);
    throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "测试S3配置失败" });
  }
});

export default s3ConfigRoutes;
