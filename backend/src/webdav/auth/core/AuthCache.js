/**
 * WebDAV认证缓存管理器
 *
 */

import { getWebDAVConfig } from "../config/WebDAVConfig.js";
import crypto from "crypto";

/**
 * 缓存配置
 */
const CACHE_CONFIG = {
  // 缓存过期时间（毫秒）
  EXPIRATION: 10 * 60 * 1000, // 10分钟

  // 最大缓存条目数
  MAX_ENTRIES: 500,

  // 清理间隔（毫秒）
  CLEANUP_INTERVAL: 60 * 1000, // 1分钟

  // 缓存键安全配置
  KEY_HASH_ALGORITHM: "sha256",
  KEY_HASH_LENGTH: 16, // 截取前16个字符

  // 安全限制
  MAX_IP_LENGTH: 45, // IPv6最大长度
  MAX_USER_AGENT_LENGTH: 1000,
};

/**
 * WebDAV认证缓存类
 */
export class WebDAVAuthCache {
  constructor() {
    this.cache = new Map();
    this.config = getWebDAVConfig("AUTHENTICATION.CACHE") || CACHE_CONFIG;
    this.stats = {
      hits: 0,
      misses: 0,
      stores: 0,
      cleanups: 0,
      errors: 0,
    };

    // 启动定期清理
    this.startCleanupTimer();
  }

