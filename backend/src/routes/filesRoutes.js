import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../constants/index.js";
import { authGateway } from "../middlewares/authGatewayMiddleware.js";
import { registerFilesPublicRoutes } from "./files/public.js";
import { registerFilesProtectedRoutes } from "./files/protected.js";

const app = new Hono();

const createUnifiedAuthMiddleware = () => {
  return async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      throw new HTTPException(ApiStatus.UNAUTHORIZED, { message: "需要认证" });
    }

    let isAuthenticated = false;

    try {
      await authGateway.requireAdmin()(c, async () => {
        c.set("userType", "admin");
        c.set("userId", authGateway.utils.getUserId(c));
        isAuthenticated = true;
      });

      if (isAuthenticated) {
        return await next();
      }
    } catch (adminError) {}

    try {
      await authGateway.requireFile()(c, async () => {
        c.set("userType", "apikey");
        c.set("userId", authGateway.utils.getUserId(c));
        c.set("apiKeyInfo", authGateway.utils.getApiKeyInfo(c));
        isAuthenticated = true;
      });

      if (isAuthenticated) {
        return await next();
      }
    } catch (apiKeyError) {}

    throw new HTTPException(ApiStatus.UNAUTHORIZED, { message: "需要管理员权限或有效的API密钥" });
  };
};

const unifiedAuth = createUnifiedAuthMiddleware();

registerFilesPublicRoutes(app);
registerFilesProtectedRoutes(app, { unifiedAuth });

export default app;
