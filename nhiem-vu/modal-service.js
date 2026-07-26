/** Production 3B.2 - Modal Service */
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function open({ title = "Thông báo", message = "", confirmText = "Đồng ý", cancelText = "Đóng", danger = false, showCancel = true } = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <div class="modal-header">
          <div>
            <span class="page-eyebrow">PRODUCTION 3B.2</span>
            <h2 id="modalTitle">${escapeHtml(title)}</h2>
          </div>
          <button class="modal-x" type="button" aria-label="Đóng">×</button>
        </div>
        <div class="modal-body"><p>${escapeHtml(message)}</p></div>
        <div class="modal-actions">
          ${showCancel ? `<button class="secondary-button modal-cancel" type="button">${escapeHtml(cancelText)}</button>` : ""}
          <button class="primary-button modal-confirm ${danger ? "danger-button" : ""}" type="button">${escapeHtml(confirmText)}</button>
        </div>
      </section>
    `;

    const finish = value => {
      document.removeEventListener("keydown", onKeyDown);
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
    requestAnimationFrame(() => {
      overlay.classList.add("modal-visible");
      overlay.querySelector(".modal-confirm")?.focus();
    });
  });
}

export const ModalService = Object.freeze({ open });
