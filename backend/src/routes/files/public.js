import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../../constants/index.js";
import { generateFileDownloadUrl, getFileBySlug, getPublicFileInfo, incrementAndCheckFileViews, isFileAccessible } from "../../services/fileService.js";
import { verifyPassword } from "../../utils/crypto.js";
import { useRepositories } from "../../utils/repositories.js";

export const registerFilesPublicRoutes = (router) => {
  router.get("/api/public/files/:slug", async (c) => {
    const db = c.env.DB;
    const { slug } = c.req.param();
    const encryptionSecret = c.env.ENCRYPTION_SECRET || "default-encryption-key";

    try {
      const file = await getFileBySlug(db, slug);
      const accessCheck = await isFileAccessible(db, file, encryptionSecret);
      if (!accessCheck.accessible) {
        if (accessCheck.reason === "expired") {
          throw new HTTPException(ApiStatus.GONE, { message: "文件已过期" });
        }
        throw new HTTPException(ApiStatus.NOT_FOUND, { message: "文件不存在" });
      }

      const requiresPassword = !!file.password;

      if (!requiresPassword) {
        const result = await incrementAndCheckFileViews(db, file, encryptionSecret);

        if (result.isExpired) {
          try {
            const repositoryFactory = useRepositories(c);
            const fileRepository = repositoryFactory.getFileRepository();
            const fileStillExists = await fileRepository.findById(file.id);
            if (fileStillExists) {
              console.log(`文件(${file.id})达到最大访问次数但未被删除，再次尝试删除...`);
              const { checkAndDeleteExpiredFile } = await import("../../services/fileViewService.js");
              await checkAndDeleteExpiredFile(db, result.file, encryptionSecret);
            }
          } catch (error) {
            console.error(`尝试再次删除文件(${file.id})时出错:`, error);
          }
          throw new HTTPException(ApiStatus.GONE, { message: "文件已达到最大查看次数" });
        }

        const urlsObj = await generateFileDownloadUrl(db, result.file, encryptionSecret, c.req.raw);
        const publicInfo = await getPublicFileInfo(result.file, requiresPassword, urlsObj);

        return c.json({
          code: ApiStatus.SUCCESS,
          message: "获取文件成功",
          data: publicInfo,
          success: true,
        });
      }

      const publicInfo = await getPublicFileInfo(file, true);
      return c.json({
        code: ApiStatus.SUCCESS,
        message: "获取文件成功",
        data: publicInfo,
        success: true,
      });
    } catch (error) {
      console.error("获取公开文件错误:", error);
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "获取文件失败" });
    }
  });

  router.post("/api/public/files/:slug/verify", async (c) => {
    const db = c.env.DB;
    const { slug } = c.req.param();
    const body = await c.req.json();
    const encryptionSecret = c.env.ENCRYPTION_SECRET || "default-encryption-key";

    if (!body.password) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "密码是必需的" });
    }

    try {
      const file = await getFileBySlug(db, slug);
      const accessCheck = await isFileAccessible(db, file, encryptionSecret);
      if (!accessCheck.accessible) {
        if (accessCheck.reason === "expired") {
          throw new HTTPException(ApiStatus.GONE, { message: "文件已过期" });
        }
        throw new HTTPException(ApiStatus.NOT_FOUND, { message: "文件不存在" });
      }

      if (!file.password) {
        return c.json({
          code: ApiStatus.BAD_REQUEST,
          message: "此文件不需要密码",
          data: { url: file.s3_url },
          success: true,
        });
      }

      const passwordValid = await verifyPassword(body.password, file.password);
      if (!passwordValid) {
        throw new HTTPException(ApiStatus.UNAUTHORIZED, { message: "密码不正确" });
      }

      const result = await incrementAndCheckFileViews(db, file, encryptionSecret);

      if (result.isExpired) {
        throw new HTTPException(ApiStatus.GONE, { message: "文件已达到最大查看次数" });
      }

      const urlsObj = await generateFileDownloadUrl(db, result.file, encryptionSecret, c.req.raw);
      let fileWithPassword = result.file;

      if (fileWithPassword.password) {
        const repositoryFactory = useRepositories(c);
        const fileRepository = repositoryFactory.getFileRepository();
        const passwordInfo = await fileRepository.getFilePassword(result.file.id);
        if (passwordInfo && passwordInfo.plain_password) {
          fileWithPassword = {
            ...fileWithPassword,
            plain_password: passwordInfo.plain_password,
          };
        }
      }

      const publicInfo = await getPublicFileInfo(fileWithPassword, false, urlsObj);

      return c.json({
        code: ApiStatus.SUCCESS,
        message: "密码验证成功",
        data: publicInfo,
        success: true,
      });
    } catch (error) {
      console.error("验证文件密码错误:", error);
      throw new HTTPException(ApiStatus.INTERNAL_ERROR, { message: error.message || "验证密码失败" });
    }
  });
};