  /**
   * 生成安全的缓存键
   * 使用哈希算法避免直接存储敏感信息
   *
   * @param {string} clientIp - 客户端IP
   * @param {string} userAgent - 用户代理
   * @returns {string} 安全的缓存键
   */
  generateCacheKey(clientIp, userAgent) {
    try {
      // 输入验证和清理
      const cleanIp = this.sanitizeInput(clientIp, CACHE_CONFIG.MAX_IP_LENGTH);
      const cleanUA = this.sanitizeInput(userAgent, CACHE_CONFIG.MAX_USER_AGENT_LENGTH);

      // 创建稳定的组合字符串（移除时间戳，确保相同客户端生成相同键）
      const combined = `${cleanIp}:${cleanUA}`;

      // 生成哈希
      const hash = crypto.createHash(CACHE_CONFIG.KEY_HASH_ALGORITHM).update(combined).digest("hex").substring(0, CACHE_CONFIG.KEY_HASH_LENGTH);

      return `webdav_auth_${hash}`;
    } catch (error) {
      console.error("缓存键生成失败:", error);
      // 降级到基于IP和UA的简单键生成（移除随机性）
      const safeIp = clientIp.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 15);
      const safeUA = userAgent.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 10);
      return `webdav_auth_${safeIp}_${safeUA}`;
    }
  }

  /**
   * 清理输入字符串
   * @param {string} input - 输入字符串
   * @param {number} maxLength - 最大长度
   * @returns {string} 清理后的字符串
   */
  sanitizeInput(input, maxLength) {
    if (!input || typeof input !== "string") {
      return "unknown";
    }

    // 移除控制字符和特殊字符
    const cleaned = input
      .replace(/[\x00-\x1f\x7f-\x9f]/g, "") // 移除控制字符
      .replace(/[<>'"&]/g, "") // 移除HTML特殊字符
      .trim();

    return cleaned.substring(0, maxLength);
  }

  /**
   * 存储认证信息到缓存
   * @param {string} clientIp - 客户端IP
   * @param {string} userAgent - 用户代理
   * @param {Object} authInfo - 认证信息
   */
  storeAuthInfo(clientIp, userAgent, authInfo) {
    try {
      // 检查缓存大小限制
      if (this.cache.size >= CACHE_CONFIG.MAX_ENTRIES) {
        this.evictOldestEntry();
      }

      const key = this.generateCacheKey(clientIp, userAgent);
      const cacheEntry = {
        authInfo: authInfo,
        timestamp: Date.now(),
        lastAccessed: Date.now(),
        clientIp: this.sanitizeInput(clientIp, 15) + "***", // 部分隐藏IP
        userAgent: this.sanitizeInput(userAgent, 20) + "...", // 部分隐藏UA
      };

      const isUpdate = this.cache.has(key);
      this.cache.set(key, cacheEntry);
      this.stats.stores++;

      console.log(`WebDAV认证缓存: ${isUpdate ? "更新" : "存储"}成功 (${this.cache.size}/${CACHE_CONFIG.MAX_ENTRIES}) [键:${key.substring(0, 20)}...]`);
    } catch (error) {
      console.error("WebDAV认证缓存存储失败:", error);
      this.stats.errors++;
    }
  }

  /**
   * 从缓存获取认证信息
   * @param {string} clientIp - 客户端IP
   * @param {string} userAgent - 用户代理
   * @returns {Object|null} 认证信息或null
   */
  getAuthInfo(clientIp, userAgent) {
    try {
      const key = this.generateCacheKey(clientIp, userAgent);
      const cached = this.cache.get(key);

      if (!cached) {
        this.stats.misses++;
        return null;
      }

      // 检查是否过期
      if (Date.now() - cached.timestamp > CACHE_CONFIG.EXPIRATION) {
        this.cache.delete(key);
        this.stats.misses++;
        console.log("WebDAV认证缓存: 条目已过期");
        return null;
      }

      // 更新最后访问时间（LRU策略）
      cached.lastAccessed = Date.now();
      this.cache.set(key, cached);
      this.stats.hits++;

      console.log(`WebDAV认证缓存: 命中 (${cached.clientIp}, ${cached.userAgent}) [键:${key.substring(0, 20)}...]`);
      return cached.authInfo;
    } catch (error) {
      console.error("WebDAV认证缓存获取失败:", error);
      this.stats.errors++;
      return null;
    }
  }

  /**
   * 清除特定的认证信息
   * @param {string} clientIp - 客户端IP
   * @param {string} userAgent - 用户代理
   */
  clearAuthInfo(clientIp, userAgent) {
    try {
      const key = this.generateCacheKey(clientIp, userAgent);
      const deleted = this.cache.delete(key);

      if (deleted) {
        console.log("WebDAV认证缓存: 条目已清除");
      }
    } catch (error) {
      console.error("WebDAV认证缓存清除失败:", error);
      this.stats.errors++;
    }
  }

  /**
   * 清理过期缓存条目
   */
  cleanup() {
    try {
      const now = Date.now();
      let cleanedCount = 0;

      for (const [key, entry] of this.cache.entries()) {
        if (now - entry.timestamp > CACHE_CONFIG.EXPIRATION) {
          this.cache.delete(key);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        console.log(`WebDAV认证缓存: 清理了${cleanedCount}个过期条目`);
      }

      this.stats.cleanups++;
    } catch (error) {
      console.error("WebDAV认证缓存清理失败:", error);
      this.stats.errors++;
    }
  }

  /**
   * 驱逐最旧的缓存条目（LRU策略）
   */
  evictOldestEntry() {
    try {
      let oldestKey = null;
      let oldestTime = Date.now();

      for (const [key, entry] of this.cache.entries()) {
        if (entry.lastAccessed < oldestTime) {
          oldestTime = entry.lastAccessed;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey);
        console.log("WebDAV认证缓存: 驱逐最旧条目");
      }
    } catch (error) {
      console.error("WebDAV认证缓存驱逐失败:", error);
      this.stats.errors++;
    }
  }

  /**
   * 启动定期清理定时器
   */
  startCleanupTimer() {
    // 避免在Cloudflare Workers环境中使用setInterval
    if (typeof setInterval !== "undefined") {
      setInterval(() => {
        this.cleanup();
      }, CACHE_CONFIG.CLEANUP_INTERVAL);
    }
  }

  /**
   * 清空所有缓存
   */
  clearAll() {
    const size = this.cache.size;
    this.cache.clear();
    console.log(`WebDAV认证缓存: 清空所有缓存 (${size}个条目)`);
  }

  /**
   * 获取缓存统计信息
   * @returns {Object} 统计信息
   */
  getStats() {
    return {
      ...this.stats,
      currentSize: this.cache.size,
      maxSize: CACHE_CONFIG.MAX_ENTRIES,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
      config: {
        expiration: CACHE_CONFIG.EXPIRATION,
        maxEntries: CACHE_CONFIG.MAX_ENTRIES,
        cleanupInterval: CACHE_CONFIG.CLEANUP_INTERVAL,
      },
    };
  }

  /**
   * 获取缓存健康状态
   * @returns {Object} 健康状态
   */
  getHealthStatus() {
    const stats = this.getStats();

    return {
      healthy: stats.errors < 10 && stats.currentSize < stats.maxSize * 0.9,
      usage: stats.currentSize / stats.maxSize,
      hitRate: stats.hitRate,
      errorRate: stats.errors / (stats.hits + stats.misses + stats.stores) || 0,
    };
  }
}

/**
 * 创建WebDAV认证缓存实例
 * @returns {WebDAVAuthCache} 缓存实例
 */
export function createWebDAVAuthCache() {
  return new WebDAVAuthCache();
}
