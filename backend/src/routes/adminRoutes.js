import { Hono } from "hono";
import { login, logout, changePassword, testAdminToken } from "../services/adminService.js";
import { ApiStatus } from "../constants/index.js";
import { directoryCacheManager, s3UrlCacheManager, searchCacheManager } from "../cache/index.js";
import { invalidateFsCache, invalidateAllCaches } from "../cache/invalidation.js";
import { usePolicy } from "../security/policies/policies.js";
import { resolvePrincipal } from "../security/helpers/principal.js";

const adminRoutes = new Hono();
const requireAdmin = usePolicy("admin.all");
const requireMountView = usePolicy("fs.base");

// 管理员登录
adminRoutes.post("/api/admin/login", async (c) => {
  const db = c.env.DB;
  const { username, password } = await c.req.json();

  try {
    const loginResult = await login(db, username, password);

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "登录成功",
      data: loginResult,
    });
  } catch (error) {
    throw error;
  }
});

// 管理员登出 - 不需要认证检查，因为可能令牌已过期
adminRoutes.post("/api/admin/logout", async (c) => {
  const db = c.env.DB;
  const authHeader = c.req.header("Authorization");

  // 如果没有认证头，直接返回成功（前端清理状态）
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({
      code: ApiStatus.SUCCESS,
      message: "登出成功",
    });
  }

  const token = authHeader.substring(7);

  try {
    await logout(db, token);
  } catch (error) {
    // 即使登出失败（如令牌不存在），也返回成功，让前端清理状态
    console.log("登出时清理令牌失败（可能已过期）:", error.message);
  }

  return c.json({
    code: ApiStatus.SUCCESS,
    message: "登出成功",
  });
});

// 更改管理员密码（需要认证）
adminRoutes.post("/api/admin/change-password", requireAdmin, async (c) => {
  const db = c.env.DB;
  const { userId: adminId } = resolvePrincipal(c, { allowedTypes: ["admin"] });
  const { currentPassword, newPassword, newUsername } = await c.req.json();

  await changePassword(db, adminId, currentPassword, newPassword, newUsername);

  return c.json({
    code: ApiStatus.SUCCESS,
    message: "信息更新成功，请重新登录",
  });
});

// 测试管理员令牌路由
adminRoutes.get("/api/test/admin-token", requireAdmin, async (c) => {
  // 使用新的统一认证系统，管理员权限已在中间件中验证
  return c.json({
    code: ApiStatus.SUCCESS,
    message: "令牌有效",
    success: true,
  });
});

// 获取系统监控信息（包括缓存统计和系统内存）
adminRoutes.get("/api/admin/cache/stats", requireAdmin, async (c) => {
  try {
    const dirStats = directoryCacheManager.getStats();

    // 获取S3URL缓存统计
    let s3UrlStats = null;
    try {
      s3UrlStats = s3UrlCacheManager.getStats();
    } catch (error) {
      console.warn("获取S3URL缓存统计失败:", error);
      s3UrlStats = { error: "S3URL缓存模块未加载" };
    }

    // 获取搜索缓存统计
    let searchStats = null;
    try {
      searchStats = searchCacheManager.getStats();
    } catch (error) {
      console.warn("获取搜索缓存统计失败:", error);
      searchStats = { error: "搜索缓存模块未加载" };
    }

    // 获取系统内存使用情况
    const memUsage = process.memoryUsage();
    const systemMemory = {
      rss: Math.round(memUsage.rss / 1024 / 1024), // 常驻集大小(MB)
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // 总堆内存(MB)
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // 已用堆内存(MB)
      external: Math.round(memUsage.external / 1024 / 1024), // 外部内存(MB)
      arrayBuffers: memUsage.arrayBuffers ? Math.round(memUsage.arrayBuffers / 1024 / 1024) : 0, // Buffer内存(MB)
      heapUsagePercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100), // 堆内存使用率
    };

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "获取系统监控信息成功",
      data: {
        cache: {
          directory: dirStats,
          s3Url: s3UrlStats,
          search: searchStats,
        },
        system: {
          memory: systemMemory,
          uptime: Math.round(process.uptime()), // 运行时间(秒)
        },
        timestamp: new Date().toISOString(),
      },
      success: true,
    });
  } catch (error) {
    console.error("获取系统监控信息错误:", error);
    return c.json(
      {
        code: ApiStatus.INTERNAL_ERROR,
        message: error.message || "获取系统监控信息失败",
        success: false,
      },
      ApiStatus.INTERNAL_ERROR
    );
  }
});

