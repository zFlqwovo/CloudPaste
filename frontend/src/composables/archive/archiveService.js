/**
 * 压缩文件处理服务
 * 统一封装 zip.js 和 libarchive.js，提供一致的 API 接口
 */

import { ZipReaderStream, ZipReader, BlobReader, BlobWriter } from "@zip.js/zip.js";
import { Archive } from "libarchive.js";
import { getArchiveType } from "@/utils/fileTypes";
import { LRUCache } from "@/utils/lruCache.js";

// 常量定义
const CONSTANTS = {
  // 缓存配置
  CACHE: {
    EXTRACT_SIZE: 10, // 解压结果缓存大小
    FILE_BLOB_SIZE: 2, // 文件Blob缓存大小
    TTL: 10 * 60 * 1000, // 缓存时间：10分钟
  },
  // 检测配置
  DETECTION: {
    MAX_CHECK_ENTRIES: 3, // 加密检测最大检查条目数
  },
  // 进度分配
  PROGRESS: {
    DOWNLOAD_RATIO: 70, // 下载进度占比：70%
    EXTRACT_RATIO: 30, // 解压进度占比：30%
  },
  // 估算配置
  ESTIMATION: {
    INITIAL_ENTRIES: 10, // 初始估算条目数
  },
};

/**
 * 压缩文件处理服务类
 * 统一封装 zip.js 和 libarchive.js，提供一致的 API 接口
 */
class ArchiveService {
  constructor() {
    this.libarchiveInitialized = false;
    this.initPromise = null;

    // 简单配置对象
    this.config = {
      workerUrl: "/libarchive.js/dist/worker-bundle.js",
      cacheEnabled: true,
    };

    // 解压结果缓存
    this.extractCache = new LRUCache(CONSTANTS.CACHE.EXTRACT_SIZE);

    // 文件Blob缓存（用于密码验证时避免重复下载）
    this.fileBlobCache = new LRUCache(CONSTANTS.CACHE.FILE_BLOB_SIZE);
  }

  // ===================================================================
  // 核心配置和初始化
  // ===================================================================

  /**
   * 初始化 libarchive.js（懒加载）
   * @returns {Promise<boolean>} 是否初始化成功
   */
  async initLibarchive() {
    if (this.libarchiveInitialized) {
      return true;
    }

    // 避免重复初始化
    if (this.initPromise) {
      return await this.initPromise;
    }

    this.initPromise = this._performInit();
    return await this.initPromise;
  }

  async _performInit() {
    try {
      // 检查 WebAssembly 支持
      if (!this.isWebAssemblySupported()) {
        console.warn("当前浏览器不支持 WebAssembly，libarchive.js 功能将不可用");
        return false;
      }

      console.log("正在初始化 libarchive.js WebWorker:", this.config.workerUrl);

      Archive.init({
        workerUrl: this.config.workerUrl,
      });

      this.libarchiveInitialized = true;
      console.log("libarchive.js 初始化成功，WebWorker已配置");
      return true;
    } catch (error) {
      console.warn("libarchive.js 初始化失败，将降级到仅支持 ZIP:", error);
      return false;
    }
  }

  // ===================================================================
  // 统一入口
  // ===================================================================

