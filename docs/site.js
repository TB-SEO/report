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
};
