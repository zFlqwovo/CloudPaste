/**
 * S3路径处理工具
 * 提供S3存储驱动专用的路径规范化功能
 * 从webdavUtils.js迁移而来
 */

/**
 * 规范化S3子路径
 * @param {string} subPath - 子路径
 * @param {boolean} asDirectory - 是否作为目录处理
 * @returns {string} 规范化的S3子路径
 */
export function normalizeS3SubPath(subPath, asDirectory = false) {
  // 规范化S3子路径，移除开头的斜杠
  let s3SubPath = subPath.startsWith("/") ? subPath.substring(1) : subPath;

  // 如果路径为空，设置为根路径
  if (!s3SubPath) {
    s3SubPath = "";
  }

  // 规范化S3子路径，移除多余的斜杠
  s3SubPath = s3SubPath.replace(/\/+/g, "/");

  // 如果作为目录处理，确保路径以斜杠结尾
  if (asDirectory && s3SubPath !== "" && !s3SubPath.endsWith("/")) {
    s3SubPath += "/";
  }

  // 注意：root_prefix在调用时单独处理，避免重复添加
  // 在getS3DirectoryListing中会将s3SubPath与root_prefix组合

  return s3SubPath;
}

/**
 * 检查S3子路径是否为挂载点根目录（空字符串）
 * @param {string} s3SubPath - S3子路径
 * @returns {boolean} 是否为挂载点根目录
 */
export function isMountRootPath(s3SubPath) {
  return !s3SubPath || s3SubPath.trim() === "";
}