  /**
   * 统一的压缩文件解压接口
   * @param {Blob|File|string} fileBlobOrUrl - 压缩文件 Blob 对象或URL
   * @param {string} filename - 文件名
   * @param {string} fileUrl - 文件URL（用于缓存键）
   * @param {Function} progressCallback - 进度回调函数 (progress: 0-100)
   * @param {string|null} password - 可选的解压密码
   * @returns {Promise<Array>} 统一格式的文件列表
   */
  async extractArchive(fileBlobOrUrl, filename, fileUrl = "", progressCallback = null, password = null) {
    // 智能缓存检查
    if (this.config.cacheEnabled && fileUrl) {
      const cacheKey = `${fileUrl}_${filename}`;
      const cached = this.extractCache.get(cacheKey);
      if (cached) {
        console.log("使用缓存的解压结果:", filename);
        if (progressCallback) progressCallback(100);
        return cached;
      }
    }

    const archiveType = getArchiveType(filename);

    if (!archiveType.supported) {
      throw new Error(`不支持的压缩格式: ${archiveType.name}`);
    }

    console.log(`开始处理 ${archiveType.name} 格式文件:`, filename);

    // 根据格式和密码情况选择最优处理方式
    let result;
    if (archiveType.name === "ZIP") {
      // 第一步：检测文件是否加密
      let isEncrypted = false;
      let fileBlob = null;

      if (typeof fileBlobOrUrl === "string" && fileBlobOrUrl.startsWith("http")) {
        // 远程文件：使用轻量级流式检测
        isEncrypted = await this.lightweightEncryptionCheck(fileBlobOrUrl, progressCallback);
      } else {
        isEncrypted = await this.quickEncryptionCheck(fileBlobOrUrl);
        fileBlob = fileBlobOrUrl;
      }

      if (isEncrypted && !password) {
        throw new Error("ENCRYPTED_ARCHIVE_DETECTED");
      } else if (isEncrypted && password) {
        if (!fileBlob && typeof fileBlobOrUrl === "string" && fileBlobOrUrl.startsWith("http")) {
          fileBlob = await this.getOrDownloadFileBlob(fileBlobOrUrl, progressCallback, 0, 70, "下载中");
        } else if (!fileBlob) {
          fileBlob = fileBlobOrUrl;
          if (progressCallback) progressCallback(70, "准备解压");
        }
        result = await this.extractZipWithPassword(fileBlob, password, progressCallback);
      } else {
        result = await this.extractWithZipReaderStream(fileBlobOrUrl, progressCallback);
      }
    } else {
      // libarchive格式：密码检测和分支逻辑
      let hasEncrypted = false;
      let fileBlob = null;

      if (typeof fileBlobOrUrl === "string" && fileBlobOrUrl.startsWith("http")) {
        // 远程文件：先下载用于检测
        fileBlob = await this.getOrDownloadFileBlob(fileBlobOrUrl, progressCallback, 0, 50, "下载中");
        hasEncrypted = await this.libarchiveEncryptionCheck(fileBlob, archiveType, progressCallback);
      } else {
        hasEncrypted = await this.libarchiveEncryptionCheck(fileBlobOrUrl, archiveType, progressCallback);
        fileBlob = fileBlobOrUrl;
      }

      // 第二步：根据加密状态和密码情况选择处理方式
      if (hasEncrypted && !password) {
        throw new Error("ENCRYPTED_ARCHIVE_DETECTED");
      } else if (hasEncrypted && password) {
        // 加密文件需要密码：fileBlob应该已经在检测阶段准备好了
        if (!fileBlob) {
          console.warn("密码解压时fileBlob为空，尝试重新获取");
          if (typeof fileBlobOrUrl === "string" && fileBlobOrUrl.startsWith("http")) {
            fileBlob = await this.getOrDownloadFileBlob(fileBlobOrUrl, progressCallback, 60, 70, "重新下载");
          } else {
            fileBlob = fileBlobOrUrl;
          }
        }

        if (progressCallback) progressCallback(70, "准备密码解压");
        result = await this.extractLibarchiveWithPassword(fileBlob, archiveType, password, progressCallback);
      } else {
        result = await this.extractWithLibarchiveStream(fileBlob, archiveType, progressCallback);
      }
    }

    // 只缓存成功结果
    if (this.config.cacheEnabled && fileUrl && result && result.length > 0) {
      const cacheKey = `${fileUrl}_${filename}`;
      this.extractCache.set(cacheKey, result, CONSTANTS.CACHE.TTL);
      console.log("缓存解压结果:", filename, `文件数量: ${result.length}`);
    }

    return result;
  }

  /**
   * 清除特定文件的缓存
   * @param {string} fileUrl - 文件URL
   * @param {string} filename - 文件名
   */
  clearFileCache(fileUrl, filename) {
    if (!this.config.cacheEnabled || !fileUrl) return;

    const cacheKey = `${fileUrl}_${filename}`;
    this.extractCache.delete(cacheKey);
    console.log("已清除文件缓存:", filename);
  }

  /**
   * 清除文件Blob缓存
   * @param {string} fileUrl - 文件URL
   */
  clearFileBlobCache(fileUrl) {
    if (!fileUrl) return;

    this.fileBlobCache.delete(fileUrl);
    console.log("已清除文件Blob缓存:", fileUrl);
  }

  // ===================================================================
  // ZIP.js 处理器（纯解压方法）
  // ===================================================================

