import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const DEFAULT_PUB =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTa_yPuRFBStg8q3NK1IyA6Y6r_fT9uoJVggOpk3pVf0ti7ImbsYgUiuSvqLibwz2uWuEWSnFFAXXeB/pubhtml?widget=true&headers=false";
const DEFAULT_PDF =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTa_yPuRFBStg8q3NK1IyA6Y6r_fT9uoJVggOpk3pVf0ti7ImbsYgUiuSvqLibwz2uWuEWSnFFAXXeB/pub?output=pdf";
const REPORT_PAGES = [2, 3, 4];
const TTL_MS = 60_000;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

let cache: { at: number; data: WbsPublishPayload } | null = null;

export type WbsPublishSheet = {
  name: string;
  gid: string;
  css: string;
  table: string;
};

export type WbsReportPage = {
  page: number;
  url: string;
};

export type WbsPublishPayload = {
  source: "google-sheets";
  embedUrl: string;
  pdfUrl: string;
  sheets: WbsPublishSheet[];
  reportPages: WbsReportPage[];
  notes: string[];
};

function pubUrls() {
  const raw = (process.env.WBS_SHEETS_EMBED || DEFAULT_PUB).trim();
  const embedUrl = raw.includes("widget=") ? raw : `${raw.split("?")[0]}?widget=true&headers=false`;
  const base = embedUrl.split("?")[0].replace(/\/$/, "");
  const pdfUrl = (process.env.WBS_SHEETS_PDF || DEFAULT_PDF).trim();
  return { embedUrl, base, pdfUrl };
}

function pagesDir() {
  return resolve(root, "src/web/public/wbs-pages");
}

function existingReportPages(): WbsReportPage[] {
  return REPORT_PAGES.filter((page) => existsSync(resolve(pagesDir(), `${page}.png`))).map((page) => ({
    page,
    url: `wbs-pages/${page}.png`,
  }));
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

async function fetchSheets(): Promise<Pick<WbsPublishPayload, "embedUrl" | "sheets">> {
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
  return { embedUrl, sheets };
}

async function capturePdfPages(): Promise<WbsReportPage[]> {
  const { pdfUrl } = pubUrls();
  const res = await fetch(pdfUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 SEO-Report WBS",
      accept: "application/pdf,*/*",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`WBS PDF ${res.status}`);
  const pdf = Buffer.from(await res.arrayBuffer());
  if (pdf.subarray(0, 4).toString() !== "%PDF") throw new Error("내려받은 파일이 PDF가 아닙니다.");

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route("https://wbs.local/**", async (route) => {
      const url = route.request().url();
      if (url.endsWith("/sheet.pdf")) {
        await route.fulfill({ status: 200, contentType: "application/pdf", body: pdf });
        return;
      }
      await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>wbs</title>" });
    });
    await page.goto("https://wbs.local/render", { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ url: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js" });
    await page.waitForFunction(() => Boolean((window as { pdfjsLib?: unknown }).pdfjsLib));
    const rendered = await page.evaluate(async (pageNums: number[]) => {
      const lib = (window as unknown as { pdfjsLib: any }).pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      const buf = await fetch("https://wbs.local/sheet.pdf").then((r) => r.arrayBuffer());
      const doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
      const pages: { page: number; dataUrl: string }[] = [];
      for (const n of pageNums) {
        if (n < 1 || n > doc.numPages) continue;
        const pg = await doc.getPage(n);
        const viewport = pg.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        await pg.render({ canvasContext: ctx, viewport }).promise;
        pages.push({ page: n, dataUrl: canvas.toDataURL("image/png") });
      }
      return { pageCount: doc.numPages as number, pages };
    }, REPORT_PAGES);
    if (!rendered.pages.length) throw new Error(`PDF에 ${REPORT_PAGES.join(",")}페이지가 없습니다. (총 ${rendered.pageCount}쪽)`);
    const dir = pagesDir();
    mkdirSync(dir, { recursive: true });
    const docsDir = resolve(root, "docs/wbs-pages");
    mkdirSync(docsDir, { recursive: true });
    const out: WbsReportPage[] = [];
    for (const item of rendered.pages) {
      const buf = Buffer.from(item.dataUrl.split(",")[1], "base64");
      writeFileSync(resolve(dir, `${item.page}.png`), buf);
      writeFileSync(resolve(docsDir, `${item.page}.png`), buf);
      out.push({ page: item.page, url: `wbs-pages/${item.page}.png` });
    }
    return out;
  } finally {
    await browser.close();
  }
}

export async function loadPublishedWbs(force = false): Promise<WbsPublishPayload> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const { embedUrl, pdfUrl } = pubUrls();
  const notes: string[] = [];
  let reportPages = existingReportPages();
  if (force) {
    try {
      reportPages = await capturePdfPages();
    } catch (error) {
      notes.push(`보고서 PDF: ${error instanceof Error ? error.message : String(error)}`);
      reportPages = existingReportPages();
    }
  }
  if (!reportPages.length) notes.push("WBS PDF 2~4쪽 이미지가 없습니다. 이 주 저장을 한 번 해 주세요.");
  const data: WbsPublishPayload = {
    source: "google-sheets",
    embedUrl,
    pdfUrl,
    sheets: [],
    reportPages,
    notes,
  };
  cache = { at: Date.now(), data };
  return data;
}
