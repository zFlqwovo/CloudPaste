import { HTTPException } from "hono/http-exception";
import { authGateway } from "../../middlewares/authGatewayMiddleware.js";
import {
  getAllPastes,
  getUserPastes,
  getPasteById,
  batchDeletePastes,
  batchDeleteUserPastes,
  updatePaste,
  createPaste,
} from "../../services/pasteService.js";
import { ApiStatus, DbTables } from "../../constants/index.js";
import { useRepositories } from "../../utils/repositories.js";

export const registerPastesProtectedRoutes = (router) => {
  router.post("/api/paste", authGateway.requireText(), async (c) => {
    const db = c.env.DB;
    const body = await c.req.json();

    try {
      const userId = authGateway.utils.getUserId(c);
      const authType = authGateway.utils.getAuthType(c);
      const created_by = authType === "admin" ? userId : authType === "apikey" ? `apikey:${userId}` : null;
      const paste = await createPaste(db, body, created_by);

      return c.json({
        ...paste,
        authorizedBy: authType,
      });
    } catch (error) {
      if (error.message.includes("链接后缀已被占用")) {
        throw new HTTPException(ApiStatus.CONFLICT, { message: error.message });
      }
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "创建分享失败" });
    }
  });

  router.get("/api/pastes", authGateway.requireText(), async (c) => {
    const db = c.env.DB;
    const userType = authGateway.utils.getAuthType(c);
    const userId = authGateway.utils.getUserId(c);
    const apiKeyInfo = authGateway.utils.getApiKeyInfo(c);

    try {
      let result;

      if (userType === "admin") {
        const limit = parseInt(c.req.query("limit") || "10");
        const page = parseInt(c.req.query("page") || "1");
        const offset = parseInt(c.req.query("offset") || (page - 1) * limit);
        const search = c.req.query("search");
        const created_by = c.req.query("created_by");
        result = await getAllPastes(db, page, limit, created_by, search, offset);
      } else {
        const limit = parseInt(c.req.query("limit") || "30");
        const offset = parseInt(c.req.query("offset") || "0");
        const search = c.req.query("search");
        result = await getUserPastes(db, userId, limit, offset, search);
      }

      const response = {
        code: ApiStatus.SUCCESS,
        message: "获取成功",
        data: result.results || result,
        success: true,
      };

      if (result.pagination) {
        response.pagination = result.pagination;
      }

      if (userType === "apikey") {
        response.key_info = apiKeyInfo;
      }

      return c.json(response);
    } catch (error) {
      console.error("获取文本列表错误:", error);
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "获取文本列表失败" });
    }
  });

  router.get("/api/pastes/:id", authGateway.requireText(), async (c) => {
    const db = c.env.DB;
    const { id } = c.req.param();
    const userType = authGateway.utils.getAuthType(c);
    const userId = authGateway.utils.getUserId(c);

    try {
      let result;

      if (userType === "admin") {
        result = await getPasteById(db, id);
      } else {
        const repositoryFactory = useRepositories(c);
        const pasteRepository = repositoryFactory.getPasteRepository();

        const paste = await pasteRepository.findOne(DbTables.PASTES, {
          id,
          created_by: `apikey:${userId}`,
        });

        if (!paste) {
          throw new HTTPException(ApiStatus.NOT_FOUND, { message: "文本不存在或无权访问" });
        }

        paste.has_password = !!paste.password;

        let plainPassword = null;
        if (paste.has_password) {
          plainPassword = await pasteRepository.findPasswordByPasteId(paste.id);
        }

        result = {
          ...paste,
          plain_password: plainPassword,
        };
      }

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "获取成功",
        data: result,
        success: true,
      });
    } catch (error) {
      console.error("获取文本详情错误:", error);
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "获取文本详情失败" });
    }
  });

  router.delete("/api/pastes/batch-delete", authGateway.requireText(), async (c) => {
    const db = c.env.DB;
    const userType = authGateway.utils.getAuthType(c);
    const userId = authGateway.utils.getUserId(c);

    try {
      const { ids } = await c.req.json();

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "请提供有效的文本ID数组" });
      }
      let deletedCount;

      if (userType === "admin") {
        deletedCount = await batchDeletePastes(db, ids, false);
      } else {
        deletedCount = await batchDeleteUserPastes(db, ids, userId);
      }

      return c.json({
        code: ApiStatus.SUCCESS,
        message: `已删除 ${deletedCount} 个分享`,
        success: true,
      });
    } catch (error) {
      console.error("批量删除文本错误:", error);
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "批量删除文本失败" });
    }
  });

  router.put("/api/pastes/:slug", authGateway.requireText(), async (c) => {
    const db = c.env.DB;
    const { slug } = c.req.param();
    const userType = authGateway.utils.getAuthType(c);
    const userId = authGateway.utils.getUserId(c);
    const body = await c.req.json();

    try {
      let result;

      if (userType === "admin") {
        result = await updatePaste(db, slug, body);
      } else {
        result = await updatePaste(db, slug, body, `apikey:${userId}`);
      }

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "文本更新成功",
        data: {
          id: result.id,
          slug: result.slug,
        },
        success: true,
      });
    } catch (error) {
      console.error("更新文本错误:", error);
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "更新文本失败" });
    }
  });

  router.post("/api/pastes/clear-expired", authGateway.requireAdmin(), async (c) => {
    const db = c.env.DB;

    try {
      const deletedCount = await batchDeletePastes(db, null, true);
      return c.json({
        code: ApiStatus.SUCCESS,
        message: `已清理 ${deletedCount} 个过期分享`,
        success: true,
      });
    } catch (error) {
      console.error("清理过期文本错误:", error);
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "清理过期文本失败" });
    }
  });
};