  /**
   * 加密检测（用于远程文件）
   * @param {string} fileUrl - 远程文件URL
   * @param {Function} progressCallback - 进度回调函数
   * @returns {Promise<boolean>} true表示检测到加密，false表示无加密
   */
  async lightweightEncryptionCheck(fileUrl, progressCallback = null) {
    try {
      console.log("开始流式加密检测...");
      if (progressCallback) progressCallback(90, "检测中");

      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const zipReaderStream = new ZipReaderStream({
        useWebWorkers: false,
        useCompressionStream: true,
        transferStreams: false,
      });

      let entryCount = 0;
      let hasEncrypted = false;

      for await (const entry of response.body.pipeThrough(zipReaderStream)) {
        entryCount++;
        console.log(`检查第${entryCount}个条目: ${entry.filename}, 加密: ${entry.encrypted}`);

        if (entry.encrypted) {
          hasEncrypted = true;
          break;
        }

        if (entryCount >= CONSTANTS.DETECTION.MAX_CHECK_ENTRIES) {
          break;
        }
      }

      if (progressCallback) {
        progressCallback(100, hasEncrypted ? "发现加密" : "无加密");
      }

      return hasEncrypted;
    } catch (error) {
      console.warn("加密检测失败:", error.message);
      // 检测失败时保守处理：假设无加密
      return false;
    }
  }

  /**
   * 快速加密检测（纯检测，无下载）
   * @param {Blob} fileBlob - 已下载的文件Blob
   * @returns {Promise<boolean>} true表示检测到加密，false表示无加密
   */
  async quickEncryptionCheck(fileBlob) {
    try {
      console.log("开始加密检测blob...");
      const zipReader = new ZipReader(new BlobReader(fileBlob));
      const entries = await zipReader.getEntries();

      const checkCount = Math.min(entries.length, CONSTANTS.DETECTION.MAX_CHECK_ENTRIES);
      for (let i = 0; i < checkCount; i++) {
        const entry = entries[i];
        if (entry.encrypted) {
          await zipReader.close();
          return true;
        }
      }

      await zipReader.close();
      return false;
    } catch (error) {
      console.warn("⚠️ 快速加密检测失败:", error.message);
      // 检测失败时保守处理：假设无加密
      return false;
    }
  }

  /**
   * ZIP密码解压（纯解压，无下载）
   * @param {Blob} fileBlob - 已下载的文件Blob
   * @param {string} password - 解压密码
   * @param {Function} progressCallback - 进度回调函数
   * @returns {Promise<Array>} 统一格式的文件列表
   */
  async extractZipWithPassword(fileBlob, password, progressCallback = null) {
    try {
      console.log("开始ZipReader进行密码解压...");
      if (progressCallback) progressCallback(75, "解析中");

      // 使用ZipReader进行密码解压
      const zipReader = new ZipReader(new BlobReader(fileBlob), { password });
      const entries = await zipReader.getEntries();

      const result = [];
      let processedEntries = 0;

      for (const entry of entries) {
        if (entry.directory) {
          // 目录条目
          result.push({
            name: entry.filename,
            size: 0,
            compressedSize: 0,
            isDirectory: true,
            lastModDate: entry.lastModDate || new Date(),
            entry: {
              entry: entry,
              type: "zipjs-reader",
              async getContent() {
                throw new Error("Cannot extract directory");
              },
            },
          });
        } else {
          // 文件条目 - 立即解密内容

          let cachedContent;
          try {
            const writer = new BlobWriter();
            await entry.getData(writer);
            // BlobWriter.getData() 返回Promise，需要await
            const blob = await writer.getData();
            cachedContent = await blob.arrayBuffer();
          } catch (error) {
            if (error.message && error.message.includes("Invalid password")) {
              throw new Error("INVALID_ARCHIVE_PASSWORD");
            }
            throw error;
          }

          result.push({
            name: entry.filename,
            size: entry.uncompressedSize || 0,
            compressedSize: entry.compressedSize || 0,
            isDirectory: false,
            lastModDate: entry.lastModDate || new Date(),
            entry: {
              entry: entry,
              type: "zipjs-reader",
              cachedContent,
              async getContent() {
                // 直接返回缓存的ArrayBuffer
                return this.cachedContent;
              },
            },
          });
        }

        processedEntries++;

        // 解压进度：75-100%
        if (progressCallback) {
          const extractProgress = 75 + (processedEntries / entries.length) * 25;
          progressCallback(Math.min(extractProgress, 100), "解压中");
        }
      }

      await zipReader.close();

      if (progressCallback) progressCallback(100, "完成");

      console.log(`ZipReader 密码解压完成，处理了 ${entries.length} 个条目`);
      return result;
    } catch (error) {
      console.error("ZIP密码解压失败:", error);
      throw error;
    }
  }

