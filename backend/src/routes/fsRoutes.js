import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { authGateway } from "../middlewares/authGatewayMiddleware.js";
import { ApiStatus } from "../constants/index.js";
import { getS3ConfigByIdForAdmin, getPublicS3ConfigById } from "../services/s3ConfigService.js";
import { registerBrowseRoutes } from "./fs/browse.js";
import { registerWriteRoutes } from "./fs/write.js";
import { registerMultipartRoutes } from "./fs/multipart.js";
import { registerOpsRoutes } from "./fs/ops.js";
import { registerSearchShareRoutes } from "./fs/search_share.js";

const fsRoutes = new Hono();

const unifiedFsAuthMiddleware = async (c, next) => {
  const authResult = authGateway.utils.getAuthResult(c);

  if (!authResult || !authResult.isAuthenticated) {
    throw new HTTPException(ApiStatus.UNAUTHORIZED, { message: "需要认证访问" });
  }

  if (authResult.isAdmin()) {
    c.set("userInfo", {
      type: "admin",
      id: authResult.getUserId(),
      hasFullAccess: true,
    });
  } else {
    const apiKeyInfo = authResult.keyInfo;
    c.set("userInfo", {
      type: "apiKey",
      info: apiKeyInfo,
      hasFullAccess: false,
    });
  }

  await next();
};

const FS_BASE_PATH = "/api/fs";

const mountViewMiddleware = authGateway.requireMount();
fsRoutes.use(`${FS_BASE_PATH}/*`, mountViewMiddleware, unifiedFsAuthMiddleware);

const applyScopedMiddleware = (paths, middleware) => {
  paths.forEach((path) => fsRoutes.use(path, middleware));
};

const uploadPermissionPaths = [
  `${FS_BASE_PATH}/mkdir`,
  `${FS_BASE_PATH}/upload`,
  `${FS_BASE_PATH}/update`,
  `${FS_BASE_PATH}/presign`,
  `${FS_BASE_PATH}/presign/commit`,
  `${FS_BASE_PATH}/multipart/*`,
];

applyScopedMiddleware(uploadPermissionPaths, authGateway.requireMountUpload());
applyScopedMiddleware([`${FS_BASE_PATH}/rename`], authGateway.requireMountRename());
applyScopedMiddleware([`${FS_BASE_PATH}/batch-remove`], authGateway.requireMountDelete());
applyScopedMiddleware([`${FS_BASE_PATH}/batch-copy`, `${FS_BASE_PATH}/batch-copy-commit`], authGateway.requireMountCopy());

// 路径权限检查统一由 authGateway.utils 提供；此处不再重复封装

const getServiceParams = (userInfo) => {
  if (userInfo.type === "admin") {
    return { userIdOrInfo: userInfo.id, userType: "admin" };
  }
  return { userIdOrInfo: userInfo.info, userType: "apiKey" };
};

const getS3ConfigByUserType = async (db, configId, userIdOrInfo, userType, encryptionSecret) => {
  if (userType === "admin") {
    return await getS3ConfigByIdForAdmin(db, configId, userIdOrInfo);
  }
  return await getPublicS3ConfigById(db, configId);
};

const sharedContext = {
  authGateway,
  getServiceParams,
  getS3ConfigByUserType,
};

registerBrowseRoutes(fsRoutes, sharedContext);
registerWriteRoutes(fsRoutes, sharedContext);
registerMultipartRoutes(fsRoutes, sharedContext);
registerOpsRoutes(fsRoutes, sharedContext);
registerSearchShareRoutes(fsRoutes, sharedContext);

export default fsRoutes;
