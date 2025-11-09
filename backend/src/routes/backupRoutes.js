import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { BackupService } from "../services/BackupService.js";
import { ApiStatus } from "../constants/index.js";
import { usePolicy } from "../security/policies/policies.js";
import { resolvePrincipal } from "../security/helpers/principal.js";

const backupRoutes = new Hono();
const requireAdmin = usePolicy("admin.all");

/**
 * 创建备份
 * POST /api/admin/backup/create
 */
backupRoutes.post("/api/admin/backup/create", requireAdmin, async (c) => {
  try {
    const body = await c.req.json();
    const { backup_type = "full", selected_modules = [] } = body;

    // 验证输入参数
    if (backup_type === "modules" && (!selected_modules || selected_modules.length === 0)) {
      throw new HTTPException(400, { message: "模块备份必须选择至少一个模块" });
    }

    const backupService = new BackupService(c.env.DB);

    // 创建备份
    const backupData = await backupService.createBackup({
      backup_type,
      selected_modules,
    });

    // 生成文件名
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split("T")[0] + "-" + new Date().toISOString().replace(/[:.]/g, "-").split("T")[1].split(".")[0];
    const filename = `cloudpaste-${backup_type}-${timestamp}.json`;

    // 返回备份数据供下载
    const response = new Response(JSON.stringify(backupData, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-cache",
      },
    });

    return response;
  } catch (error) {
    console.error("创建备份失败:", error);
    throw new HTTPException(500, { message: `创建备份失败: ${error.message}` });
  }
});

/**
 * 还原备份
 * POST /api/admin/backup/restore
 */
backupRoutes.post("/api/admin/backup/restore", requireAdmin, async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("backup_file");
    const mode = formData.get("mode") || "overwrite";

    if (!file) {
      throw new HTTPException(400, { message: "请选择备份文件" });
    }

    // 验证文件类型
    if (!file.name.endsWith(".json")) {
      throw new HTTPException(400, { message: "只支持JSON格式的备份文件" });
    }

    // 读取文件内容
    const fileContent = await file.text();
    let backupData;

    try {
      backupData = JSON.parse(fileContent);
    } catch (error) {
      throw new HTTPException(400, { message: "备份文件格式错误，请确保是有效的JSON文件" });
    }

    const backupService = new BackupService(c.env.DB);

    // 获取当前管理员ID（用于合并模式下的admin_id映射）
    const { userId: currentAdminId } = resolvePrincipal(c, { allowedTypes: ["admin"] });

    // 获取额外的还原选项
    const skipIntegrityCheck = formData.get("skipIntegrityCheck") === "true";
    const preserveTimestamps = formData.get("preserveTimestamps") === "true";

    // 执行还原
    const result = await backupService.restoreBackup(backupData, {
      mode,
      currentAdminId,
      skipIntegrityCheck,
      preserveTimestamps,
    });

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "数据还原成功",
      success: true,
      data: {
        restored_tables: result.restored_tables,
        total_records: result.total_records,
        results: result.results, // 别统计信息
        mode: mode,
        backup_info: {
          backup_type: backupData.metadata.backup_type,
          timestamp: backupData.metadata.timestamp,
        },
      },
    });
  } catch (error) {
    console.error("还原备份失败:", error);
    throw new HTTPException(500, { message: `还原备份失败: ${error.message}` });
  }
});

/**
 * 获取备份模块信息
 * GET /api/admin/backup/modules
 */
backupRoutes.get("/api/admin/backup/modules", requireAdmin, async (c) => {
  try {
    const backupService = new BackupService(c.env.DB);

    // 获取模块信息
    const modules = await backupService.getModulesInfo();

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "获取模块信息成功",
      success: true,
      data: { modules },
    });
  } catch (error) {
    console.error("获取模块信息失败:", error);
    throw new HTTPException(500, { message: `获取模块信息失败: ${error.message}` });
  }
});

export { backupRoutes };
