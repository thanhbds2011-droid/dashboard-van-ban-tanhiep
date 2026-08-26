/** Hộp thoại nội bộ ứng dụng - V1.18.1. */
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function open({
  title = "Thông báo",
  message = "",
  messageHtml = "",
  confirmText = "Đồng ý",
  cancelText = "Đóng",
  danger = false,
  showCancel = true,
  eyebrow = "THÔNG BÁO"
} = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <div class="modal-header">
          <div>
            <span class="page-eyebrow">${escapeHtml(eyebrow)}</span>
            <h2 id="modalTitle">${escapeHtml(title)}</h2>
          </div>
          <button class="modal-x" type="button" aria-label="Đóng">×</button>
        </div>
        <div class="modal-body">${messageHtml ? messageHtml : `<p>${escapeHtml(message)}</p>`}</div>
        <div class="modal-actions">
          ${showCancel ? `<button class="secondary-button modal-cancel" type="button">${escapeHtml(cancelText)}</button>` : ""}
          <button class="primary-button modal-confirm ${danger ? "danger-button" : ""}" type="button">${escapeHtml(confirmText)}</button>
        </div>
      </section>
    `;

    const finish = value => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("modal-open");
      overlay.classList.remove("modal-visible");
      window.setTimeout(() => overlay.remove(), 160);
      resolve(value);
    };
    const onKeyDown = event => {
      if (event.key === "Escape") finish(false);
    };

    overlay.querySelector(".modal-x").addEventListener("click", () => finish(false));
    overlay.querySelector(".modal-cancel")?.addEventListener("click", () => finish(false));
    overlay.querySelector(".modal-confirm").addEventListener("click", () => finish(true));
    overlay.addEventListener("click", event => {
      if (event.target === overlay) finish(false);
    });
    document.addEventListener("keydown", onKeyDown);
    document.body.appendChild(overlay);
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => {
      overlay.classList.add("modal-visible");
      overlay.querySelector(".modal-confirm")?.focus();
    });
  });
}

function alert(message, options = {}) {
  return open({
    title: options.title || "Thông báo",
    message,
    messageHtml: options.messageHtml || "",
    confirmText: options.confirmText || "Đóng",
    showCancel: false,
    danger: options.danger === true,
    eyebrow: options.eyebrow || "THÔNG BÁO"
  });
}

function confirm(message, options = {}) {
  return open({
    title: options.title || "Xác nhận thao tác",
    message,
    messageHtml: options.messageHtml || "",
    confirmText: options.confirmText || "Xác nhận",
    cancelText: options.cancelText || "Hủy",
    danger: options.danger === true,
    showCancel: true,
    eyebrow: options.eyebrow || "XÁC NHẬN"
  });
}

function prompt(message, options = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const multiline = options.multiline !== false;
    const fieldHtml = multiline
      ? `<textarea class="app-dialog-input" rows="${Number(options.rows || 4)}" maxlength="${Number(options.maxLength || 3000)}" placeholder="${escapeHtml(options.placeholder || "")}">${escapeHtml(options.defaultValue || "")}</textarea>`
      : `<input class="app-dialog-input" type="${escapeHtml(options.inputType || "text")}" maxlength="${Number(options.maxLength || 500)}" value="${escapeHtml(options.defaultValue || "")}" placeholder="${escapeHtml(options.placeholder || "")}">`;
    overlay.innerHTML = `
      <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modalPromptTitle">
        <div class="modal-header">
          <div>
            <span class="page-eyebrow">${escapeHtml(options.eyebrow || "NHẬP THÔNG TIN")}</span>
            <h2 id="modalPromptTitle">${escapeHtml(options.title || "Nhập nội dung")}</h2>
          </div>
          <button class="modal-x" type="button" aria-label="Đóng">×</button>
        </div>
        <div class="modal-body">
          ${message ? `<p>${escapeHtml(message)}</p>` : ""}
          <label class="app-dialog-field"><span>${escapeHtml(options.label || "Nội dung")}</span>${fieldHtml}</label>
          <div class="app-dialog-error" hidden></div>
        </div>
        <div class="modal-actions">
          <button class="secondary-button modal-cancel" type="button">${escapeHtml(options.cancelText || "Hủy")}</button>
          <button class="primary-button modal-confirm ${options.danger ? "danger-button" : ""}" type="button">${escapeHtml(options.confirmText || "Xác nhận")}</button>
        </div>
      </section>
    `;

    const input = overlay.querySelector(".app-dialog-input");
    const errorBox = overlay.querySelector(".app-dialog-error");
    const finish = value => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("modal-open");
      overlay.classList.remove("modal-visible");
      window.setTimeout(() => overlay.remove(), 160);
      resolve(value);
    };
    const submit = () => {
      const value = String(input?.value ?? "");
      if (options.required === true && !value.trim()) {
        errorBox.hidden = false;
        errorBox.textContent = options.requiredMessage || "Vui lòng nhập nội dung trước khi tiếp tục.";
        input?.focus();
        return;
      }
      finish(value);
    };
    const onKeyDown = event => {
      if (event.key === "Escape") finish(null);
      if (!multiline && event.key === "Enter") { event.preventDefault(); submit(); }
      if (multiline && event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit(); }
    };

    overlay.querySelector(".modal-x").addEventListener("click", () => finish(null));
    overlay.querySelector(".modal-cancel").addEventListener("click", () => finish(null));
    overlay.querySelector(".modal-confirm").addEventListener("click", submit);
    overlay.addEventListener("click", event => { if (event.target === overlay) finish(null); });
    document.addEventListener("keydown", onKeyDown);
    document.body.appendChild(overlay);
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => {
      overlay.classList.add("modal-visible");
      input?.focus();
      input?.setSelectionRange?.(input.value.length, input.value.length);
    });
  });
}

export const ModalService = Object.freeze({ open, alert, confirm, prompt });
