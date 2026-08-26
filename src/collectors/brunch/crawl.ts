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
import { upsertDailySnapshots, upsertPostsAndStats } from "../../lib/blog-upsert.js";

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

function windowRange(end: string, size: number): { start: string; end: string } {
  return { start: addKstDays(end, -(size - 1)), end };
}

async function main() {
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
      return /@tbell\/stats/.test(url) && !/login|accounts\.kakao/.test(url);
    },
    "크롬 창에서 브런치 통계가 보이게 로그인해 주세요. https://brunch.co.kr/@tbell/stats",
  );

  await page.goto(targets.brunchStatsUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const authorId = targets.brunchId || authorFromUrl(page.url()) || "tbell";
  console.log(`브런치 작가: ${authorId}`);

  const { home, posts } = await listArticles(page, authorId);
  const homeId = home || "iHNj";
  console.log(`글 ${posts.length}편 — 글별 통계를 엽니다. (home=${homeId})`);

  const today = toKstDate(new Date());
  const postStats: PostDayStat[] = [];
  const totals: Array<{ id: string; title?: string; total: number }> = [];

  for (const [index, post] of posts.entries()) {
    console.log(`[${index + 1}/${posts.length}] ${post.title ?? post.externalId}`);
    let end = today;
    for (let w = 0; w < 4; w += 1) {
      const range = windowRange(end, 31);
      const url = `https://api.brunch.co.kr/v1/stats/article/daily?home=${homeId}&start=${range.start}&end=${range.end}&article=${post.externalId}`;
      const body = await fetchJson(page, url);
      networkJson.push({ url, body });
      const data = isRecord(body) && isRecord(body.data) ? body.data : null;
      const view = data && isRecord(data.view) ? data.view : null;
      if (w === 0 && view && typeof view.total === "number") {
        totals.push({ id: post.externalId, title: post.title, total: view.total });
      }
      const list = view && Array.isArray(view.list) ? view.list : [];
      for (const point of list) {
        if (!isRecord(point)) continue;
        postStats.push({
          externalId: post.externalId,
          date: String(point.datetime ?? "").slice(0, 10),
          views: Number(point.cnt ?? 0),
        });
      }
      end = addKstDays(range.start, -1);
      await page.waitForTimeout(150);
    }
  }

  const uniqueStats = new Map<string, PostDayStat>();
  for (const row of postStats) {
    if (!row.date) continue;
    uniqueStats.set(`${row.externalId}|${row.date}`, row);
  }
  const collapsed = [...uniqueStats.values()];

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
