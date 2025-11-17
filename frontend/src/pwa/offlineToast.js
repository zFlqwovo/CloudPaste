export function showOfflineToast(message = "当前页面暂时无法访问，请检查网络状态") {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;

  window.dispatchEvent(
    new CustomEvent("global-message", {
      detail: {
        type: "warning",
        content: message,
      },
    })
  );
}

export function hideOfflineToast() {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;

  window.dispatchEvent(new CustomEvent("global-message-clear"));
}

export function showPageUnavailableToast(pageName = "当前页面") {
  showOfflineToast(`${pageName}暂时无法访问，请检查网络状态`);
}

export function clearAllToasts() {
  hideOfflineToast();
}
