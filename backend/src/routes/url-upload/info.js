import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../../constants/index.js";
import { FileShareService } from "../../services/fileShareService.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";

export const registerUrlInfoRoutes = (router) => {
  router.post("/api/url/info", async (c) => {
    const db = c.env.DB;

    const body = await c.req.json();

    if (!body.url) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少URL参数" });
    }

    const encryptionSecret = getEncryptionSecret(c);
    const shareService = new FileShareService(db, encryptionSecret);
    const metadata = await shareService.validateUrlMetadata(body.url);

    return c.json({
      code: ApiStatus.SUCCESS,
      message: "URL验证成功",
      data: metadata,
      success: true,
    });
  });

  router.get("/api/url/proxy", async (c) => {
    const db = c.env.DB;
    const url = c.req.query("url");

    if (!url) {
      throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少URL参数" });
    }

    const encryptionSecret = getEncryptionSecret(c);
    const shareService = new FileShareService(db, encryptionSecret);
    return await shareService.proxyUrlContent(url);
  });
};
