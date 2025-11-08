/**
 * 统一挂载点路由
 */
import { Hono } from "hono";
import { authGateway } from "../middlewares/authGatewayMiddleware.js";
import { createMount, updateMount, deleteMount, getAllMounts } from "../services/storageMountService.js";
import { ApiStatus } from "../constants/index.js";
import { Permission } from "../constants/permissions.js";

const mountRoutes = new Hono();

/**
 * 获取挂载点列表
 * 统一入口，根据用户权限返回不同数据：
 * - 管理员：返回所有挂载点（包括禁用的）
 * - API密钥用户：返回有权限的活跃挂载点
 */
mountRoutes.get("/api/mount/list", authGateway({
  requireAuth: true,
  customCheck: (authResult) => {
    // 管理员或有挂载查看权限的API密钥用户
    return authResult.isAdmin() || authResult.hasPermission(Permission.MOUNT_VIEW);
  }
}), async (c) => {
  const db = c.env.DB;
  const authResult = c.get("authResult");

  if (authResult.isAdmin()) {
    const mounts = await getAllMounts(db, true);

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "获取挂载点列表成功",
      data: mounts,
      success: true,
    });
  }

  const apiKeyInfo = authGateway.utils.getApiKeyInfo(c);
  const mounts = await authGateway.utils.getAccessibleMounts(db, apiKeyInfo, "apiKey");

  return c.json({
    code: ApiStatus.SUCCESS,
    message: "获取挂载点列表成功",
    data: mounts,
    success: true,
  });
});

/**
 * 创建挂载点（仅管理员）
 */
mountRoutes.post("/api/mount/create", authGateway.requireAdmin(), async (c) => {
  const db = c.env.DB;
  const adminId = authGateway.utils.getUserId(c);

  const body = await c.req.json();
  const mount = await createMount(db, body, adminId);

  return c.json({
    code: ApiStatus.CREATED,
    message: "挂载点创建成功",
    data: mount,
    success: true,
  });
});

/**
 * 更新挂载点（仅管理员）
 */
mountRoutes.put("/api/mount/:id", authGateway.requireAdmin(), async (c) => {
  const db = c.env.DB;
  const adminId = authGateway.utils.getUserId(c);
  const { id } = c.req.param();

  const body = await c.req.json();
  await updateMount(db, id, body, adminId, true);

  return c.json({
    code: ApiStatus.SUCCESS,
    message: "挂载点已更新",
    success: true,
  });
});

/**
 * 删除挂载点（仅管理员）
 */
mountRoutes.delete("/api/mount/:id", authGateway.requireAdmin(), async (c) => {
  const db = c.env.DB;
  const adminId = authGateway.utils.getUserId(c);
  const { id } = c.req.param();

  await deleteMount(db, id, adminId, true);

  return c.json({
    code: ApiStatus.SUCCESS,
    message: "挂载点删除成功",
    success: true,
  });
});

export default mountRoutes;
