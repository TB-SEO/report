import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseTistoryNetwork } from "../collectors/tistory/parse-api.js";
import { mergeSnapshots } from "../collectors/tistory/parse.js";
import type { CaptureFile, DailySnapshot } from "../collectors/tistory/types.js";
import { root } from "../collectors/shared/chrome.js";
import { blogTargets } from "../collectors/shared/targets.js";
import { applyPostDays } from "../collectors/shared/post-days.js";

export type ReportPost = {
  title?: string;
  url?: string;
  views?: number;
  likes?: number;
  comments?: number;
  publishedAt?: string;
};

export type CrawlCheck = {
  expectedUrl: string;
  pageUrl?: string;
  file?: string;
  capturedAt?: string;
  ok: boolean;
  notes: string[];
};

export type PlatformReport = {
  platform: "TISTORY" | "VELOG" | "BRUNCH";
  file?: string;
  capturedAt?: string;
  pageUrl?: string;
  days: number;
  dateRange?: [string, string];
  todayViews: number;
  yesterdayViews: number;
  totalViews: number;
  totalVisitors: number;
  snapshots: DailySnapshot[];
  posts: ReportPost[];
  postDays?: Array<{ date: string; title?: string; url?: string; views: number }>;
  check: CrawlCheck;
};

export type ReportPayload = {
  generatedAt: string;
  platforms: PlatformReport[];
};

type RawFile = CaptureFile & {
  posts?: Array<{ title?: string; url?: string; publishedAt?: string; externalId?: string }>;
  postStats?: Array<{ externalId: string; date: string; views: number; likes?: number; comments?: number }>;
  totals?: Array<{ id: string; title?: string; total: number }>;
};

function listRaw(dir: string, prefer = "tbell"): Array<{ name: string; json: RawFile; mtime: number }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({
      name,
      mtime: statSync(join(dir, name)).mtimeMs,
      json: JSON.parse(readFileSync(join(dir, name), "utf8")) as RawFile,
    }))
    .sort((a, b) => {
      const ap = a.name.startsWith(prefer) ? 1 : 0;
      const bp = b.name.startsWith(prefer) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return b.mtime - a.mtime;
    });
}

function mergeRawFiles(dir: string, prefer = "tbell"): { name: string; json: RawFile } | null {
  const files = listRaw(dir, prefer);
  if (!files.length) return null;
  const posts = new Map<string, NonNullable<RawFile["posts"]>[number]>();
  const totals = new Map<string, NonNullable<RawFile["totals"]>[number]>();
  const stats = new Map<string, NonNullable<RawFile["postStats"]>[number]>();
  for (const file of [...files].reverse()) {
    for (const post of file.json.posts ?? []) {
      const id = post.externalId ?? post.url ?? post.title ?? "";
      if (id) posts.set(id, post);
    }
    for (const row of file.json.totals ?? []) totals.set(row.id, row);
    for (const row of file.json.postStats ?? []) {
      const key = `${row.externalId}|${row.date}`;
      const prev = stats.get(key);
      if (!prev || (row.views || 0) >= (prev.views || 0)) stats.set(key, row);
    }
  }
  const latest = files[0];
  return {
    name: latest.name,
    json: {
      ...latest.json,
      posts: [...posts.values()],
      totals: [...totals.values()],
      postStats: [...stats.values()],
    },
  };
}

function mergedSnapshots(
  files: Array<{ json: RawFile }>,
  platform: PlatformReport["platform"],
): DailySnapshot[] {
  const rows: DailySnapshot[] = [];
  for (const file of [...files].reverse()) {
    rows.push(...(file.json.snapshots ?? []));
    if (platform === "TISTORY") {
      rows.push(...parseTistoryNetwork(file.json.networkJson ?? []));
    }
    if (platform === "BRUNCH") {
      for (const item of file.json.networkJson ?? []) {
        if (!String(item.url).includes("stats/brunch/daily")) continue;
        const list = (item.body as { data?: { view?: { list?: Array<{ datetime?: string; cnt?: number }> } } } | null)
          ?.data?.view?.list;
        if (!list?.length) continue;
        for (const row of list) {
          rows.push({
            date: String(row.datetime).slice(0, 10),
            views: Number(row.cnt ?? 0),
            sources: [],
            devices: [],
            popularPosts: [],
            inflowKeywords: [],
          });
        }
      }
    }
  }
  return mergeSnapshots(rows).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.date >= "2026-01-01");
}

function range(snapshots: DailySnapshot[]): [string, string] | undefined {
  if (!snapshots.length) return undefined;
  return [snapshots[0].date, snapshots.at(-1)!.date];
}

function dayViews(snapshots: DailySnapshot[], date: string) {
  return snapshots.find((row) => row.date === date)?.views ?? 0;
}

function kstToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function addDays(ymd: string, delta: number) {
  const date = new Date(`${ymd}T00:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + delta);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}

function urlLooksRight(actual: string | undefined, platform: PlatformReport["platform"]) {
  if (!actual) return false;
  if (platform === "TISTORY") return /tbell\.tistory\.com\/manage\/statistics\/blog/i.test(actual);
  if (platform === "VELOG") return /velog\.io\/(@tbell|post-stats\/)/i.test(actual);
  return /brunch\.co\.kr\/@tbell\/stats/i.test(actual);
}

function attachCheck(report: PlatformReport): PlatformReport {
  const targets = blogTargets();
  const expectedUrl =
    report.platform === "TISTORY"
      ? targets.tistoryStatsUrl
      : report.platform === "VELOG"
        ? targets.velogPostsUrl
        : targets.brunchStatsUrl;
  const notes: string[] = [];
  if (!report.file) notes.push("원본 JSON이 없습니다.");
  else if (!report.file.startsWith("tbell-")) notes.push(`계정 파일이 tbell이 아닙니다 (${report.file}).`);
  if (!urlLooksRight(report.pageUrl, report.platform)) {
    notes.push(`수집 주소가 기대와 다릅니다. 기대 ${expectedUrl} / 실제 ${report.pageUrl || "없음"}`);
  }
  if (report.platform === "VELOG") {
    if (!report.posts.length) notes.push("글 목록이 비었습니다.");
    else if (!report.days) notes.push("글별 총조회는 있습니다. 일별 추이는 원본에 없습니다.");
  } else if (!report.days) {
    notes.push("일별 조회 시계열이 없습니다.");
  }
  if (report.platform === "TISTORY" && report.days > 0 && report.days < 7) {
    notes.push(`일별 데이터가 ${report.days}일만 있습니다.`);
  }
  return {
    ...report,
    check: {
      expectedUrl,
      pageUrl: report.pageUrl,
      file: report.file,
      capturedAt: report.capturedAt,
      ok: notes.filter((note) => !note.includes("일별 추이는 원본에 없습니다")).length === 0,
      notes,
    },
  };
}
function summarize(
  platform: PlatformReport["platform"],
  file: string | undefined,
  json: RawFile | null,
  snapshots: DailySnapshot[],
  posts: ReportPost[],
): PlatformReport {
  const today = kstToday();
  const yesterday = addDays(today, -1);
  const fromDays = snapshots.reduce((sum, row) => sum + (row.views ?? 0), 0);
  const fromPosts = posts.reduce((sum, post) => sum + (post.views ?? 0), 0);
  const base: PlatformReport = {
    platform,
    file,
    capturedAt: json?.capturedAt,
    pageUrl: json?.pageUrl,
    days: snapshots.length,
    dateRange: range(snapshots),
    todayViews: dayViews(snapshots, today),
    yesterdayViews: dayViews(snapshots, yesterday),
    totalViews: fromDays || fromPosts,
    totalVisitors: snapshots.reduce((sum, row) => sum + (row.visitors ?? 0), 0),
    snapshots,
    posts,
    postDays: postDaysFromRaw(json),
    check: { expectedUrl: "", ok: false, notes: [] },
  };
  return attachCheck(base);
}

function postDaysFromRaw(json: RawFile | null | undefined) {
  const meta = new Map((json?.posts ?? []).map((post) => [post.externalId ?? "", post]));
  return (json?.postStats ?? [])
    .filter((row) => row.views)
    .map((row) => {
      const post = meta.get(row.externalId);
      return {
        date: row.date,
        title: post?.title,
        url: post?.url,
        views: row.views,
      };
    });
}

function reportPostsFromRaw(json: RawFile | null | undefined): ReportPost[] {
  const totals = new Map((json?.totals ?? []).map((row) => [row.id, row]));
  const viewsByPost = new Map<string, number>();
  for (const row of json?.postStats ?? []) {
    viewsByPost.set(row.externalId, (viewsByPost.get(row.externalId) ?? 0) + row.views);
  }
  return (json?.posts ?? [])
    .map((post) => {
      const id = post.externalId ?? "";
      return {
        title: post.title,
        url: post.url,
        publishedAt: post.publishedAt,
        views: totals.get(id)?.total ?? viewsByPost.get(id) ?? 0,
      };
    })
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
}

function withPostDays(snapshots: DailySnapshot[], json: RawFile | null | undefined): DailySnapshot[] {
  if (!json?.postStats?.length) return snapshots;
  return applyPostDays(snapshots, json.posts ?? [], json.postStats);
}

function tistoryReport(): PlatformReport {
  const files = listRaw(join(root, "data/tistory-raw"));
  const raw = mergeRawFiles(join(root, "data/tistory-raw"));
  const json = raw?.json ?? null;
  const snapshots = withPostDays(mergedSnapshots(files, "TISTORY"), json);
  const posts = reportPostsFromRaw(json);
  const fallback = [...snapshots].reverse().find((row) => row.popularPosts.length);
  const listed = posts.length
    ? posts
    : (fallback?.popularPosts ?? []).map((post) => ({ title: post.title, url: post.url, views: post.views }));
  return summarize("TISTORY", raw?.name, json, snapshots, listed);
}

function velogReport(): PlatformReport {
  const files = listRaw(join(root, "data/velog-raw"));
  const raw = mergeRawFiles(join(root, "data/velog-raw"));
  const json = raw?.json;
  const totals = new Map((json?.totals ?? []).map((row) => [row.id, row]));
  const viewsByPost = new Map<string, number>();
  for (const row of json?.postStats ?? []) {
    viewsByPost.set(row.externalId, (viewsByPost.get(row.externalId) ?? 0) + row.views);
  }
  const posts = (json?.posts ?? [])
    .filter((post) => !post.url || post.url.includes("/@tbell/"))
    .map((post) => {
      const id = post.externalId ?? "";
      return {
        title: post.title,
        url: post.url,
        publishedAt: post.publishedAt,
        views: totals.get(id)?.total ?? viewsByPost.get(id) ?? 0,
      };
    })
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0));

  const snapshots = withPostDays(mergedSnapshots(files, "VELOG"), json);
  const report = summarize("VELOG", raw?.name, json ?? null, snapshots, posts);
  if (!(json?.postStats ?? []).some((row) => row.views) && !snapshots.some((row) => row.views)) {
    report.check.notes.push("글별 총조회는 있습니다. 일별 추이는 원본에 없습니다.");
  }
  return report;
}

function brunchReport(): PlatformReport {
  const files = listRaw(join(root, "data/brunch-raw"));
  const raw = mergeRawFiles(join(root, "data/brunch-raw"));
  const json = raw?.json ?? null;
  const snapshots = withPostDays(mergedSnapshots(files, "BRUNCH"), json);
  let posts = reportPostsFromRaw(json);
  if (!posts.length) {
    for (const file of files) {
      for (const item of file.json.networkJson ?? []) {
        if (!String(item.url).includes("stats/brunch/daily")) continue;
        const popular = (item.body as { data?: { popular?: unknown } } | null)?.data?.popular;
        if (!Array.isArray(popular)) continue;
        posts = popular.map((row) => {
          const rec = row as Record<string, unknown>;
          const no = rec.article_no ?? rec.articleNo;
          return {
            title: String(rec.title ?? ""),
            views: Number(rec.cnt ?? 0),
            url: no != null ? `https://brunch.co.kr/@tbell/${no}` : undefined,
          };
        });
      }
    }
  }
  const report = summarize("BRUNCH", raw?.name, json, snapshots, posts);
  const daily = [...files]
    .flatMap((file) => file.json.networkJson ?? [])
    .find((item) => String(item.url).includes("stats/brunch/daily"));
  const total = (daily?.body as { data?: { view?: { total?: number } } } | undefined)?.data?.view?.total;
  if (typeof total === "number") report.totalViews = total;
  return report;
}

