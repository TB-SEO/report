import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import type { Locator, Page, Response } from "playwright";
import { pageOn, releaseChrome, waitUntil } from "../shared/chrome.js";
import { openPersistentChrome } from "./chrome.js";
import { blogTargets } from "../shared/targets.js";
import { ensureDir, loadConfig, withBlog, type AppConfig } from "./config.js";
import { parseTistoryNetwork, addKstDays, toKstDate } from "./parse-api.js";
import type { CaptureFile } from "./types.js";
import { applyPostDays, type ListedPost, type PostDayStat } from "../shared/post-days.js";
import { crawlRange, eachDay, keepDate } from "../shared/crawl-range.js";

loadEnv();

async function safeJson(response: Response): Promise<unknown | null> {
  const type = response.headers()["content-type"] ?? "";
  if (!type.includes("json")) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function blogIdFromUrl(url: string): string | undefined {
  const match = url.match(/https?:\/\/([a-z0-9-]+)\.tistory\.com/i);
  const id = match?.[1];
  if (!id || id === "www") return undefined;
  return id;
}

async function clickFirst(page: Page, locators: Locator[]): Promise<boolean> {
  for (const locator of locators) {
    try {
      const target = locator.first();
      if (await target.count()) {
        await target.click({ timeout: 2500 });
        return true;
      }
    } catch {
      // 다음 후보
    }
  }
  return false;
}

async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (/auth\/login|accounts\.kakao\.com/.test(url)) return false;
  if (/tistory\.com\/(manage|dashboard)/.test(url)) return true;
  const stats = page.getByText(/통계|방문통계|관리홈/, { exact: false }).first();
  return (await stats.count()) > 0;
}

async function waitForLogin(page: Page) {
  if (await isLoggedIn(page)) {
    console.log("이미 로그인된 세션입니다.");
    return;
  }

  await clickFirst(page, [
    page.getByRole("link", { name: /카카오계정으로 시작|카카오로 로그인|로그인/ }),
    page.getByText("카카오계정으로 시작하기"),
    page.locator("a.btn_login, a.link_kakao, .btn_kakao"),
  ]);

  await waitUntil(
    page,
    () => isLoggedIn(page),
    "크롬 창에서 카카오/티스토리 로그인을 완료해 주세요. 끝나면 통계 화면을 돌아다닙니다.",
  );
}

async function resolveBlog(page: Page, cfg: AppConfig): Promise<AppConfig> {
  if (cfg.blogUserId && cfg.blogUrl) return cfg;

  const fromUrl = blogIdFromUrl(page.url());
  if (fromUrl) {
    const blogUrl = `https://${fromUrl}.tistory.com`;
    console.log(`블로그 자동 인식: ${fromUrl}`);
    return withBlog(cfg, fromUrl, blogUrl);
  }

  await page.goto("https://www.tistory.com/manage", { waitUntil: "domcontentloaded" }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const afterManage = blogIdFromUrl(page.url());
  if (afterManage) {
    console.log(`블로그 자동 인식: ${afterManage}`);
    return withBlog(cfg, afterManage, `https://${afterManage}.tistory.com`);
  }

  throw new Error("블로그 주소를 찾지 못했습니다. .env에 TISTORY_BLOG_ID 를 넣어 주세요.");
}

async function openStats(page: Page, cfg: AppConfig) {
  const candidates = [
    `${cfg.blogUrl}/manage/statistics/blog`,
    cfg.statsUrl,
    `${cfg.blogUrl}/manage/visitor`,
    `${cfg.blogUrl}/manage/stats`,
    `${cfg.blogUrl}/manage`,
  ];

  for (const url of candidates) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    const opened = await clickFirst(page, [
      page.getByRole("link", { name: /^통계$/ }),
      page.getByRole("link", { name: /방문통계|방문 통계/ }),
      page.getByText("방문통계", { exact: true }),
      page.getByText("통계", { exact: true }),
    ]);
    if (opened) await page.waitForTimeout(1500);
    const body = await page.locator("body").innerText().catch(() => "");
    if (/조회수|방문자|유입 키워드|인기글/.test(body)) return;
  }
}

async function scrapePage(page: Page): Promise<DailySnapshot | null> {
  const text = await page.locator("body").innerText();
  return parseTistoryPageText(text);
}

