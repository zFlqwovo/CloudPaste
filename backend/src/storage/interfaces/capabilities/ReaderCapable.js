/**
 * 读取能力模块
 *
 * 定义存储驱动的读取操作能力检测
 * 支持此能力的驱动可以进行文件和目录的读取操作
 *
 * ========== 契约要求 ==========
 * 驱动必须实现以下方法才能通过 isReaderCapable() 检测：
 *
 * - listDirectory(path, options): Promise<Object>
 *   列出目录内容，返回 { path, type, isRoot, isVirtual, items: Array<FileInfo> }
 *
 * - downloadFile(path, options): Promise<Response>
 *   下载文件，返回 Response 对象（带 body 流和适当的 headers）
 *
 * - getFileInfo(path, options): Promise<Object>
 *   获取文件信息，返回 { path, name, isDirectory, size, modified, mimetype?, type, typeName }
 */

/**
 * 检查对象是否实现了 Reader 能力
 * @param {Object} obj - 要检查的对象
 * @returns {boolean} 是否具备读取能力
 */
export function isReaderCapable(obj) {
  return (
    obj &&
    typeof obj.listDirectory === "function" &&
    typeof obj.downloadFile === "function" &&
    typeof obj.getFileInfo === "function"
  );
}

/**
 * Reader 能力的标识符
 */
export const READER_CAPABILITY = "ReaderCapable";