export function buildReportFromLocalFiles(): ReportPayload {
  return {
    generatedAt: new Date().toISOString(),
    platforms: [tistoryReport(), velogReport(), brunchReport()],
  };
}

function rawStamp() {
  let stamp = 0;
  for (const dir of ["data/tistory-raw", "data/velog-raw", "data/brunch-raw"]) {
    const files = listRaw(join(root, dir));
    stamp += files.reduce((sum, file) => sum + file.mtime, 0);
  }
  return stamp;
}

let reportCache: { stamp: number; payload: ReportPayload } | null = null;

export async function loadReport(): Promise<ReportPayload> {
  const stamp = rawStamp();
  if (stamp) {
    if (reportCache?.stamp === stamp) return reportCache.payload;
    const built = buildReportFromLocalFiles();
    reportCache = { stamp, payload: built };
    import("../lib/app-documents.js")
      .then((mod) => mod.putAppDocument("report", built))
      .catch(() => undefined);
    return built;
  }
  try {
    const { getAppDocument, putAppDocument } = await import("../lib/app-documents.js");
    const stored = await getAppDocument<ReportPayload>("report");
    if (stored) return stored.payload;
    const built = buildReportFromLocalFiles();
    await putAppDocument("report", built).catch(() => undefined);
    return built;
  } catch {
    return buildReportFromLocalFiles();
  }
}
