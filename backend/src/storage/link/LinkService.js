// LinkService: 统一封装分享视图与 FS 视图下的存储访问链接生成
// - 对外只暴露 StorageLink（见 LinkTypes）
// - 直链/代理能力由底层驱动与现有策略提供，这里只做归一与映射

import { StorageFactory } from "../factory/StorageFactory.js";
import { ObjectStore } from "../object/ObjectStore.js";
import { resolveStorageLinks } from "../object/ObjectLinkStrategy.js";
import { MountManager } from "../managers/MountManager.js";
import { FileSystem } from "../fs/FileSystem.js";
import { createDirectLink, createProxyLink } from "./LinkTypes.js";

// FsLinkStrategy 已经实现了“优先预签名、否则代理”的策略，这里直接复用 FileSystem.generateFileLink 的结果

export class LinkService {
  /**
   * @param {D1Database} db
   * @param {string} encryptionSecret
   * @param {import('../..//utils/repositories.js').RepositoryFactory} repositoryFactory
   */
  constructor(db, encryptionSecret, repositoryFactory) {
    this.db = db;
    this.encryptionSecret = encryptionSecret;
    this.repositoryFactory = repositoryFactory;
  }

  // ===== 分享视图（slug → storage_config + storage_path） =====

  /**
   * 根据分享文件记录生成下载用 StorageLink
   * - 优先使用存储直链（custom_host / presigned）
   * - 不提供直链时，返回 kind=proxy，具体代理由调用方处理
   * @param {Object} file
   * @param {{ type?: string, id?: string } | null} userInfo
   * @returns {Promise<import('./LinkTypes.js').StorageLink>}
   */
  async getLinkForShare(file, userInfo = null) {
    if (!file || !file.storage_config_id || !file.storage_path || !file.storage_type) {
      // 分享记录缺少存储信息时，直接视为需要走应用层代理
      return createProxyLink("");
    }

    const objectStore = new ObjectStore(this.db, this.encryptionSecret, this.repositoryFactory);
    const storageConfig = await objectStore._getStorageConfig(file.storage_config_id);
    const driver = await StorageFactory.createDriver(storageConfig.storage_type, storageConfig, this.encryptionSecret);

    const links = await resolveStorageLinks({
      driver,
      storageConfig,
      path: file.storage_path,
      request: null,
      forceDownload: true,
      userType: userInfo?.type || null,
      userId: userInfo?.id || null,
    });

    // 分享视图下，rawUrl 应表达“预览语义”的直链：
    // - 如果底层提供 preview 直链，则使用 preview；
    // - 否则视为无直链能力，由上层走 /api/s/:slug 代理或提示不支持直链。
    const preview = links?.preview || null;
    const url = preview?.url || "";
    const type = preview?.type || null;

    if (url && (type === "custom_host" || type === "presigned")) {
      return createDirectLink(url);
    }

    // 无直链能力：交由上层通过现有流式下载逻辑代理
    return createProxyLink("");
  }

  // ===== FS 视图（挂载路径） =====

  /**
   * 为 FS 路径生成 StorageLink
   * - 复用 FileSystem.generateFileLink（FsLinkStrategy）
   * - 将 custom_host/presigned 视为 direct，其余视为 proxy
   * @param {string} path
   * @param {any} userIdOrInfo
   * @param {string} userType
   * @param {Object} [options]
   * @returns {Promise<import('./LinkTypes.js').StorageLink>}
   */
  async getLinkForFs(path, userIdOrInfo, userType, options = {}) {
    const mountManager = new MountManager(this.db, this.encryptionSecret, this.repositoryFactory);
    const fileSystem = new FileSystem(mountManager);

    const linkResult = await fileSystem.generateFileLink(path, userIdOrInfo, userType, {
      ...options,
      userType,
      userId: userType === "ADMIN" ? userIdOrInfo : userIdOrInfo?.id,
    });

    const url = linkResult?.url || "";
    const type = linkResult?.type || null;

    if (url && (type === "custom_host" || type === "presigned")) {
      return createDirectLink(url);
    }

    return createProxyLink(url || "");
  }
}

