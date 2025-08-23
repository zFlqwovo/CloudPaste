/**
 * WebDAV通用协议检测器
 */

import { WEBDAV_BASE_PATH } from "../config/WebDAVConfig.js";

/**
 * WebDAV协议特征
 */
const WEBDAV_FEATURES = {
  // WebDAV HTTP方法 (权重: 3 - 最高优先级)
  METHODS: ["PROPFIND", "PROPPATCH", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK", "PUT", "DELETE", "GET", "HEAD", "OPTIONS"],

  // WebDAV专用HTTP头部 (权重: 2)
  HEADERS: ["dav", "depth", "destination", "if", "lock-token", "overwrite"],

  // WebDAV路径模式 (权重: 1)
  PATH_PATTERNS: [WEBDAV_BASE_PATH],

  // WebDAV Content-Type (权重: 1)
  CONTENT_TYPES: ["text/xml", "application/xml"],

  // 检测阈值：达到此分数即认为是WebDAV请求
  DETECTION_THRESHOLD: 1,
};

/**
 * WebDAV通用协议检测器类
 * 实现基于RFC 4918标准的协议特征检测
 */
export class WebDAVDetector {
  constructor() {
    this.features = WEBDAV_FEATURES;
  }

  /**
   * 检测是否为WebDAV请求
   * 使用多特征评分系统，确保检测准确性
   *
   * @param {Object} request - 标准化的请求对象
   * @param {string} request.method - HTTP方法
   * @param {Object} request.headers - HTTP头部对象
   * @param {string} request.url - 请求URL
   * @param {string} request.contentType - Content-Type头
   * @returns {boolean} 是否为WebDAV请求
   */
  detectWebDAVRequest(request) {
    try {
      let score = 0;
      const detectionDetails = [];

      // 特征1: WebDAV方法检测 (权重: 3)
      if (this.hasWebDAVMethod(request)) {
        score += 3;
        detectionDetails.push(`WebDAV方法: ${request.method}`);
      }

      // 特征2: WebDAV头部检测 (权重: 2)
      const webdavHeaders = this.getWebDAVHeaders(request);
      if (webdavHeaders.length > 0) {
        score += 2;
        detectionDetails.push(`WebDAV头部: ${webdavHeaders.join(", ")}`);
      }

      // 特征3: 路径模式检测 (权重: 1)
      if (this.hasWebDAVPath(request)) {
        score += 1;
        detectionDetails.push(`WebDAV路径: ${request.url}`);
      }

      // 特征4: Content-Type检测 (权重: 1)
      if (this.hasWebDAVContentType(request)) {
        score += 1;
        detectionDetails.push(`WebDAV Content-Type: ${request.contentType}`);
      }

      const isWebDAV = score >= this.features.DETECTION_THRESHOLD;

      // 记录检测结果（包括非WebDAV请求的调试信息）
      if (isWebDAV) {
        console.log(`WebDAV检测: 确认WebDAV请求 (评分: ${score}/${this.features.DETECTION_THRESHOLD})`, {
          method: request.method,
          url: request.url,
          features: detectionDetails,
        });
      } else {
        console.log(`WebDAV检测: 非WebDAV请求 (评分: ${score}/${this.features.DETECTION_THRESHOLD})`, {
          method: request.method,
          url: request.url,
          features: detectionDetails,
        });
      }

      return isWebDAV;
    } catch (error) {
      console.error("WebDAV检测错误:", error);
      return false; // 检测失败时默认为非WebDAV请求
    }
  }

  /**
   * 检测是否包含WebDAV专用HTTP方法
   * @param {Object} request - 请求对象
   * @returns {boolean} 是否包含WebDAV方法
   */
  hasWebDAVMethod(request) {
    if (!request.method) return false;
    return this.features.METHODS.includes(request.method.toUpperCase());
  }

  /**
   * 检测并返回WebDAV专用头部
   * @param {Object} request - 请求对象
   * @returns {Array} 检测到的WebDAV头部列表
   */
  getWebDAVHeaders(request) {
    if (!request.headers || typeof request.headers !== "object") {
      return [];
    }

    const headerNames = Object.keys(request.headers).map((h) => h.toLowerCase());
    return this.features.HEADERS.filter((header) => headerNames.includes(header.toLowerCase()));
  }

  /**
   * 检测是否包含WebDAV头部
   * @param {Object} request - 请求对象
   * @returns {boolean} 是否包含WebDAV头部
   */
  hasWebDAVHeaders(request) {
    return this.getWebDAVHeaders(request).length > 0;
  }

  /**
   * 检测是否为WebDAV路径模式
   * @param {Object} request - 请求对象
   * @returns {boolean} 是否为WebDAV路径
   */
  hasWebDAVPath(request) {
    if (!request.url) return false;

    // 精确匹配WebDAV路径，避免误判（如"/davfolder"不应被识别为WebDAV路径）
    return this.features.PATH_PATTERNS.some((pattern) => {
      const url = request.url;
      return url === pattern || url.startsWith(pattern + "/");
    });
  }

  /**
   * 检测是否为WebDAV Content-Type
   * @param {Object} request - 请求对象
   * @returns {boolean} 是否为WebDAV Content-Type
   */
  hasWebDAVContentType(request) {
    if (!request.contentType) return false;

    const contentType = request.contentType.toLowerCase();
    return this.features.CONTENT_TYPES.some((type) => contentType.includes(type));
  }

  /**
   * 获取检测统计信息
   * @returns {Object} 检测器统计信息
   */
  getDetectionStats() {
    return {
      supportedMethods: this.features.METHODS.length,
      supportedHeaders: this.features.HEADERS.length,
      pathPatterns: this.features.PATH_PATTERNS.length,
      contentTypes: this.features.CONTENT_TYPES.length,
      threshold: this.features.DETECTION_THRESHOLD,
    };
  }

  /**
   * 验证检测器配置
   * @returns {boolean} 配置是否有效
   */
  validateConfiguration() {
    try {
      const requiredFeatures = ["METHODS", "HEADERS", "PATH_PATTERNS", "CONTENT_TYPES", "DETECTION_THRESHOLD"];

      for (const feature of requiredFeatures) {
        if (!(feature in this.features)) {
          console.error(`WebDAV检测器配置错误: 缺少${feature}`);
          return false;
        }
      }

      if (this.features.DETECTION_THRESHOLD < 1) {
        console.error("WebDAV检测器配置错误: 检测阈值必须大于等于1");
        return false;
      }

      return true;
    } catch (error) {
      console.error("WebDAV检测器配置验证失败:", error);
      return false;
    }
  }
}

/**
 * 创建WebDAV检测器实例
 * @returns {WebDAVDetector} 检测器实例
 */
export function createWebDAVDetector() {
  const detector = new WebDAVDetector();

  if (!detector.validateConfiguration()) {
    throw new Error("WebDAV检测器配置无效");
  }

  return detector;
}

/**
 * 便捷函数：检测WebDAV请求
 * @param {Object} request - 请求对象
 * @returns {boolean} 是否为WebDAV请求
 */
export function isWebDAVRequest(request) {
  const detector = createWebDAVDetector();
  return detector.detectWebDAVRequest(request);
}