// 清理目录缓存（管理员）
adminRoutes.post("/api/admin/cache/clear", requireAdmin, async (c) => {
  const db = c.env.DB;

  try {
    // 获取请求参数
    const { mountId, s3ConfigId } = await c.req.json().catch(() => ({}));

    let clearedScope = null;

    // 如果指定了挂载点ID，清理特定挂载点的缓存
    if (mountId) {
      invalidateFsCache({ mountId, reason: "admin-manual", db });
      clearedScope = `mount:${mountId}`;
      console.log(`管理员手动清理挂载点缓存 - 挂载点ID: ${mountId}`);
    }
    // 如果指定了S3配置ID，清理相关挂载点的缓存
    else if (s3ConfigId) {
      invalidateFsCache({ s3ConfigId, reason: "admin-manual", db });
      clearedScope = `s3Config:${s3ConfigId}`;
      console.log(`管理员手动清理S3配置缓存 - S3配置ID: ${s3ConfigId}`);
    }
    // 如果没有指定参数，清理所有缓存
    else {
      invalidateAllCaches({ reason: "admin-manual-all" });
      clearedScope = "all";
      console.log(`管理员手动清理所有缓存`);
    }

    return c.json({
      code: ApiStatus.SUCCESS,
      message: `缓存清理操作已触发`,
      data: {
        scope: clearedScope,
        timestamp: new Date().toISOString(),
      },
      success: true,
    });
  } catch (error) {
    console.error("管理员清理缓存错误:", error);
    return c.json(
      {
        code: ApiStatus.INTERNAL_ERROR,
        message: error.message || "清理缓存失败",
        success: false,
      },
      ApiStatus.INTERNAL_ERROR
    );
  }
});

// 清理目录缓存（API密钥用户）
adminRoutes.post("/api/user/cache/clear", requireMountView, async (c) => {
  const db = c.env.DB;
  const identity = resolvePrincipal(c, { allowedTypes: ["admin", "apikey"] });
  const apiKeyInfo = identity.apiKeyInfo;

  try {
    // 获取请求参数
    const { mountId, s3ConfigId } = await c.req.json().catch(() => ({}));

    let clearedScope = null;

    // 如果指定了挂载点ID，清理特定挂载点的缓存
    if (mountId) {
      invalidateFsCache({ mountId, reason: "user-manual", db });
      clearedScope = `mount:${mountId}`;
      console.log(`API密钥用户手动清理挂载点缓存 - 用户: ${apiKeyInfo?.name || identity.type}, 挂载点ID: ${mountId}`);
    } else if (s3ConfigId) {
      invalidateFsCache({ s3ConfigId, reason: "user-manual", db });
      clearedScope = `s3Config:${s3ConfigId}`;
      console.log(`API密钥用户手动清理S3配置缓存 - 用户: ${apiKeyInfo?.name || identity.type}, S3配置ID: ${s3ConfigId}`);
    } else {
      invalidateAllCaches({ reason: "user-manual-all" });
      clearedScope = "all";
      console.log(`API密钥用户手动清理所有缓存 - 用户: ${apiKeyInfo?.name || identity.type}`);
    }

    return c.json({
      code: ApiStatus.SUCCESS,
      message: `缓存清理操作已触发`,
      data: {
        scope: clearedScope,
        timestamp: new Date().toISOString(),
      },
      success: true,
    });
  } catch (error) {
    console.error("API密钥用户清理缓存错误:", error);
    return c.json(
      {
        code: ApiStatus.INTERNAL_ERROR,
        message: error.message || "清理缓存失败",
        success: false,
      },
      ApiStatus.INTERNAL_ERROR
    );
  }
});

export default adminRoutes;
