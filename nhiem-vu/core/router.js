/** Production 3B.2 - Hash Router cho GitHub Pages. */
export class Router {
  constructor({ outlet, routes, defaultRoute = "#/dashboard" }) {
    if (!(outlet instanceof HTMLElement)) throw new Error("Router cần một outlet hợp lệ.");
    this.outlet = outlet;
    this.routes = Object.freeze({ ...(routes || {}) });
    this.defaultRoute = defaultRoute;
    this.started = false;
    this.boundResolve = this.resolve.bind(this);
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
  }

  normalizeRoute(hash) {
    const value = String(hash || "").trim();
    return value.startsWith("#/") ? value : this.defaultRoute;
  }

  async resolve() {
    const route = this.normalizeRoute(window.location.hash);
    const handler = this.routes[route] || this.routes[this.defaultRoute];
    this.markActiveNavigation(route);

    if (typeof handler !== "function") {
      this.outlet.innerHTML = `<section class="page-card error-card"><h2>Không tìm thấy màn hình</h2><p>Đường dẫn <code>${escapeHtml(route)}</code> chưa được khai báo.</p></section>`;
      return;
    }

    try {
      this.outlet.setAttribute("aria-busy", "true");
      this.outlet.innerHTML = renderLoadingState();
      await handler(this.outlet, { route, router: this });
      window.scrollTo({ top: 0, behavior: "smooth" });
      document.dispatchEvent(new CustomEvent("v3:route-changed", { detail: { route } }));
    } catch (error) {
      console.error("Router render error:", error);
      this.outlet.innerHTML = `<section class="page-card error-card"><h2>Không thể hiển thị màn hình</h2><p>${escapeHtml(error?.message || "Lỗi không xác định.")}</p></section>`;
    } finally {
      this.outlet.removeAttribute("aria-busy");
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
