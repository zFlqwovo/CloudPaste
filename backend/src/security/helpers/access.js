import { RepositoryFactory } from "../../repositories/index.js";
import { getAccessibleMountsByBasicPath } from "../../services/apiKeyService.js";

// 这里封装了“principal → 可访问挂载列表 / 路径范围”相关逻辑，
// 供 FS、MountManager、WebDAV 等模块复用，避免各处重复 basicPath 判断。

const isAdminType = (userType) => userType === "admin";

export const getAccessibleMountsForUser = async (db, userIdOrInfo, userType) => {
  if (isAdminType(userType)) {
    const repositoryFactory = new RepositoryFactory(db);
    const mountRepository = repositoryFactory.getMountRepository();
    return await mountRepository.findAll(false);
  }

  if (userType === "apiKey" && userIdOrInfo?.basicPath) {
    return await getAccessibleMountsByBasicPath(db, userIdOrInfo.basicPath);
  }

  return [];
};

export const getAccessibleMountsForPrincipal = async (db, principal) => {
  if (!principal) {
    return [];
  }

  const userType = principal.isAdmin ? "admin" : principal.type;
  const userIdOrInfo = userType === "admin" ? principal.id : { basicPath: principal.attributes?.basicPath ?? "/" };
  return getAccessibleMountsForUser(db, userIdOrInfo, userType);
};

export const canNavigatePath = (basicPath, requestPath) => {
  if (!basicPath || !requestPath) {
    return false;
  }

  const normalize = (value, isBase = false) => {
    if (!value) {
      return "/";
    }
    if (value === "/") {
      return "/";
    }
    const trimmed = value.replace(/\/+/g, "/");
    return isBase ? trimmed.replace(/\/$/, "") || "/" : trimmed || "/";
  };

  const base = normalize(basicPath, true);
  const target = normalize(requestPath);

  if (base === "/") {
    return true;
  }

  if (target === base || target.startsWith(`${base}/`)) {
    return true;
  }

  const baseParts = base.split("/").filter(Boolean);
  const targetParts = target.split("/").filter(Boolean);

  if (targetParts.length >= baseParts.length) {
    return false;
  }

  const targetPrefix = `/${targetParts.join("/")}`;
  const basePrefix = `/${baseParts.slice(0, targetParts.length).join("/")}`;
  return targetPrefix === basePrefix;
};
