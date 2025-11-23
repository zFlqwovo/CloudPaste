/**
 * useUppyBackendProgress - 基于後端進度的 Uppy 進度修正 Composable
 *
 * 封裝以下通用能力：
 * - 為每個 Uppy 文件生成並維護 upload_id（寫入 file.meta.upload_id）
 * - 跨前端/後端融合進度：結合瀏覽器上報與 /api/upload/progress 返回值
 * - 直接更新 Uppy 文件狀態，驅動 Dashboard 進度條刷新
 *
 * 調用方需要提供：
 * - uppy: Ref<Uppy | null>
 * - isDirectMode: () => boolean，用於判斷當前是否啟用直傳模式
 */
import { getUploadProgress } from "@/api/services/systemService.js";

export function useUppyBackendProgress(options) {
  const { uppy, isDirectMode } = options;

  // 後端進度狀態與輪詢定時器
  const backendProgressState = new Map();
  const backendProgressTimers = new Map();

  const generateUploadId = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  };

  /**
   * 確保文件擁有 upload_id，並回傳最終的 upload_id
   */
  const ensureUploadIdForFile = (file) => {
    if (!uppy?.value || !file?.id) return null;
    const meta = file.meta || {};
    if (meta.upload_id) {
      return meta.upload_id;
    }
    const uploadId = generateUploadId();
    try {
      uppy.value.setFileMeta(file.id, {
        ...meta,
        upload_id: uploadId,
      });
    } catch (error) {
      console.warn("[useUppyBackendProgress] 設置 upload_id 失敗", error);
    }
    return uploadId;
  };

  /**
   * 重置後端進度相關狀態
   */
  const resetBackendProgressTracking = () => {
    backendProgressTimers.forEach((timer) => clearInterval(timer));
    backendProgressTimers.clear();
    backendProgressState.clear();
  };

  /**
   * 更新瀏覽器本地的進度快照，用於與後端進度融合
   */
  const updateBrowserProgressState = ({ file, fileId, bytesUploaded, bytesTotal }) => {
    if (!fileId) return;
    const id = fileId;
    const prev = backendProgressState.get(id) || {};
    const next = {
      ...prev,
      file: file || prev.file,
      browserBytesUploaded:
        typeof bytesUploaded === "number" ? bytesUploaded : prev.browserBytesUploaded || 0,
      browserBytesTotal:
        typeof bytesTotal === "number" ? bytesTotal : prev.browserBytesTotal || file?.size || 0,
      remoteBytesLoaded: prev.remoteBytesLoaded || 0,
      remoteBytesTotal: prev.remoteBytesTotal || 0,
      currentBytes: prev.currentBytes || 0,
    };

    if (next.browserBytesUploaded > (next.currentBytes || 0)) {
      next.currentBytes = next.browserBytesUploaded;
    }

    backendProgressState.set(id, next);
  };

  /**
   * 啟動後端進度輪詢並修正 Uppy 進度
   * 僅在 isDirectMode() 為 true 時工作
   */
  const startBackendProgressPolling = () => {
    if (!uppy?.value || !isDirectMode?.()) return;

    const files = uppy.value.getFiles();
    files.forEach((file) => {
      const fileId = file.id;
      if (!fileId || backendProgressTimers.has(fileId)) return;

      const uploadId = file.meta?.upload_id || ensureUploadIdForFile(file);
      if (!uploadId) return;

      const poll = async () => {
        try {
          const resp = await getUploadProgress(uploadId);
          const payload = resp?.data;
          if (!payload) return;

          const totalFromServer = typeof payload.total === "number" ? payload.total : null;
          const loadedFromServer = typeof payload.loaded === "number" ? payload.loaded : 0;
          const completed = !!payload.completed;

          const prev = backendProgressState.get(fileId) || {};
          const bytesTotal = totalFromServer || prev.browserBytesTotal || file.size || 0;
          if (!bytesTotal) {
            backendProgressState.set(fileId, {
              ...prev,
              file,
              remoteBytesLoaded: loadedFromServer,
              remoteBytesTotal: totalFromServer || prev.remoteBytesTotal || 0,
            });
            return;
          }

          const bytesUploaded = Math.max(0, Math.min(bytesTotal, loadedFromServer));
          const percentage = bytesTotal > 0 ? Math.round((bytesUploaded / bytesTotal) * 100) : 0;

          try {
            uppy.value.setFileState(file.id, {
              progress: {
                ...(file.progress || {}),
                bytesUploaded,
                bytesTotal,
                percentage,
                uploadComplete: file.progress?.uploadComplete || completed,
                uploadStarted: file.progress?.uploadStarted || Date.now(),
              },
            });
            uppy.value.emit("upload-progress", file, { bytesUploaded, bytesTotal });
          } catch (error) {
            console.warn("[useUppyBackendProgress] 注入後端上傳進度失敗", error);
          }

          backendProgressState.set(fileId, {
            ...prev,
            file,
            remoteBytesLoaded: loadedFromServer,
            remoteBytesTotal: totalFromServer || prev.remoteBytesTotal || bytesTotal,
            browserBytesTotal: bytesTotal,
            browserBytesUploaded: prev.browserBytesUploaded || 0,
            currentBytes: bytesUploaded,
          });

          if (completed || (bytesTotal && loadedFromServer >= bytesTotal)) {
            const timer = backendProgressTimers.get(fileId);
            if (timer) clearInterval(timer);
            backendProgressTimers.delete(fileId);
          }
        } catch (error) {
          console.warn("[useUppyBackendProgress] 查詢後端上傳進度失敗", error);
        }
      };

      const timer = setInterval(poll, 1000);
      backendProgressTimers.set(fileId, timer);
      poll();
    });
  };

  return {
    ensureUploadIdForFile,
    resetBackendProgressTracking,
    updateBrowserProgressState,
    startBackendProgressPolling,
  };
}
