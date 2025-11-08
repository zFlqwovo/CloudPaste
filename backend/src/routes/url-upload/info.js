import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../../constants/index.js";
import { FileShareService } from "../../services/fileShareService.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";

export const registerUrlInfoRoutes = (router) => {
  router.post("/api/url/info", async (c) => {
    const db = c.env.DB;

    try {
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
    } catch (error) {
      console.error("URL验证错误:", error);

      let statusCode = ApiStatus.INTERNAL_ERROR;
      if (error.message.includes("无效的URL") || error.message.includes("仅支持HTTP")) {
        statusCode = ApiStatus.BAD_REQUEST;
      } else if (error.message.includes("无法访问")) {
        statusCode = ApiStatus.BAD_REQUEST;
      }

      throw new HTTPException(statusCode, { message: error.message });
    }
  });

  router.get("/api/url/proxy", async (c) => {
    try {
      const db = c.env.DB;
      const url = c.req.query("url");

      if (!url) {
        throw new HTTPException(ApiStatus.BAD_REQUEST, { message: "缺少URL参数" });
      }

      const encryptionSecret = getEncryptionSecret(c);
      const shareService = new FileShareService(db, encryptionSecret);
      const response = await shareService.proxyUrlContent(url);
      return response;
    } catch (error) {
      console.error("代理URL内容错误:", error);

      let statusCode = ApiStatus.INTERNAL_ERROR;
      if (error.message.includes("无效的URL") || error.message.includes("仅支持HTTP")) {
        statusCode = ApiStatus.BAD_REQUEST;
      } else if (error.message.includes("源服务器返回错误状态码")) {
        statusCode = ApiStatus.BAD_REQUEST;
      }

      throw new HTTPException(statusCode, { message: error.message });
    }
  });
};
