import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import type { Page, Response } from "playwright";
import { pageOn, releaseChrome, openPersistentChrome, waitUntil, root, ensureDir } from "../shared/chrome.js";
import { blogTargets } from "../shared/targets.js";
import type { CaptureFile, DailySnapshot } from "../tistory/types.js";
import { crawlRange, keepDate } from "../shared/crawl-range.js";
import { upsertDailySnapshots, upsertPostsAndStats } from "../../lib/blog-upsert.js";

loadEnv();

const GRAPHQL = "https://v2.velog.io/graphql";

const CURRENT_USER_QUERY = `
query CurrentUser {
  currentUser { id username }
}
`;

const POSTS_QUERY = `
query Posts($username: String!, $cursor: ID, $limit: Int) {
  posts(username: $username, cursor: $cursor, limit: $limit) {
    id
    title
    url_slug
    likes
    comments_count
    released_at
  }
}
`;

type VelogPost = {
  id: string;
  title?: string;
  url_slug?: string;
  likes?: number;
  comments_count?: number;
  released_at?: string;
};

type StatsPayload = {
  total?: number;
  count_by_day?: Array<{ count: number; day: string }>;
};

type GraphqlJson<T> = { data?: T; errors?: Array<{ message: string }> };

async function graphqlFromPage<T>(page: Page, query: string, variables: Record<string, unknown>, operationName?: string) {
  const response = await page.request.post(GRAPHQL, {
    headers: {
      "content-type": "application/json",
      origin: "https://velog.io",
      referer: "https://velog.io/",
    },
    data: { operationName, query, variables },
  });
  const json = (await response.json()) as GraphqlJson<T>;
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  if (!json.data) throw new Error("Velog GraphQL 응답이 비었습니다.");
  return json.data;
}

async function currentUsername(page: Page): Promise<string> {
  try {
    const data = await graphqlFromPage<{ currentUser: { username?: string } | null }>(
      page,
      CURRENT_USER_QUERY,
      {},
      "CurrentUser",
    );
    return data.currentUser?.username?.trim() || "";
  } catch {
    return "";
  }
}

function emptyDay(date: string): DailySnapshot {
  return { date, sources: [], devices: [], popularPosts: [], inflowKeywords: [] };
}

function postUrl(username: string, slug: string) {
  return `https://velog.io/@${username}/${slug}`;
}

async function clickFirst(page: Page, selectors: Array<() => ReturnType<Page["locator"]>>): Promise<boolean> {
  for (const make of selectors) {
    const target = make().first();
    try {
      if ((await target.count()) === 0) continue;
      await target.click({ timeout: 2500 });
      return true;
    } catch {
      // 다음 후보
    }
  }
  return false;
}

function isGetStatsRequest(response: Response) {
  if (!/velog\.io\/graphql/.test(response.url())) return false;
  const body = response.request().postData() ?? "";
  return /GetStats|getStats/.test(body);
}

function statsFromGraphqlBody(body: unknown): StatsPayload | null {
  if (!body || typeof body !== "object") return null;
  const data = (body as { data?: { getStats?: StatsPayload } }).data?.getStats;
  return data ?? null;
}