  /**
   * 使用 ZipReaderStream 统一流式解压 ZIP 文件（支持URL和Blob输入）
   * @param {string|Blob|File} fileBlobOrUrl - ZIP 文件URL或Blob对象
   * @param {Function} progressCallback - 进度回调函数 (progress: 0-100)
   * @returns {Promise<Array>} 统一格式的文件列表
   */
  async extractWithZipReaderStream(fileBlobOrUrl, progressCallback = null) {
    try {
      let readableStream;
      let totalSize = 0;
      let loaded = 0;
      let isRemoteFile = false;

      // 统一获取ReadableStream
      if (typeof fileBlobOrUrl === "string" && fileBlobOrUrl.startsWith("http")) {
        // 远程文件：fetch获取stream
        console.log("ZipReaderStream 处理远程ZIP文件:", fileBlobOrUrl);
        isRemoteFile = true;

        const response = await fetch(fileBlobOrUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentLength = response.headers.get("content-length");
        totalSize = contentLength ? parseInt(contentLength, 10) : 0;
        readableStream = response.body;

        console.log(`远程ZIP文件大小: ${totalSize ? (totalSize / 1024 / 1024).toFixed(2) + "MB" : "未知"}`);
      } else {
        // 本地Blob：使用Blob.stream()转换为ReadableStream
        console.log("ZipReaderStream 处理本地ZIP文件");
        const blob = fileBlobOrUrl;
        totalSize = blob.size;
        readableStream = blob.stream();

        console.log(`本地ZIP文件大小: ${(totalSize / 1024 / 1024).toFixed(2)}MB`);
      }

      // 创建进度监控的TransformStream（统一处理）
      const progressMonitorStream = new TransformStream({
        transform(chunk, controller) {
          loaded += chunk.length;

          if (totalSize > 0 && progressCallback) {
            // 下载/读取进度占70%，解压进度占30%
            const readProgress = (loaded / totalSize) * CONSTANTS.PROGRESS.DOWNLOAD_RATIO;
            const stage = isRemoteFile ? "下载中" : "读取中";
            progressCallback(Math.min(readProgress, CONSTANTS.PROGRESS.DOWNLOAD_RATIO), stage);
          }

          controller.enqueue(chunk);
        },
      });

      const result = [];
      let processedEntries = 0;
      let estimatedTotalEntries = CONSTANTS.ESTIMATION.INITIAL_ENTRIES; // 初始估算值，会动态调整

      // 使用 ZipReaderStream 流式处理（添加性能优化配置）
      const zipReaderStream = new ZipReaderStream({
        useWebWorkers: true, //启用Web Workers
        useCompressionStream: true, // 使用原生压缩流API
        transferStreams: true, // 启用流传输到Web Workers
      });

      console.log("开始流式解析ZIP条目...");

      // ReadableStream → 进度监控 → ZIP解析（统一处理）
      for await (const entry of readableStream.pipeThrough(progressMonitorStream).pipeThrough(zipReaderStream)) {
        // 转换为统一格式
        const fileInfo = {
          name: entry.filename,
          size: entry.uncompressedSize || 0,
          compressedSize: entry.compressedSize || 0,
          isDirectory: entry.directory,
          lastModDate: entry.lastModDate || new Date(),
          entry: {
            entry: entry,
            type: "zipjs-stream",
            async getContent() {
              // pipeTo方式，更高效且避免内存泄漏
              if (!entry.readable) {
                throw new Error(`Entry "${entry.filename}" readable stream is not available`);
              }

              // 使用Response API转换ReadableStream为ArrayBuffer
              return new Response(entry.readable).arrayBuffer();
            },
          },
        };

        result.push(fileInfo);
        processedEntries++;

        // 动态调整估算的总条目数
        if (processedEntries > estimatedTotalEntries * 0.8) {
          estimatedTotalEntries = Math.ceil(processedEntries * 1.5);
        }

        // 解压进度：70-100%（基于动态估算的总条目数）
        if (progressCallback) {
          const extractProgress = CONSTANTS.PROGRESS.DOWNLOAD_RATIO + (processedEntries / estimatedTotalEntries) * CONSTANTS.PROGRESS.EXTRACT_RATIO;
          progressCallback(Math.min(extractProgress, 95), "解压中");
        }
      }

      // 确保进度达到100%
      if (progressCallback) {
        progressCallback(100, "完成");
      }

      console.log("ZipReaderStream 流式解压成功，文件数量:", result.length);
      console.log(`下载了 ${(loaded / 1024 / 1024).toFixed(2)}MB 数据`);
      return result;
    } catch (error) {
      console.error("ZipReaderStream 流式解压失败:", error);
      throw error;
    }
  }

  // ===================================================================
  // libarchive.js 处理器（支持多种压缩格式）
  // ===================================================================

  /**
   * libarchive加密检测
   * @param {Blob} fileBlob - 已下载的文件Blob
   * @param {Object} archiveType - 压缩格式信息
   * @param {Function} progressCallback - 进度回调函数
   * @returns {Promise<boolean>} true表示检测到加密，false表示无加密
   */
  async libarchiveEncryptionCheck(fileBlob, archiveType, progressCallback = null) {
    const initialized = await this.initLibarchive();

    if (!initialized) {
      throw new Error(`libarchive.js 未初始化，无法检测 ${archiveType.name} 格式`);
    }

    try {
      console.log(`开始检测 ${archiveType.name} 文件是否加密...`);
      if (progressCallback) progressCallback(55, "检测加密");

      // 使用官方API打开压缩文件
      const archive = await Archive.open(fileBlob);

      try {
        // 检查是否有加密数据
        const hasEncrypted = await archive.hasEncryptedData();

        if (progressCallback) {
          progressCallback(60, hasEncrypted ? "发现加密" : "无加密");
        }

        console.log(`${archiveType.name} 加密检测完成:`, hasEncrypted === true ? "有加密" : "无加密");
        return hasEncrypted === true;
      } finally {
        // 关闭archive释放worker
        try {
          await archive.close();
        } catch (closeError) {
          console.warn("关闭archive时出错:", closeError);
        }
      }
    } catch (error) {
      console.warn(`⚠️ ${archiveType.name} 加密检测失败:`, error.message);
      return false;
    }
  }

  /**
   * libarchive密码解压
   * @param {Blob} fileBlob - 已下载的文件Blob
   * @param {Object} archiveType - 压缩格式信息
   * @param {string} password - 解压密码
   * @param {Function} progressCallback - 进度回调函数
   * @returns {Promise<Array>} 统一格式的文件列表
   */
  async extractLibarchiveWithPassword(fileBlob, archiveType, password, progressCallback = null) {
    const initialized = await this.initLibarchive();

    if (!initialized) {
      throw new Error(`libarchive.js 未初始化，无法处理 ${archiveType.name} 格式`);
    }

    let archive = null;
    try {
      console.log(`开始libarchive密码解压 ${archiveType.name} 文件...`);
      if (progressCallback) progressCallback(75, "解析中");

      // 打开压缩文件
      archive = await Archive.open(fileBlob);
      // 设置密码
      await archive.usePassword(password);
      console.log(`${archiveType.name} 文件密码已设置`);

      // 全量解压所有文件
      const extractedFiles = await archive.extractFiles((entry) => {
        if (progressCallback && entry.path) {
          console.log(`正在解压: ${entry.path}`);
        }
      });
      console.log(`${archiveType.name} 全量解压完成`);

      const result = [];
      let processedFiles = 0;
      const totalFiles = this.countExtractedFiles(extractedFiles);

      // 转换为统一格式（全量解压，内容已缓存）
      const processFiles = (obj, basePath = "") => {
        for (const [name, item] of Object.entries(obj)) {
          const fullPath = basePath ? `${basePath}/${name}` : name;

          if (item instanceof File) {
            // 这是一个已解压的File对象
            result.push({
              name: fullPath,
              size: item.size || 0,
              compressedSize: 0,
              isDirectory: false,
              lastModDate: item.lastModified ? new Date(item.lastModified) : new Date(),
              entry: {
                entry: item,
                type: "libarchive-password",
                cachedContent: null, // 将在下面设置
                async getContent() {
                  // 直接返回缓存的ArrayBuffer
                  if (!this.cachedContent) {
                    this.cachedContent = await item.arrayBuffer();
                  }
                  return this.cachedContent;
                },
              },
            });

            // 立即缓存内容
            item.arrayBuffer().then((buffer) => {
              result[result.length - 1].entry.cachedContent = buffer;
            });
          } else if (typeof item === "object" && item !== null) {
            // 这是一个目录，递归处理
            result.push({
              name: fullPath + "/",
              size: 0,
              compressedSize: 0,
              isDirectory: true,
              lastModDate: new Date(),
              entry: {
                entry: null,
                type: "libarchive-password",
                async getContent() {
                  throw new Error("Cannot extract directory");
                },
              },
            });

            processFiles(item, fullPath);
          }

          processedFiles++;

          // 解压进度：75-100%
          if (progressCallback) {
            const extractProgress = 75 + (processedFiles / Math.max(totalFiles, 1)) * 25;
            progressCallback(Math.min(extractProgress, 100), "解压中");
          }
        }
      };

      processFiles(extractedFiles);

      if (progressCallback) progressCallback(100, "完成");

      console.log(`libarchive密码解压完成，处理了 ${totalFiles} 个文件`);
      return result;
    } catch (error) {
      console.error(`${archiveType.name} 密码解压失败:`, error);

      // 统一错误处理
      if (error.message && error.message.includes("password")) {
        throw new Error("INVALID_ARCHIVE_PASSWORD");
      }
      throw error;
    } finally {
      // 标准资源管理：关闭archive释放worker
      if (archive) {
        try {
          await archive.close();
        } catch (closeError) {
          console.warn("关闭archive时出错:", closeError);
        }
      }
    }
  }

  /**
   * 使用 libarchive.js 按需解压模式
   * @param {Blob|File} fileBlob - 压缩文件 Blob 对象
   * @param {Object} archiveType - 压缩格式信息
   * @param {Function} progressCallback - 进度回调函数 (progress: 0-100)
   * @returns {Promise<Array>} 统一格式的文件列表
   */
  async extractWithLibarchiveStream(fileBlob, archiveType, progressCallback = null) {
    const initialized = await this.initLibarchive();

    if (!initialized) {
      throw new Error(`libarchive.js 未初始化，无法处理 ${archiveType.name} 格式`);
    }

    let archive = null;
    try {
      // 使用官方API打开压缩文件
      archive = await Archive.open(fileBlob);
      // 获取文件列表（不解压内容，符合官方推荐的按需解压模式）
      const filesObject = await archive.getFilesObject();

      console.log(`libarchive.js 获取 ${archiveType.name} 文件列表完成`);
      console.log(`文件内容将按需解压，不占用大量内存`);

      // 转换为统一格式（按需解压）
      const result = [];
      let processedFiles = 0;
      const totalFiles = this.countTotalFiles(filesObject); // 计算总文件数

      const processFiles = (obj, basePath = "") => {
        for (const [name, item] of Object.entries(obj)) {
          const fullPath = basePath ? `${basePath}/${name}` : name;

          if (item && typeof item.extract === "function") {
            // 这是一个 CompressedFile，支持按需解压
            result.push({
              name: fullPath,
              size: item.size || 0,
              compressedSize: item.compressedSize || 0,
              isDirectory: false,
              lastModDate: new Date(),
              entry: {
                entry: item,
                type: "libarchive",
                async getContent() {
                  // 按需解压：只有在需要时才解压单个文件
                  console.log(`按需解压文件: ${fullPath}`);
                  try {
                    const file = await item.extract();
                    return await file.arrayBuffer();
                  } catch (error) {
                    console.error(`解压文件 ${fullPath} 失败:`, error);
                    throw new Error(`解压文件失败: ${error.message}`);
                  }
                },
              },
            });
          } else if (typeof item === "object" && item !== null) {
            // 这是一个目录，递归处理
            result.push({
              name: fullPath + "/",
              size: 0,
              compressedSize: 0,
              isDirectory: true,
              lastModDate: new Date(),
              entry: {
                entry: null,
                type: "libarchive",
                async getContent() {
                  throw new Error("Cannot extract directory");
                },
              },
            });
            processFiles(item, fullPath);
          }

          // 更新文件列表处理进度
          processedFiles++;
          if (progressCallback) {
            // 文件列表处理进度
            const progress = (processedFiles / totalFiles) * 100;
            progressCallback(Math.min(progress, 100), "分析文件");
          }
        }
      };

      processFiles(filesObject);

      console.log(`libarchive按需解压准备完成，处理了 ${result.length} 个项目`);
      return result;
    } catch (error) {
      console.error(`libarchive.js 解压 ${archiveType.name} 失败:`, error);
      throw new Error(`${archiveType.name} 文件解压失败: ${error.message}`);
    }
  }

  /**
   * 获取或下载文件Blob（带缓存）
   * @param {string} fileUrl - 文件URL
   * @param {Function} progressCallback - 进度回调
   * @param {number} startProgress - 起始进度
   * @param {number} endProgress - 结束进度
   * @param {string} stage - 阶段描述
   * @returns {Promise<Blob>} 文件Blob
   */
  async getOrDownloadFileBlob(fileUrl, progressCallback = null, startProgress = 0, endProgress = 100, stage = "下载中") {
    const cacheKey = fileUrl;
    const cachedBlob = this.fileBlobCache.get(cacheKey);

    if (cachedBlob) {
      console.log("使用缓存文件:", fileUrl);
      if (progressCallback) progressCallback(endProgress, "使用缓存文件");
      return cachedBlob;
    }

    // 下载并缓存
    const fileBlob = await this.downloadFileWithProgress(fileUrl, progressCallback, startProgress, endProgress, stage);
    this.fileBlobCache.set(cacheKey, fileBlob, CONSTANTS.CACHE.TTL);
    console.log("文件已下载并缓存:", fileUrl);
    return fileBlob;
  }

  /**
   * 递归计算文件总数（libarchive.js辅助方法）
   * @param {Object} filesObject - getFilesObject()返回的嵌套对象
   * @returns {number} 总文件数量
   */
  countTotalFiles(filesObject) {
    let count = 0;

    const countRecursive = (obj) => {
      for (const [, item] of Object.entries(obj)) {
        if (item && typeof item.extract === "function") {
          // CompressedFile
          count++;
        } else if (typeof item === "object" && item !== null) {
          // 目录
          count++;
          countRecursive(item);
        }
      }
    };

    countRecursive(filesObject);
    return count;
  }

  /**
   * 递归计算已解压文件总数（extractFiles()返回的数据）
   * @param {Object} extractedFiles - extractFiles()返回的嵌套对象
   * @returns {number} 总文件数量
   */
  countExtractedFiles(extractedFiles) {
    let count = 0;

    const countRecursive = (obj) => {
      for (const [, item] of Object.entries(obj)) {
        if (item instanceof File) {
          // 已解压的File对象
          count++;
        } else if (typeof item === "object" && item !== null) {
          // 目录，递归计算
          count++;
          countRecursive(item);
        }
      }
    };

    countRecursive(extractedFiles);
    return count;
  }

  // ===================================================================
  // 通用工具方法
  // ===================================================================

  /**
   * 通用文件下载方法（带进度监控）
   * @param {string} url - 文件URL
   * @param {Function} progressCallback - 进度回调函数
   * @param {number} progressStart - 进度起始值 (0-100)
   * @param {number} progressEnd - 进度结束值 (0-100)
   * @param {string} stage - 进度阶段描述
   * @returns {Promise<Blob>} 下载的文件Blob
   */
  async downloadFileWithProgress(url, progressCallback = null, progressStart = 0, progressEnd = 100, stage = "下载中") {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentLength = response.headers.get("content-length");
    const total = contentLength ? parseInt(contentLength, 10) : 0;
    let loaded = 0;

    const reader = response.body.getReader();
    const chunks = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      loaded += value.length;

      if (total > 0 && progressCallback) {
        const progress = progressStart + (loaded / total) * (progressEnd - progressStart);
        progressCallback(Math.min(progress, progressEnd), stage);
      }
    }

    return new Blob(chunks);
  }

  /**
   * 统一的文件内容获取接口
   * @param {Object} entryWrapper - 文件条目包装对象
   * @returns {Promise<ArrayBuffer>} 文件内容
   */
  async getFileContent(entryWrapper) {
    try {
      return await entryWrapper.getContent();
    } catch (error) {
      console.error("获取文件内容失败:", error);
      throw new Error(`获取文件内容失败: ${error.message}`);
    }
  }

  /**
   * 检查是否支持 WebAssembly
   * @returns {boolean} 是否支持
   */
  isWebAssemblySupported() {
    return typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function";
  }
}

// 导出单例实例
export const archiveService = new ArchiveService();
export default archiveService;
