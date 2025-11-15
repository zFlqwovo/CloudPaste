import { resolveDriverByConfigId, resolveDriverByType } from "@/modules/storage-core/drivers/registry.js";
import { DRIVER_TYPES, STORAGE_STRATEGIES, STORAGE_SOURCES, DEFAULT_DRIVER_CAPABILITIES } from "@/modules/storage-core/drivers/types.js";
import { useUploaderClient } from "@/modules/storage-core/useUploaderClient.js";

/**
 * storage-core 模块入口
 *
 * 目标：
 * - 作为存储驱动与上传管线的领域入口
 * - 对外暴露 driver registry 与 uploader client
 *
 * 注意：
 * - 实现已经迁移到 modules/storage-core/drivers 与 modules/storage-core/uppy 内部，
 *   旧路径 drivers/storage 与 composables/uppy 已移除，不再对外使用。
 * - UI 层不应直接依赖 storage-core，只通过 modules/upload、modules/fileshare、modules/fs 等领域模块访问上传与存储能力。
 */

export {
  // driver registry
  resolveDriverByConfigId,
  resolveDriverByType,

  // driver 常量
  DRIVER_TYPES,
  STORAGE_STRATEGIES,
  STORAGE_SOURCES,
  DEFAULT_DRIVER_CAPABILITIES,

  // uploader client
  useUploaderClient,
};