async function clickVisibleDates(page: Page, snapshots: DailySnapshot[]) {
  const labels = page.getByText(/\d+월\s*\d+/);
  const count = await labels.count();
  const limit = Math.min(count, 24);
  for (let i = 0; i < limit; i += 1) {
    try {
      await labels.nth(i).click({ timeout: 1500 });
      await page.waitForTimeout(700);
      const row = await scrapePage(page);
      if (row) snapshots.push(row);
    } catch {
      // 차트 라벨이 아닌 다른 텍스트일 수 있음
    }
  }
}

async function main() {
  let cfg = loadConfig();
  const { from, to } = crawlRange();
  const today = to || from || toKstDate(new Date());
  const days = from && to ? Math.max(1, Math.ceil((Date.parse(`${to}T12:00:00+09:00`) - Date.parse(`${from}T12:00:00+09:00`)) / 86400000) + 1) : Number(process.argv.find((arg) => arg.startsWith("--days="))?.slice(7) ?? "90");
  ensureDir(cfg.rawDir);

  const targets = blogTargets();
  const context = await openPersistentChrome();
  const page = await pageOn(
    context,
    /tbell\.tistory\.com\/manage\/statistics\/blog/i,
    targets.tistoryStatsUrl,
  );

  const networkJson: CaptureFile["networkJson"] = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (!/tistory\.com|kakao\.com/.test(url)) return;
    const body = await safeJson(response);
    if (body == null) return;
    networkJson.push({ url, body });
  });

  if (!/manage\/statistics\/blog/.test(page.url())) {
    await page.goto(targets.tistoryStatsUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
  }
  await waitForLogin(page);
  cfg = await resolveBlog(page, cfg);

  if (from && to) console.log(`수집 기간 ${from} ~ ${to}`);
  const base = `${cfg.blogUrl}/manage/v2/statistics/blog`;
  if (!/manage\/statistics\/blog/.test(page.url())) {
    await page.goto(targets.tistoryStatsUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    }).catch(() => undefined);
  }

  const fetchJson = async (url: string): Promise<unknown | null> => {
    try {
      const response = await page.request.get(url);
      if (!response.ok()) return null;
      let body = await response.json();
      if (url.includes("/manage/posts.json") && body && typeof body === "object") {
        const rec = body as { items?: Array<Record<string, unknown>> };
        if (Array.isArray(rec.items)) {
          body = {
            ...rec,
            items: rec.items.map((item) => {
              const { postPassword: _pw, ...rest } = item;
              return rest;
            }),
          };
        }
      }
      networkJson.push({ url, body });
      return body;
    } catch {
      return null;
    } finally {
      await page.waitForTimeout(80);
    }
  };

  await fetchJson(`${base}/count`);
  const windowStart = from || today;
  for (let offset = 0; offset < days; offset += 21) {
    const startDate = addKstDays(windowStart, -offset);
    await fetchJson(`${base}/trend?granularity=day&metric=pv&startDate=${startDate}`);
    await fetchJson(`${base}/trend?granularity=day&metric=uv&startDate=${startDate}`);
  }

  const parsedDates = parseTistoryNetwork(networkJson).map((row) => row.date);
  const dates = [...new Set([...(from && to ? eachDay(from, to) : parsedDates), ...parsedDates])].filter((date) =>
    keepDate(date, from, to),
  );
  for (const date of dates) {
    await fetchJson(`${base}/inflow?granularity=day&metric=pv&startDate=${date}`);
    await fetchJson(`${base}/topEntry?metric=pv&startDate=${date}&granularity=day`);
    await fetchJson(`${base}/keyword?granularity=day&metric=pv&startDate=${date}`);
  }

  const posts: ListedPost[] = [];
  for (let pageNo = 1; pageNo <= 50; pageNo += 1) {
    const body = await fetchJson(
      `${cfg.blogUrl}/manage/posts.json?category=-3&page=${pageNo}&searchKeyword=&searchType=title&visibility=all`,
    );
    const items = Array.isArray((body as { items?: unknown[] } | null)?.items)
      ? (body as { items: Array<Record<string, unknown>> }).items
      : [];
    if (!items.length) break;
    for (const item of items) {
      const id = String(item.id ?? "");
      if (!id) continue;
      if (item.visibility && item.visibility !== "PUBLIC") continue;
      posts.push({
        externalId: id,
        title: typeof item.title === "string" ? item.title : undefined,
        url: typeof item.permalink === "string" ? item.permalink : `${cfg.blogUrl}/${id}`,
        publishedAt: typeof item.published === "string" ? item.published : undefined,
      });
    }
    const total = Number((body as { totalCount?: number } | null)?.totalCount ?? 0);
    if (posts.length >= total) break;
  }
  console.log(`글 ${posts.length}편 — 글별 통계를 엽니다.`);

  const postStats: PostDayStat[] = [];
  const totals: Array<{ id: string; title?: string; total: number }> = [];
  const entryBase = `${cfg.blogUrl}/manage/v2/statistics/entry`;
  for (const [index, post] of posts.entries()) {
    console.log(`[${index + 1}/${posts.length}] ${post.title ?? post.externalId}`);
    const baseBody = await fetchJson(`${entryBase}/base?entryId=${post.externalId}&metric=pv`);
    const baseData = (baseBody as { data?: { title?: string; count?: number; permalink?: string } } | null)?.data;
    if (baseData?.count != null) {
      totals.push({ id: post.externalId, title: baseData.title ?? post.title, total: Number(baseData.count) });
    }
    if (baseData?.title && !post.title) post.title = baseData.title;
    if (baseData?.permalink) post.url = baseData.permalink;
    for (let offset = 0; offset < days; offset += 21) {
      const startDate = addKstDays(windowStart, -offset);
      const trendBody = await fetchJson(
        `${entryBase}/trend?startDate=${startDate}&granularity=day&entryId=${post.externalId}&metric=pv`,
      );
      const points = (trendBody as { data?: unknown } | null)?.data;
      if (!Array.isArray(points)) continue;
      for (const point of points) {
        if (!point || typeof point !== "object") continue;
        const rec = point as { timestamp?: string; count?: number };
        if (typeof rec.timestamp !== "string") continue;
        postStats.push({
          externalId: post.externalId,
          date: toKstDate(rec.timestamp),
          views: Number(rec.count ?? 0),
        });
      }
    }
  }

  const uniqueStats = new Map<string, PostDayStat>();
  for (const row of postStats) {
    if (!keepDate(row.date, from, to)) continue;
    uniqueStats.set(`${row.externalId}|${row.date}`, row);
  }
  const collapsed = [...uniqueStats.values()];
  const merged = applyPostDays(parseTistoryNetwork(networkJson), posts, collapsed).filter(
    (row) => keepDate(row.date, from, to),
  );
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = resolve(cfg.rawDir, `${cfg.blogUserId || "tistory"}-${stamp}.json`);
  const capture: CaptureFile = {
    capturedAt: new Date().toISOString(),
    pageUrl: page.url(),
    pageText: await page.locator("body").innerText().catch(() => undefined),
    networkJson,
    snapshots: merged,
    posts,
    postStats: collapsed,
    totals,
  };
  writeFileSync(outFile, JSON.stringify(capture, null, 2), "utf8");

  console.log(`원본 저장: ${outFile}`);
  console.log(`정규화된 날짜 ${merged.length}건 / 글 ${posts.length}편 / 글별 일간 ${collapsed.filter((row) => row.views).length}건`);
  if (merged.length) {
    console.log(`기간: ${merged[0].date} ~ ${merged.at(-1)?.date}`);
  }

  if (merged.length) {
    try {
      const { disconnectDb, upsertTistorySnapshots } = await import("./upsert.js");
      const { upsertPostsAndStats } = await import("../../lib/blog-upsert.js");
      const result = await upsertTistorySnapshots(cfg, merged);
      if (posts.length) {
        await upsertPostsAndStats(
          {
            clientSlug: cfg.clientSlug,
            clientName: cfg.clientName,
            platform: "TISTORY",
            blogUserId: cfg.blogUserId,
            blogUrl: cfg.blogUrl,
            name: cfg.blogUserId,
          },
          posts,
          collapsed,
        );
      }
      await disconnectDb();
      console.log(`DB 적재: daily ${result.daily} / sources ${result.sources} / devices ${result.devices}`);
    } catch (error) {
      console.log("원본 파일은 저장했습니다. DB가 꺼져 있어 적재는 건너뜁니다.");
      console.log(error instanceof Error ? error.message : error);
    }
  }
  await import("../../lib/publish-web.js").then((mod) => mod.publishWebDocs(["report"]));
  if (!merged.length) {
    console.log("숫자를 아직 못 읽었습니다. 원본 JSON은 저장했으니 페이지 구조를 보고 파서를 보강하면 됩니다.");
  }

  await releaseChrome(context);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
