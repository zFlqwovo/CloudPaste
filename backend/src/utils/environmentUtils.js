/**
 * 环境检测和配置工具
 * 用于根据部署环境（Cloudflare Worker vs Docker/Server）提供最优配置
 */

/**
 * 检测当前是否运行在Cloudflare Worker环境
 * @returns {boolean} 是否为Worker环境
 */
export function isCloudflareWorkerEnvironment() {
  return typeof globalThis.caches !== "undefined" && 
         typeof globalThis.EdgeRuntime !== "undefined";
}

/**
 * 获取环境自适应的上传配置
 * @returns {Object} 上传配置对象
 */
export function getEnvironmentOptimizedUploadConfig() {
  const isWorker = isCloudflareWorkerEnvironment();
  
  return isWorker ? {
    partSize: 6 * 1024 * 1024, // 6MB - Worker环境内存限制
    queueSize: 1,              // 1并发 - 避免CPU时间超限
    environment: 'Cloudflare Worker',
    maxConcurrency: 1,         // 最大并发数
    bufferSize: 6 * 1024 * 1024 // 缓冲区大小
  } : {
    partSize: 8 * 1024 * 1024, // 8MB - Docker环境更大分片
    queueSize: 3,              // 3并发 - 充分利用多核心
    environment: 'Docker/Server',
    maxConcurrency: 3,         // 最大并发数
    bufferSize: 24 * 1024 * 1024 // 缓冲区大小
  };
}

/**
 * 获取环境名称
 * @returns {string} 环境名称
 */
export function getEnvironmentName() {
  return isCloudflareWorkerEnvironment() ? 'Cloudflare Worker' : 'Docker/Server';
}

/**
 * 获取推荐的分片大小
 * @returns {number} 分片大小（字节）
 */
export function getRecommendedPartSize() {
  return isCloudflareWorkerEnvironment() ? 6 * 1024 * 1024 : 8 * 1024 * 1024;
}

/**
 * 获取推荐的并发数
 * @returns {number} 并发数
 */
export function getRecommendedConcurrency() {
  return isCloudflareWorkerEnvironment() ? 1 : 3;
}
