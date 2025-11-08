import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../../constants/index.js";
import { getPasteBySlug, verifyPastePassword, incrementAndCheckPasteViews, isPasteAccessible } from "../../services/pasteService.js";

export const registerPastesPublicRoutes = (router) => {
  router.get("/api/paste/:slug", async (c) => {
    const db = c.env.DB;
    const slug = c.req.param("slug");

    try {
      const paste = await getPasteBySlug(db, slug);

      if (paste.has_password) {
        return c.json({
          slug: paste.slug,
          hasPassword: true,
          remark: paste.remark,
          expires_at: paste.expires_at,
          max_views: paste.max_views,
          views: paste.views,
          created_at: paste.created_at,
          created_by: paste.created_by,
          requiresPassword: true,
        });
      }

      if (!isPasteAccessible(paste)) {
        throw new HTTPException(ApiStatus.GONE, { message: "文本分享已过期或超过最大查看次数" });
      }

      const result = await incrementAndCheckPasteViews(db, paste.id, paste.max_views);

      if (result.isLastNormalAccess) {
        return c.json({
          slug: paste.slug,
          content: paste.content,
          remark: paste.remark,
          expires_at: paste.expires_at,
          max_views: paste.max_views,
          views: result.paste.views,
          created_at: paste.created_at,
          created_by: paste.created_by,
          hasPassword: false,
          isLastView: true,
        });
      }

      if (result.isDeleted) {
        throw new HTTPException(ApiStatus.GONE, { message: "文本分享已达到最大查看次数" });
      }

      return c.json({
        slug: paste.slug,
        content: paste.content,
        remark: paste.remark,
        expires_at: paste.expires_at,
        max_views: paste.max_views,
        views: result.paste.views,
        created_at: paste.created_at,
        created_by: paste.created_by,
        hasPassword: false,
        isLastView: result.isLastView,
      });
    } catch (error) {
      console.error("获取文本分享失败:", error);
      throw error;
    }
  });

  router.post("/api/paste/:slug", async (c) => {
    const db = c.env.DB;
    const slug = c.req.param("slug");
    const { password } = await c.req.json();

    if (!password) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "请提供密码" });
    }

    try {
      const paste = await verifyPastePassword(db, slug, password, false);
      const result = await incrementAndCheckPasteViews(db, paste.id, paste.max_views);

      if (result.isLastNormalAccess) {
        return c.json({
          slug: paste.slug,
          content: paste.content,
          remark: paste.remark,
          hasPassword: true,
          plain_password: paste.plain_password,
          expires_at: paste.expires_at,
          max_views: paste.max_views,
          views: result.paste.views,
          created_at: paste.created_at,
          updated_at: paste.updated_at,
          created_by: paste.created_by,
          isLastView: true,
        });
      }

      if (result.isDeleted) {
        throw new HTTPException(ApiStatus.GONE, { message: "文本分享已达到最大查看次数" });
      }

      return c.json({
        slug: paste.slug,
        content: paste.content,
        remark: paste.remark,
        hasPassword: true,
        plain_password: paste.plain_password,
        expires_at: paste.expires_at,
        max_views: paste.max_views,
        views: result.paste.views,
        created_at: paste.created_at,
        updated_at: paste.updated_at,
        created_by: paste.created_by,
        isLastView: result.isLastView,
      });
    } catch (error) {
      console.error("验证文本密码失败:", error);
      throw error;
    }
  });

  router.get("/api/raw/:slug", async (c) => {
    const db = c.env.DB;
    const slug = c.req.param("slug");
    const password = c.req.query("password");

    try {
      const paste = await getPasteBySlug(db, slug);

      if (paste.has_password) {
        if (!password) {
          throw new HTTPException(ApiStatus.UNAUTHORIZED, { message: "需要密码才能访问此内容" });
        }

        try {
          await verifyPastePassword(db, slug, password, false);
        } catch (error) {
          throw new HTTPException(ApiStatus.UNAUTHORIZED, { message: "密码错误" });
        }

        const result = await incrementAndCheckPasteViews(db, paste.id, paste.max_views);

        if (result.isDeleted && !result.isLastNormalAccess) {
          throw new HTTPException(ApiStatus.GONE, { message: "文本分享已达到最大查看次数" });
        }
      } else if (!isPasteAccessible(paste)) {
        throw new HTTPException(ApiStatus.GONE, { message: "文本分享已过期或超过最大查看次数" });
      }

      c.header("Content-Type", "text/plain; charset=utf-8");
      c.header("Content-Disposition", `inline; filename="${slug}.txt"`);
      return c.text(paste.content);
    } catch (error) {
      console.error("获取原始文本内容失败:", error);

      if (error instanceof HTTPException) {
        c.header("Content-Type", "text/plain; charset=utf-8");
        return c.text(error.message, error.status);
      }

      c.header("Content-Type", "text/plain; charset=utf-8");
      return c.text("获取内容失败", ApiStatus.INTERNAL_ERROR);
    }
  });
};
