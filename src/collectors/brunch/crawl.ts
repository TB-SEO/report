import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import type { Page, Response } from "playwright";
import { pageOn, releaseChrome, ensureDir, openPersistentChrome, root, waitUntil } from "../shared/chrome.js";
import { blogTargets } from "../shared/targets.js";
import { extractSeriesFromJson, mergeSnapshots } from "../tistory/parse.js";
import { addKstDays, toKstDate } from "../tistory/parse-api.js";
import type { CaptureFile } from "../tistory/types.js";
import { applyPostDays, type ListedPost, type PostDayStat } from "../shared/post-days.js";
import { crawlRange, eachDay, keepDate, kstToday } from "../shared/crawl-range.js";
import { upsertDailySnapshots, upsertPostsAndStats } from "../../lib/blog-upsert.js";
import type { DailySnapshot } from "../tistory/types.js";

loadEnv();

async function safeJson(response: Response): Promise<unknown | null> {
  const type = response.headers()["content-type"] ?? "";
  if (!type.includes("json") && !type.includes("javascript")) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function authorFromUrl(url: string): string | undefined {
  const match = url.match(/brunch\.co\.kr\/@@?([^/?#]+)/i);
  return match?.[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

async function fetchJson(page: Page, url: string): Promise<unknown | null> {
  try {
    const response = await page.request.get(url);
    if (!response.ok()) return null;
    return await response.json();
  } catch {
    return null;
  }
}

const MONTHS: Record<string, string> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

function parseBrunchSelectedDay(text: string): { date: string; views: number } | null {
  const dateMatch = text.match(/조회수 그래프\s+([A-Za-z]{3})\s+(\d{1,2})\.\s+(\d{4})/);
  if (!dateMatch) return null;
  const month = MONTHS[dateMatch[1]];
  if (!month) return null;
  const date = `${dateMatch[3]}-${month}-${dateMatch[2].padStart(2, "0")}`;
  const viewsMatch = text.match(/조회수 그래프[\s\S]{0,500}?조회수\s+(\d+)\s+(?:상승|하락|보합)/);
  if (!viewsMatch) return null;
  return { date, views: Number(viewsMatch[1]) };
}

async function selectDailyGrain(page: Page) {
  const daily = page.getByText("일간", { exact: true });
  if (await daily.count()) {
    await daily.first().click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(400);
  }
}

async function clickChartLabel(page: Page, label: string): Promise<boolean> {
  const viaSvg = await page.evaluate((want) => {
    const nodes = [...document.querySelectorAll("svg text, svg tspan")];
    const hits = nodes.filter((node) => (node.textContent ?? "").trim() === want);
    for (const hit of hits) {
      const rect = hit.getBoundingClientRect();
      if (rect.width < 1 && rect.height < 1) continue;
      const x = rect.x + rect.width / 2;
      const y = rect.y - 24;
      const target = document.elementFromPoint(x, y) ?? hit;
      for (const el of [target, hit, hit.parentElement]) {
        el?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }),
        );
      }
      return true;
    }
    return false;
  }, label);
  if (viaSvg) return true;

  const loc = page.locator("svg text, svg tspan").filter({ hasText: new RegExp(`^${label}$`) });
  const count = await loc.count();
  for (let i = 0; i < count; i += 1) {
    const box = await loc.nth(i).boundingBox();
    if (!box) continue;
    await page.mouse.click(box.x + box.width / 2, box.y - 24);
    return true;
  }
  return false;
}

async function revealChartRange(page: Page, fromDay: string) {
  for (let i = 0; i < 280; i += 1) {
    const text = await page.locator("body").innerText().catch(() => "");
    const parsed = parseBrunchSelectedDay(text);
    if (parsed && parsed.date >= fromDay) return true;
    const next = page.getByText("다음 날짜", { exact: true });
    if (!(await next.count())) return false;
    await next.first().click({ timeout: 1500 }).catch(() => undefined);
    await page.waitForTimeout(200);
  }
  return false;
}

async function clickBrunchChartDays(page: Page, fromDay: string, toDay: string, statsUrl: string): Promise<DailySnapshot[]> {
  await page.goto(statsUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await selectDailyGrain(page);
  const revealed = await revealChartRange(page, fromDay);
  if (!revealed) console.log("브런치 그래프를 수집 기간까지 이동하지 못했습니다.");
  const today = kstToday();
  const rows: DailySnapshot[] = [];
  for (const ymd of eachDay(fromDay, toDay)) {
    const label = ymd === today ? "오늘" : String(Number(ymd.slice(8, 10)));
    const clicked = await clickChartLabel(page, label);
    if (clicked) await page.waitForTimeout(700);
    const text = await page.locator("body").innerText().catch(() => "");
    const parsed = parseBrunchSelectedDay(text);
    const matched = parsed?.date === ymd ? parsed : null;
    if (!matched) {
      console.log(`브런치 그래프 ${ymd} 클릭 실패`);
      continue;
    }
    console.log(`브런치 그래프 ${matched.date} 조회수 ${matched.views}`);
    rows.push({
      date: matched.date,
      views: matched.views,
      sources: [],
      devices: [],
      popularPosts: [],
      inflowKeywords: [],
    });
  }
  return rows;
}

async function listArticles(page: Page, authorId: string): Promise<{ home: string; posts: ListedPost[] }> {
  const posts: ListedPost[] = [];
  const seen = new Set<string>();
  let lastTime = 0;
  let home = "";
  for (let i = 0; i < 30; i += 1) {
    const body = await fetchJson(
      page,
      `https://api.brunch.co.kr/v2/article/@${authorId}?lastTime=${lastTime}&thumbnail=Y&membershipContent=false`,
    );
    const list = isRecord(body) && isRecord(body.data) && Array.isArray(body.data.list) ? body.data.list : [];
    if (!list.length) break;
    let nextTime = lastTime;
    for (const item of list) {
      if (!isRecord(item)) continue;
      const no = item.no ?? item.article_no ?? item.articleNo;
      const id = no != null ? String(no) : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (!home && typeof item.userId === "string") home = item.userId;
      const published = typeof item.publishTime === "number"
        ? new Date(item.publishTime).toISOString()
        : typeof item.publishTimestamp === "number"
          ? new Date(item.publishTimestamp).toISOString()
          : undefined;
      posts.push({
        externalId: id,
        title: typeof item.title === "string" ? item.title : undefined,
        url: `https://brunch.co.kr/@${authorId}/${id}`,
        publishedAt: published,
      });
      const stamp = Number(item.publishTime ?? item.publishTimestamp ?? item.createTime ?? 0);
      if (stamp > 0) nextTime = stamp;
    }
    if (nextTime === lastTime) break;
    lastTime = nextTime;
    await page.waitForTimeout(200);
  }
  return { home, posts };
}

async function main() {
  const { from, to } = crawlRange();
  const clientSlug = process.env.CLIENT_SLUG?.trim() || "t-assi";
  const clientName = process.env.CLIENT_NAME?.trim() || clientSlug;
  const rawDir = resolve(root, "data/brunch-raw");
  ensureDir(rawDir);

  const targets = blogTargets();
  const context = await openPersistentChrome();
  const page = await pageOn(context, /brunch\.co\.kr\/@tbell\/stats/i, targets.brunchStatsUrl);
  const networkJson: CaptureFile["networkJson"] = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (!/brunch\.co\.kr|daumcdn\.net|kakao\.com/.test(url)) return;
    if (/stats\/article\//.test(url)) return;
    const body = await safeJson(response);
    if (body == null) return;
    networkJson.push({ url, body });
  });

  await waitUntil(
    page,
    async () => {
      const url = page.url();
      return /@tbell\/stats/.test(url) && !/[?&]signin|login|accounts\.kakao/.test(url);
    },
    "크롬 창에서 브런치 통계가 보이게 로그인해 주세요. https://brunch.co.kr/@tbell/stats",
  );

  if (!/@tbell\/stats/.test(page.url()) || /[?&]signin/.test(page.url())) {
    await page.goto(targets.brunchStatsUrl, { waitUntil: "domcontentloaded" });
    await waitUntil(
      page,
      async () => /@tbell\/stats/.test(page.url()) && !/[?&]signin|login|accounts\.kakao/.test(page.url()),
      "크롬 창에서 브런치 통계가 보이게 로그인해 주세요. https://brunch.co.kr/@tbell/stats",
    );
  }
  await page.waitForTimeout(1500);

  const authorId = targets.brunchId || authorFromUrl(page.url()) || "tbell";
  console.log(`브런치 작가: ${authorId}`);

  const { home, posts: listed } = await listArticles(page, authorId);
  const posts = listed.filter((post) => {
    if (!post.publishedAt) return true;
    return post.publishedAt.slice(0, 10) >= "2026-07-01";
  });
  const homeId = home || "iHNj";
  console.log(`글 ${listed.length}편 중 7월 이후 ${posts.length}편 (home=${homeId})`);

  const today = to || from || toKstDate(new Date());
  const blogStart = from || addKstDays(today, -30);
  const blogEnd = to || today;
  const blogDailyUrl = `https://api.brunch.co.kr/v1/stats/brunch/daily?home=${homeId}&start=${blogStart}&end=${blogEnd}`;
  const blogDaily = await fetchJson(page, blogDailyUrl);
  networkJson.push({ url: blogDailyUrl, body: blogDaily });
  if (!blogDaily) {
    throw new Error("브런치 일별 통계 API가 비었습니다. 통계 페이지에 로그인한 뒤 다시 수집해 주세요.");
  }

  console.log("브런치 조회수 그래프에서 일자를 눌러 수집합니다.");
  const clickedDays = await clickBrunchChartDays(page, blogStart, blogEnd, targets.brunchStatsUrl);

  const postStats: PostDayStat[] = [];
  const totals: Array<{ id: string; title?: string; total: number }> = [];
  const collapsed: PostDayStat[] = [];

  let snapshots = mergeSnapshots([
    ...networkJson
      .filter((item) => String(item.url).includes("stats/brunch/daily"))
      .flatMap((item) => extractSeriesFromJson(item.body)),
  ]);
  for (const item of networkJson) {
    if (!String(item.url).includes("stats/brunch/daily")) continue;
    const payload = item.body as { data?: Record<string, unknown> } | null;
    const view = payload?.data && isRecord(payload.data.view) ? payload.data.view : null;
    const list = view && Array.isArray(view.list) ? view.list : [];
    if (!list.length) continue;
    snapshots = mergeSnapshots([
      ...snapshots,
      ...list.filter(isRecord).map((row) => ({
        date: String(row.datetime).slice(0, 10),
        views: Number(row.cnt ?? 0),
        sources: [],
        devices: [],
        popularPosts: [],
        inflowKeywords: [],
      })),
    ]);
  }
  snapshots = applyPostDays(snapshots, posts, collapsed);
  snapshots = mergeSnapshots([...snapshots, ...clickedDays]).filter((row) => keepDate(row.date, from, to));

  const capture: CaptureFile = {
    capturedAt: new Date().toISOString(),
    pageUrl: page.url(),
    pageText: await page.locator("body").innerText().catch(() => undefined),
    networkJson,
    snapshots,
    posts,
    postStats: collapsed,
    totals,
  };
  const outFile = resolve(rawDir, `${authorId}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(outFile, JSON.stringify(capture, null, 2), "utf8");
  console.log(`원본 저장: ${outFile}`);
  console.log(`정규화된 날짜 ${snapshots.length}건 / 글 ${posts.length}편 / 글별 일간 ${collapsed.filter((row) => row.views).length}건`);

  if (snapshots.length) {
    try {
      const result = await upsertDailySnapshots(
        {
          clientSlug,
          clientName,
          platform: "BRUNCH",
          blogUserId: authorId,
          blogUrl: `https://brunch.co.kr/@${authorId}`,
          name: authorId,
        },
        snapshots,
        "BRUNCH",
      );
      console.log(`DB 적재: daily ${result.daily}`);
      if (posts.length) {
        await upsertPostsAndStats(
          {
            clientSlug,
            clientName,
            platform: "BRUNCH",
            blogUserId: authorId,
            blogUrl: `https://brunch.co.kr/@${authorId}`,
            name: authorId,
          },
          posts,
          collapsed,
        );
      }
    } catch (error) {
      console.log("원본 파일은 저장했습니다. DB 적재는 스키마 적용 후 진행하면 됩니다.");
      console.log(error instanceof Error ? error.message : error);
    }
  } else {
    console.log("일별 숫자는 원본 JSON에 저장했습니다. 브런치 API 형태를 보고 파서를 보강하면 됩니다.");
  }
  await import("../../lib/publish-web.js").then((mod) => mod.publishWebDocs(["report"]));
  await releaseChrome(context);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
