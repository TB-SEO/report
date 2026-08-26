window.TASSI = {
  isPages: location.hostname.endsWith("github.io"),
  file(name, html) {
    if (!this.isPages) return html || name;
    return name;
  },
  api(name) {
    if (this.isPages) return new URL(`api/${name}.json`, document.baseURI).href;
    return `/api/${name}`;
  },
  weeksIndex() {
    return this.isPages ? new URL("weeks/index.json", document.baseURI).href : "/api/weeks";
  },
  week(id) {
    return this.isPages ? new URL(`weeks/${id}.json`, document.baseURI).href : `/api/weeks/${id}`;
  },
};
