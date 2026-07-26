/** Production 3B.2 - Toast Service */
const CONTAINER_ID = "v3ToastContainer";

function getContainer() {
  let container = document.getElementById(CONTAINER_ID);
  if (container) return container;

  container = document.createElement("div");
  container.id = CONTAINER_ID;
  container.className = "toast-container";
  container.setAttribute("aria-live", "polite");
  container.setAttribute("aria-atomic", "true");
  document.body.appendChild(container);
  return container;
}

function show(message, type = "info", duration = 3200) {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.innerHTML = `
    <span class="toast-dot" aria-hidden="true"></span>
    <span class="toast-message"></span>
    <button class="toast-close" type="button" aria-label="Đóng thông báo">×</button>
  `;
  toast.querySelector(".toast-message").textContent = String(message || "");

  const remove = () => {
    toast.classList.add("toast-leaving");
    window.setTimeout(() => toast.remove(), 180);
  };

  toast.querySelector(".toast-close").addEventListener("click", remove);
  getContainer().appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("toast-visible"));
  window.setTimeout(remove, Math.max(1200, Number(duration) || 3200));
}

export const ToastService = Object.freeze({
  info(message, duration) { show(message, "info", duration); },
  success(message, duration) { show(message, "success", duration); },
  warning(message, duration) { show(message, "warning", duration); },
  error(message, duration) { show(message, "error", duration); }
});
