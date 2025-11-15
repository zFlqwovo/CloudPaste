/**
 * 离线状态提示工具
 */

let toastContainer = null;
let currentToast = null;

function createToastContainer() {
  if (toastContainer) return toastContainer;

  toastContainer = document.createElement("div");
  toastContainer.className = "offline-toast-container";
  toastContainer.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9999;
    pointer-events: none;
  `;
  document.body.appendChild(toastContainer);
  return toastContainer;
}

export function showOfflineToast(message = "当前页面暂时无法访问，请检查网络状态") {
  if (currentToast) {
    hideOfflineToast();
  }

  const container = createToastContainer();

  const toast = document.createElement("div");
  toast.className = "offline-toast";
  toast.style.cssText = `
    background: #f59e0b;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    font-size: 14px;
    font-weight: 500;
    max-width: 400px;
    text-align: center;
    pointer-events: auto;
    transform: translateY(-20px);
    opacity: 0;
    transition: all 0.3s ease-out;
    display: flex;
    align-items: center;
    gap: 8px;
  `;

  const icon = document.createElement("span");
  icon.innerHTML = "";
  icon.style.fontSize = "16px";

  const text = document.createElement("span");
  text.textContent = message;

  toast.appendChild(icon);
  toast.appendChild(text);
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.transform = "translateY(0)";
    toast.style.opacity = "1";
  });

  currentToast = toast;

  setTimeout(() => {
    hideOfflineToast();
  }, 3000);
}

export function hideOfflineToast() {
  if (!currentToast) return;

  currentToast.style.transform = "translateY(-20px)";
  currentToast.style.opacity = "0";

  setTimeout(() => {
    if (currentToast && currentToast.parentNode) {
      currentToast.parentNode.removeChild(currentToast);
    }
    currentToast = null;
  }, 300);
}

export function showPageUnavailableToast(pageName = "当前页面") {
  showOfflineToast(`${pageName}暂时无法访问，请检查网络状态`);
}

export function clearAllToasts() {
  hideOfflineToast();
  if (toastContainer && toastContainer.parentNode) {
    toastContainer.parentNode.removeChild(toastContainer);
    toastContainer = null;
  }
}

