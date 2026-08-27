window.TASSI = {
  isPages: location.hostname.endsWith("github.io"),
  supabaseUrl: "https://lquvnkeykizuwcshmbaz.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxdXZua2V5a2l6dXdjc2htYmF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2MzkyODIsImV4cCI6MjEwMzIxNTI4Mn0.HpkFjG7u47vxGYjqugfTvv87CKrWQx8EbfVLDBqiBJ8",
  file(name, html) {
    if (!this.isPages) return html || name;
    return name;
  },
  api(name) {
    if (this.isPages) return new URL(`api/${name}.json`, document.baseURI).href;
    return `/api/${name}`;
  },
  sbHeaders() {
    return {
      apikey: this.supabaseAnonKey,
      Authorization: `Bearer ${this.supabaseAnonKey}`,
    };
  },
  async loadAppDoc(id) {
    const url = `${this.supabaseUrl}/rest/v1/app_documents?id=eq.${encodeURIComponent(id)}&select=payload`;
    const res = await fetch(url, { headers: this.sbHeaders() });
    if (!res.ok) throw new Error(`app_documents ${id} ${res.status}`);
    const rows = await res.json();
    return rows?.[0]?.payload ?? null;
  },
  async loadJson(id, fallbackUrl) {
    try {
      const payload = await this.loadAppDoc(id);
      if (payload) return payload;
    } catch {
      // 정적/로컬 API로 이어감
    }
    const res = await fetch(fallbackUrl);
    if (!res.ok) return null;
    return res.json();
  },
  async loadService() {
    const res = await fetch(`${this.supabaseUrl}/rest/v1/rpc/shiptype_analytics_report`, {
      method: "POST",
      headers: {
        ...this.sbHeaders(),
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `서비스 로그 ${res.status}`);
    }
    return res.json();
  },
  weeksIndex() {
    return this.isPages ? new URL("weeks/index.json", document.baseURI).href : "/api/weeks";
  },
  week(id) {
    return this.isPages ? new URL(`weeks/${id}.json`, document.baseURI).href : `/api/weeks/${id}`;
  },
  async loadWeeksIndex() {
    const payload = await this.loadJson("weeks", this.weeksIndex());
    return payload?.weeks ? payload : { weeks: payload?.weeks || [] };
  },
  async loadWeek(id) {
    return this.loadJson(`week-${id}`, this.week(id));
  },
  escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  },
  shortLandingPath(path) {
    const text = String(path ?? "");
    const q = text.indexOf("?");
    if (q < 0) return text;
    const amp = text.indexOf("&", q);
    if (amp < 0) return text;
    return `${text.slice(0, amp)}&...`;
  },
  landingPathHtml(path, empty) {
    const full = path == null || path === "" ? "" : String(path);
    if (!full) return empty || "—";
    const shown = this.escapeHtml(this.shortLandingPath(full));
    return `<span class="path-copy" data-copy="${encodeURIComponent(full)}" title="클릭하면 전체 경로 복사">${shown}</span>`;
  },
  toast(msg) {
    let el = document.getElementById("toast") || document.getElementById("tassi-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "tassi-toast";
      el.style.cssText =
        "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1b1f27;color:#fff;padding:10px 14px;border-radius:6px;font-size:14px;line-height:18px;z-index:50;opacity:0;transition:opacity .2s;pointer-events:none";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("on");
    el.style.opacity = "1";
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => {
      el.classList.remove("on");
      el.style.opacity = "0";
    }, 1800);
  },
};

if (!window.__tassiPathCopy) {
  window.__tassiPathCopy = true;
  const style = document.createElement("style");
  style.textContent =
    ".path-copy{cursor:pointer;word-break:break-word}.path-copy:hover{text-decoration:underline}";
  document.head.appendChild(style);
  document.addEventListener("click", async (ev) => {
    const el = ev.target.closest(".path-copy");
    if (!el) return;
    const text = decodeURIComponent(el.getAttribute("data-copy") || "");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      window.TASSI.toast("전체 경로를 복사했습니다.");
    } catch {
      window.TASSI.toast("복사에 실패했습니다.");
    }
  });
}
