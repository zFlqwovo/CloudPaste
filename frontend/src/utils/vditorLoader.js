/**
 * Vditor 资源懒加载工具
 *
 * 统一管理：
 * - /assets/vditor/dist/index.css
 * - /assets/vditor/dist/index.min.js
 *
 * 特性：
 * - 单例加载，避免重复插入 <script>/<link>
 * - 并发安全，使用 vditorLoading 作为状态锁
 * - 简单的重试机制，确保 window.Vditor 可用
 */

let VditorClass = null;
let vditorCSSLoaded = false;
let vditorLoading = false;

const VDITOR_SCRIPT_SRC = "/assets/vditor/dist/index.min.js";
const VDITOR_CSS_HREF = "/assets/vditor/dist/index.css";

/**
 * 加载 Vditor CSS（幂等）
 */
export const loadVditorCSS = async () => {
  if (vditorCSSLoaded) return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = VDITOR_CSS_HREF;
  document.head.appendChild(link);

  vditorCSSLoaded = true;
};

/**
 * 懒加载 Vditor JS 单例
 * - 返回 window.Vditor 构造函数（既可用于 new Vditor，也可用于 Vditor.preview）
 */
export const loadVditor = async () => {
  // 如果已经在加载中，等待完成
  if (vditorLoading) {
    while (vditorLoading) {
      // 简单轮询等待，避免多次并发初始化
      // 间隔 30ms 足够平衡响应和开销
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    return VditorClass;
  }

  // 已有实例，直接返回（仍在调用方做 API 存在性检查）
  if (VditorClass) {
    return VditorClass;
  }

  vditorLoading = true;

  try {
    await loadVditorCSS();

    const script = document.createElement("script");
    script.src = VDITOR_SCRIPT_SRC;

    await new Promise((resolve, reject) => {
      script.onload = () => {
        let retryCount = 0;
        const maxRetries = 3;
        const checkInterval = 30;

        const checkReady = () => {
          if (window.Vditor) {
            VditorClass = window.Vditor;
            resolve(VditorClass);
            return;
          }

          retryCount += 1;
          if (retryCount >= maxRetries) {
            reject(new Error("Vditor API 不可用"));
            return;
          }

          setTimeout(checkReady, checkInterval);
        };

        checkReady();
      };

      script.onerror = () => {
        reject(new Error("Vditor 脚本加载失败"));
      };

      document.head.appendChild(script);
    });
  } finally {
    vditorLoading = false;
  }

  return VditorClass;
};

