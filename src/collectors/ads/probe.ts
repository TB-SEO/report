import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import type { Page, Response } from "playwright";
import { ensureDir, openAdsChrome, pageOn, releaseChrome, root, waitUntil } from "./chrome.js";

loadEnv();

const NAVER_CAMPAIGNS =
  process.env.NAVER_ADS_CAMPAIGNS_URL?.trim() ||
  "https://ads.naver.com/manage/ad-accounts/1808636/sa/campaigns-by/WEB_SITE";
const GOOGLE_KEYWORDS =
  process.env.GOOGLE_ADS_KEYWORDS_URL?.trim() ||
  "https://ads.google.com/aw/keywords?ocid=318165752&workspaceId=0";

type Hit = {
  method: string;
  url: string;
  status: number;
  post?: string;
  body?: unknown;
};

async function bodyOf(response: Response): Promise<unknown | null> {
  const type = response.headers()["content-type"] ?? "";
  const url = response.url();
  if (/\.(css|woff2?|png|jpe?g|gif|svg|ico|mp4|js)(\?|$)/i.test(url) && !/json|graphql|api/i.test(url)) return null;
  try {
    if (/json|javascript|graphql|text\/plain/i.test(type) || /json|graphql|api/i.test(url)) {
      const text = await response.text();
      if (!text) return null;
      try {
        const json = JSON.parse(text);
        const s = JSON.stringify(json);
        if (s.length > 20_000) return { _truncated: true, preview: s.slice(0, 8000), bytes: s.length };
        return json;
      } catch {
        return text.slice(0, 1500);
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function listen(page: Page, match: RegExp, waitMs: number) {
  const hits: Hit[] = [];
  const onResponse = async (response: Response) => {
    const url = response.url();
    if (!match.test(url)) return;
    if (/\.(css|woff2?|png|jpe?g|gif|svg|ico|mp4)(\?|$)/i.test(url)) return;
    const post = response.request().postData()?.slice(0, 2500);
    const body = await bodyOf(response);
    if (body == null && !post && !/api|graphql|stats|keyword|campaign|adgroup/i.test(url)) return;
    hits.push({
      method: response.request().method(),
      url,
      status: response.status(),
      post,
      body: body ?? undefined,
    });
  };
  page.on("response", onResponse);
  await page.waitForTimeout(waitMs);
  page.off("response", onResponse);
  return hits;
}

async function grid(page: Page) {
  return page
    .evaluate(() => {
      const rows: string[][] = [];
      const push = (cells: string[]) => {
        if (cells.some((c) => c)) rows.push(cells);
      };
      for (const table of [...document.querySelectorAll("table")].slice(0, 6)) {
        for (const tr of [...table.querySelectorAll("tr")].slice(0, 40)) {
          push([...tr.querySelectorAll("th,td")].map((c) => (c.textContent || "").replace(/\s+/g, " ").trim()));
        }
      }
      for (const row of [...document.querySelectorAll("[role=row]")].slice(0, 40)) {
        push([...row.querySelectorAll("[role=columnheader],[role=gridcell],th,td")].map((c) => (c.textContent || "").replace(/\s+/g, " ").trim()));
      }
      const links = [...document.querySelectorAll("a[href]")]
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((href) => /campaigns\/cmp-|adgroups\/grp-|\/keywords/i.test(href))
        .slice(0, 40);
      return { url: location.href, title: document.title, rows, links };
    })
    .catch(() => ({ url: page.url(), title: "", rows: [] as string[][], links: [] as string[] }));
}

async function main() {
  const dir = resolve(root, "data/probe");
  ensureDir(dir);
  const context = await openAdsChrome();

  const naverPage = await pageOn(context, /ads\.naver\.com/i, NAVER_CAMPAIGNS);
  await waitUntil(
    naverPage,
    async () => /ads\.naver\.com\/manage/i.test(naverPage.url()) && !/login|nid\.naver/i.test(naverPage.url()),
    "네이버 광고주센터 로그인을 마쳐 주세요.",
    180_000,
  );
  if (!/campaigns-by/i.test(naverPage.url())) {
    await naverPage.goto(NAVER_CAMPAIGNS, { waitUntil: "domcontentloaded", timeout: 60_000 });
  }
  const naverHits = await listen(naverPage, /ads\.naver\.com|searchad|naver\.com\/api/i, 8_000);
  const naverDom = await grid(naverPage);
  writeFileSync(
    resolve(dir, "naver-ads.json"),
    JSON.stringify({ pageUrl: naverPage.url(), hits: naverHits, dom: naverDom }, null, 2),
    "utf8",
  );
  console.log(`네이버 hits ${naverHits.length}`);
  for (const hit of naverHits.slice(0, 40)) console.log(`  ${hit.status} ${hit.method} ${hit.url.slice(0, 160)}`);
  for (const href of naverDom.links.slice(0, 15)) console.log(`  link ${href}`);

  const googlePage = await pageOn(context, /ads\.google\.com/i, GOOGLE_KEYWORDS);
  await waitUntil(
    googlePage,
    async () => /ads\.google\.com\/aw/i.test(googlePage.url()) && !/accounts\.google\.com|signin/i.test(googlePage.url()),
    "Google Ads 로그인을 마쳐 주세요.",
    180_000,
  );
  if (!/\/aw\/keywords/i.test(googlePage.url())) {
    await googlePage.goto(GOOGLE_KEYWORDS, { waitUntil: "domcontentloaded", timeout: 60_000 });
  }
  const googleHits = await listen(googlePage, /ads\.google\.com|googleads|googleapis|doubleclick/i, 12_000);
  const googleDom = await grid(googlePage);
  writeFileSync(
    resolve(dir, "google-ads.json"),
    JSON.stringify({ pageUrl: googlePage.url(), hits: googleHits, dom: googleDom }, null, 2),
    "utf8",
  );
  console.log(`구글 hits ${googleHits.length}`);
  for (const hit of googleHits.slice(0, 40)) console.log(`  ${hit.status} ${hit.method} ${hit.url.slice(0, 160)}`);

  await releaseChrome(context);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
