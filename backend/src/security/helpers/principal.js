import { HTTPException } from "hono/http-exception";
import { ApiStatus } from "../../constants/index.js";

export const resolvePrincipal = (c, options = {}) => {
  const { allowedTypes = ["admin", "apikey"], allowGuest = false, message = "需要认证访问" } = options;
  const principal = c.get("principal");

  if ((!principal || principal.type === "guest") && !allowGuest) {
    throw new HTTPException(ApiStatus.UNAUTHORIZED, { message });
  }

  if (!principal) {
    return null;
  }

  const isAdmin = Boolean(principal.isAdmin);
  const type = isAdmin ? "admin" : principal.type;

  if (!allowGuest && allowedTypes && !allowedTypes.includes(type)) {
    throw new HTTPException(ApiStatus.FORBIDDEN, { message: "不支持的身份类型" });
  }

  return {
    principal,
    type,
    userId: principal.id ?? null,
    authorities: principal.authorities ?? 0,
    apiKeyInfo: principal.attributes?.keyInfo ?? null,
    attributes: principal.attributes ?? {},
    isAdmin,
  };
};
