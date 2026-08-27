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
  async loadService() {
    const res = await fetch(`${this.supabaseUrl}/rest/v1/rpc/shiptype_analytics_report`, {
      method: "POST",
      headers: {
        apikey: this.supabaseAnonKey,
        Authorization: `Bearer ${this.supabaseAnonKey}`,
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
};
