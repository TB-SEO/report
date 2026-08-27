const DEFAULT_PUB =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTa_yPuRFBStg8q3NK1IyA6Y6r_fT9uoJVggOpk3pVf0ti7ImbsYgUiuSvqLibwz2uWuEWSnFFAXXeB/pubhtml?widget=true&headers=false";

const TTL_MS = 60_000;
let cache: { at: number; data: WbsPublishPayload } | null = null;

export type WbsPublishSheet = {
  name: string;
  gid: string;
  css: string;
  table: string;
};

export type WbsPublishPayload = {
  source: "google-sheets-pubhtml";
  embedUrl: string;
  sheets: WbsPublishSheet[];
};

function pubUrls() {
  const raw = (process.env.WBS_SHEETS_EMBED || DEFAULT_PUB).trim();
  const embedUrl = raw.includes("widget=") ? raw : `${raw.split("?")[0]}?widget=true&headers=false`;
  const base = embedUrl.split("?")[0].replace(/\/$/, "");
  return { embedUrl, base };
}

async function googleGet(url: string) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 SEO-Report WBS",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`시트 게시본 ${res.status}: ${url}`);
  return res.text();
}

function sheetIndex(html: string) {
  const found: { name: string; gid: string }[] = [];
  const re = /items\.push\(\{name:\s*"((?:\\.|[^"\\])*)",\s*pageUrl:\s*"[^"]+",\s*gid:\s*"(-?\d+)"/g;
  for (const m of html.matchAll(re)) {
    const name = JSON.parse(`"${m[1]}"`) as string;
    if (!name || name === "-") continue;
    found.push({ name, gid: m[2] });
  }
  const order = ["WBS", "Content", "유지보수"];
  found.sort((a, b) => {
    const ai = order.indexOf(a.name);
    const bi = order.indexOf(b.name);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  return found;
}

function waffleCss(html: string, scope: string) {
  const blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  const css = blocks.filter((s) => s.includes(".waffle")).join("\n");
  return css.replaceAll(".ritz", scope);
}

function waffleTable(html: string) {
  const m = html.match(/<table\b[^>]*class="waffle[\s\S]*?<\/table>/i);
  if (!m) throw new Error("게시본에서 표를 찾지 못했습니다.");
  return m[0]
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "");
}

async function fetchSheets(): Promise<WbsPublishPayload> {
  const { embedUrl, base } = pubUrls();
  const indexHtml = await googleGet(`${base}?headers=false`);
  const tabs = sheetIndex(indexHtml);
  if (!tabs.length) throw new Error("게시된 시트를 찾지 못했습니다. 웹페이지로 게시했는지 확인하세요.");
  const sheets: WbsPublishSheet[] = [];
  for (const [i, tab] of tabs.entries()) {
    const html = await googleGet(`${base}/sheet?headers=false&gid=${tab.gid}`);
    const scope = `.wbs-g${i}`;
    sheets.push({
      name: tab.name,
      gid: tab.gid,
      css: waffleCss(html, scope),
      table: waffleTable(html),
    });
  }
  return { source: "google-sheets-pubhtml", embedUrl, sheets };
}

export async function loadPublishedWbs(force = false): Promise<WbsPublishPayload> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const data = await fetchSheets();
  cache = { at: Date.now(), data };
  return data;
}
