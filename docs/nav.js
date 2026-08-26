(() => {
  const pages = location.hostname.endsWith("github.io");
  const file = (location.pathname.split("/").pop() || "index.html") || "index.html";
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const items = [
    { href: pages ? "index.html" : "/", label: "홈", on: pages ? file === "index.html" || file === "" : path === "/" },
    { href: pages ? "blog.html" : "/blog", label: "블로그", on: pages ? file === "blog.html" : path === "/blog" },
    { href: pages ? "ads.html" : "/keyword", label: "키워드", on: pages ? file === "ads.html" : path === "/keyword" || path === "/ads" },
    { href: pages ? "service.html" : "/service", label: "서비스", on: pages ? file === "service.html" : path === "/service" },
    { href: pages ? "wbs.html" : "/wbs", label: "WBS", on: pages ? file === "wbs.html" : path === "/wbs" },
  ];
  const nav = items
    .map((item) => `<a href="${item.href}" class="${item.on ? "on" : ""}">${item.label}</a>`)
    .join("");
  const header = document.createElement("header");
  header.className = "site-header" + (items.find((item) => item.label === "WBS")?.on ? " wide" : "");
  header.innerHTML = `<div class="site-header-inner"><a class="site-brand" href="${pages ? "index.html" : "/"}">T-ASSI</a><nav class="site-nav">${nav}</nav></div>`;
  document.body.prepend(header);
})();
