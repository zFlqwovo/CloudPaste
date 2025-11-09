import cacheBus, { CACHE_EVENTS } from "./cacheBus.js";
import { directoryCacheManager } from "./DirectoryCache.js";
import { clearS3UrlCache } from "./S3UrlCache.js";
import { clearSearchCache } from "./SearchCache.js";
import { previewSettingsCache } from "./PreviewSettingsCache.js";
import { bumpMountsVersion } from "./cacheState.js";

const logEvent = (message, payload) => {
  try {
    const safePayload = JSON.stringify(payload ?? {});
    console.log(`[cacheBus] ${message} -> ${safePayload}`);
  } catch (error) {
    console.log(`[cacheBus] ${message}`);
  }
};

const invalidateDirectoryCache = ({ mountId, paths = [] }) => {
  if (!mountId) {
    return;
  }

  if (!paths.length) {
    directoryCacheManager.invalidateMount(mountId);
    return;
  }

  for (const path of paths) {
    if (typeof path === "string" && path.length > 0) {
      directoryCacheManager.invalidatePathAndAncestors(mountId, path);
    }
  }
};

const resolveMountsByS3Config = async (db, s3ConfigId) => {
  if (!db || !s3ConfigId) {
    return [];
  }

  try {
    const result = await db
      .prepare(
        `SELECT id FROM storage_mounts
         WHERE storage_type = 'S3' AND storage_config_id = ?`
      )
      .bind(s3ConfigId)
      .all();
    return result?.results?.map((row) => row.id).filter(Boolean) ?? [];
  } catch (error) {
    console.warn("resolveMountsByS3Config failed", error);
    return [];
  }
};

cacheBus.on(CACHE_EVENTS.INVALIDATE, async (payload = {}) => {
  try {
    const {
      target = "fs",
      mountId = null,
      paths = [],
      s3ConfigId = null,
      userType = null,
      userId = null,
      reason = "unknown",
      invalidateAll = false,
      bumpMountsVersion: shouldBumpVersion = false,
      db = null,
    } = payload;

    if (shouldBumpVersion) {
      bumpMountsVersion();
    }

    if (invalidateAll) {
      directoryCacheManager.invalidateAll();
      await clearS3UrlCache();
      clearSearchCache();
      logEvent(`缓存全量失效(原因:${reason})`, payload);
      return;
    }

    if (target === "fs") {
      invalidateDirectoryCache({ mountId, paths });
      if (mountId) {
        clearSearchCache({ mountId });
      }
    }

    if (s3ConfigId) {
      const relatedMounts = await resolveMountsByS3Config(db, s3ConfigId);
      for (const relatedMountId of relatedMounts) {
        invalidateDirectoryCache({ mountId: relatedMountId });
        clearSearchCache({ mountId: relatedMountId });
      }
      await clearS3UrlCache({ s3ConfigId });
    }

    if (target === "preview") {
      try {
        await previewSettingsCache.refresh(payload.db ?? null);
      } catch (error) {
        console.warn("刷新预览设置缓存失败", error);
      }
    }

    logEvent(`缓存事件已处理(原因:${reason})`, payload);
  } catch (error) {
    console.error("处理缓存事件失败", error);
  }
});
