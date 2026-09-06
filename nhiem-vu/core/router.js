/** Production 3B.2 - Hash Router cho GitHub Pages. */
export class Router {
  constructor({ outlet, routes, defaultRoute = "#/dashboard" }) {
    if (!(outlet instanceof HTMLElement)) throw new Error("Router cần một outlet hợp lệ.");
    this.outlet = outlet;
    this.routes = Object.freeze({ ...(routes || {}) });
    this.defaultRoute = defaultRoute;
    this.started = false;
    this.boundResolve = this.resolve.bind(this);
    this.resolveSequence = 0;
  }

  start() {
    if (this.started) return;
    this.started = true;
    window.addEventListener("hashchange", this.boundResolve);
    if (!window.location.hash) window.history.replaceState(null, "", this.defaultRoute);
    void this.resolve();
  }

  stop() {
    if (!this.started) return;
    window.removeEventListener("hashchange", this.boundResolve);
    this.started = false;
    // Hủy hiệu lực mọi render async đang chạy để logout/chuyển tài khoản không ghi UI sau khi teardown.
    this.resolveSequence += 1;
    this.outlet.removeAttribute("aria-busy");
  }

  normalizeRoute(hash) {
    const value = String(hash || "").trim();
    return value.startsWith("#/") ? value : this.defaultRoute;
  }

  async resolve() {
    const sequence = ++this.resolveSequence;
    const route = this.normalizeRoute(window.location.hash);
    const handler = this.routes[route] || this.routes[this.defaultRoute];
    this.markActiveNavigation(route);

    if (typeof handler !== "function") {
      this.outlet.innerHTML = `<section class="page-card error-card"><h2>Không tìm thấy màn hình</h2><p>Đường dẫn <code>${escapeHtml(route)}</code> chưa được khai báo.</p></section>`;
      return;
    }

    // V1.23.0: mỗi lần resolve có một host riêng đang gắn vào DOM.
    // Khi route mới bắt đầu, host cũ bị tháo khỏi DOM ngay. Handler cũ vẫn có thể
    // hoàn tất Promise nhưng chỉ ghi vào host đã detached, không thể ghi đè route mới.
    const routeHost = document.createElement("div");
    routeHost.className = "route-render-host";
    routeHost.dataset.routeSequence = String(sequence);
    routeHost.innerHTML = renderLoadingState();
    this.outlet.replaceChildren(routeHost);

    try {
      this.outlet.setAttribute("aria-busy", "true");
      await handler(routeHost, { route, router: this, sequence });
      if (sequence !== this.resolveSequence || !routeHost.isConnected) return;
      window.scrollTo({ top: 0, behavior: "smooth" });
      document.dispatchEvent(new CustomEvent("v3:route-changed", { detail: { route } }));
    } catch (error) {
      if (sequence !== this.resolveSequence || !routeHost.isConnected) return;
      if (String(error?.code || "") === "USER_CONTEXT_MISSING") {
        console.warn("Router tạm dừng vì ngữ cảnh phiên chưa đồng bộ:", error);
        routeHost.innerHTML = `<section class="page-card"><h2>Đang đồng bộ phiên đăng nhập…</h2><p>Ứng dụng đang xác nhận tài khoản hiện tại. Màn hình sẽ tự tải lại nếu cần.</p></section>`;
        if (error?.transient !== true) {
          try {
            window.dispatchEvent(new CustomEvent("app:session-recovery-needed", {
              detail: { reason: "ROUTER_USER_CONTEXT_MISSING", at: Date.now() }
            }));
          } catch (_) { /* no-op */ }
        }
        return;
      }
      console.error("Router render error:", error);
      routeHost.innerHTML = `<section class="page-card error-card"><h2>Không thể hiển thị màn hình</h2><p>${escapeHtml(error?.message || "Lỗi không xác định.")}</p></section>`;
    } finally {
      if (sequence === this.resolveSequence) this.outlet.removeAttribute("aria-busy");
    }
  }

  navigate(route) {
    const normalized = this.normalizeRoute(route);
    if (window.location.hash === normalized) return void this.resolve();
    window.location.hash = normalized;
  }

  markActiveNavigation(route) {
    document.querySelectorAll("[data-route]").forEach(link => {
      const active = link.getAttribute("data-route") === route;
      link.classList.toggle("active", active);
      link.setAttribute("aria-current", active ? "page" : "false");
    });
  }
}

function renderLoadingState() {
  return `<section class="page-card"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-line"></div><div class="skeleton-grid">${"<div class=\"skeleton skeleton-card\"></div>".repeat(4)}</div></section>`;
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