async function collectStatsFromUi(page: Page, username: string, post: VelogPost): Promise<StatsPayload | null> {
  const slug = post.url_slug ?? "";
  const url = postUrl(username, slug);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(600);

  const pending = page
    .waitForResponse((response) => isGetStatsRequest(response) && response.ok(), { timeout: 20_000 })
    .catch(() => null);

  await clickFirst(page, [
    () => page.getByRole("button", { name: /설정/ }),
    () => page.getByRole("link", { name: /설정/ }),
    () => page.getByText("설정", { exact: true }),
  ]);
  await page.waitForTimeout(300);

  const opened = await clickFirst(page, [
    () => page.getByRole("link", { name: /^통계$/ }),
    () => page.getByRole("button", { name: /^통계$/ }),
    () => page.locator('a[href$="/stats"]'),
    () => page.getByText("통계", { exact: true }),
  ]);

  if (!opened && !page.url().includes("/stats")) {
    await page.goto(`${url}/stats`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  }

  const response = await pending;
  if (response) {
    try {
      return statsFromGraphqlBody(await response.json());
    } catch {
      // DOM 파싱으로 이어감
    }
  }

  const text = await page.locator("body").innerText().catch(() => "");
  if (/이 포스트는 당신의 포스트가 아닙니다|This post is not yours/.test(text)) return null;
  const totalMatch = text.match(/조회수[^\d]*([\d,]+)/);
  if (!totalMatch) return null;
  return { total: Number(totalMatch[1].replace(/,/g, "")), count_by_day: [] };
}

async function main() {
  const { from, to } = crawlRange();
  const clientSlug = process.env.CLIENT_SLUG?.trim() || "t-assi";
  const clientName = process.env.CLIENT_NAME?.trim() || clientSlug;
  const targets = blogTargets();
  const expectedUser = targets.velogUser;
  const rawDir = resolve(root, "data/velog-raw");
  ensureDir(rawDir);

  const context = await openPersistentChrome();
  const page = await pageOn(context, /velog\.io\/@tbell\/posts/i, targets.velogPostsUrl);

  let lastWrongAccount = 0;
  await waitUntil(
    page,
    async () => {
      if (!/velog\.io\/@tbell\/posts/i.test(page.url())) return false;
      const username = await currentUsername(page);
      if (username && expectedUser && username !== expectedUser) {
        if (Date.now() - lastWrongAccount > 15_000) {
          console.log(`지금 로그인된 계정은 @${username} 입니다. @${expectedUser} 로 바꿔 주세요.`);
          lastWrongAccount = Date.now();
        }
        return false;
      }
      return true;
    },
    expectedUser
      ? `크롬에서 https://velog.io/@${expectedUser}/posts 가 보이게 로그인해 주세요. 이후 각 글 상세 → 통계를 엽니다.`
      : "크롬 창에서 벨로그 로그인을 완료해 주세요.",
  );

  if (!/velog\.io\/@tbell\/posts/.test(page.url())) {
    await page.goto(targets.velogPostsUrl, { waitUntil: "domcontentloaded" });
  }

  const username = (await currentUsername(page)) || expectedUser;
  if (!username) throw new Error("벨로그 로그인 계정을 찾지 못했습니다. .env에 VELOG_USERNAME 을 넣어 주세요.");
  console.log(`벨로그 사용자: @${username}`);

  const posts: VelogPost[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 50; i += 1) {
    const data = await graphqlFromPage<{ posts: VelogPost[] }>(page, POSTS_QUERY, { username, cursor, limit: 50 }, "Posts");
    const batch = data.posts ?? [];
    if (!batch.length) break;
    posts.push(...batch);
    cursor = batch.at(-1)?.id;
    if (batch.length < 50) break;
  }
  console.log(`글 ${posts.length}편 — 각 글 상세에서 통계를 엽니다.`);

  const postInputs = posts.map((post) => ({
    externalId: post.id,
    title: post.title,
    url: postUrl(username, post.url_slug ?? ""),
    publishedAt: post.released_at,
  }));

  const postStats: Array<{ externalId: string; date: string; views: number; likes?: number; comments?: number }> = [];
  const byDate = new Map<string, DailySnapshot>();
  const totals: Array<{ id: string; title?: string; total: number }> = [];

  for (const [index, post] of posts.entries()) {
    if (!post.url_slug) {
      console.log(`슬러그 없음, 생략: ${post.title}`);
      continue;
    }
    console.log(`[${index + 1}/${posts.length}] ${post.title}`);
    try {
      const stats = await collectStatsFromUi(page, username, post);
      const days = stats?.count_by_day ?? [];
      if (stats?.total != null) totals.push({ id: post.id, title: post.title, total: stats.total });
      if (!days.length) {
        console.log(`  일별 조회수 없음${stats?.total != null ? ` (총 ${stats.total})` : ""}`);
      }
      for (const point of days) {
        const date = String(point.day).slice(0, 10);
        if (!keepDate(date, from, to)) continue;
        postStats.push({
          externalId: post.id,
          date,
          views: point.count,
          likes: post.likes,
          comments: post.comments_count,
        });
        const current = byDate.get(date) ?? emptyDay(date);
        current.views = (current.views ?? 0) + point.count;
        byDate.set(date, current);
      }
    } catch (error) {
      console.log(`  통계 생략: ${error instanceof Error ? error.message : error}`);
    }
    await page.waitForTimeout(400);
  }

  const snapshots = [...byDate.values()]
    .filter((row) => keepDate(row.date, from, to))
    .sort((a, b) => a.date.localeCompare(b.date));
  const capture: CaptureFile = {
    capturedAt: new Date().toISOString(),
    pageUrl: page.url(),
    networkJson: [],
    snapshots,
  };
  const outFile = resolve(rawDir, `${username}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(outFile, JSON.stringify({ ...capture, posts: postInputs, postStats, totals }, null, 2), "utf8");
  console.log(`원본 저장: ${outFile}`);
  console.log(`정규화된 날짜 ${snapshots.length}건 / 총조회 있는 글 ${totals.length}편`);

  try {
    await upsertPostsAndStats(
      {
        clientSlug,
        clientName,
        platform: "VELOG",
        blogUserId: username,
        blogUrl: `https://velog.io/@${username}`,
        name: username,
      },
      postInputs,
      postStats,
    );
    const result = await upsertDailySnapshots(
      {
        clientSlug,
        clientName,
        platform: "VELOG",
        blogUserId: username,
        blogUrl: `https://velog.io/@${username}`,
        name: username,
      },
      snapshots,
      "VELOG",
    );
    console.log(`DB 적재: daily ${result.daily}`);
  } catch (error) {
    console.log("원본 파일은 저장했습니다. DB 적재는 스키마 적용 후 ingest 하면 됩니다.");
    console.log(error instanceof Error ? error.message : error);
  }
  await import("../../lib/publish-web.js").then((mod) => mod.publishWebDocs(["report"]));

  await releaseChrome(context);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
