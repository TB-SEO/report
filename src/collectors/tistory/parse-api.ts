import type { CaptureFile, DailySnapshot, TrafficSource } from "./types.js";
import { mergeSnapshots } from "./parse.js";

const SEARCH_KEYS: Record<string, { sourceCode: string; sourceName: string }> = {
  naver: { sourceCode: "naver", sourceName: "네이버 검색" },
  daum: { sourceCode: "daum", sourceName: "다음 검색" },
  google: { sourceCode: "google", sourceName: "구글 검색" },
  zum: { sourceCode: "zum", sourceName: "줌 검색" },
  bing: { sourceCode: "bing", sourceName: "빙 검색" },
  yahoo: { sourceCode: "yahoo", sourceName: "야후 검색" },
  etc: { sourceCode: "search_other", sourceName: "기타 검색" },
  other: { sourceCode: "search_other", sourceName: "기타 검색" },
};

const SNS_KEYS: Record<string, { sourceCode: string; sourceName: string }> = {
  kakaotalk: { sourceCode: "kakaotalk", sourceName: "카카오톡" },
  kakao: { sourceCode: "kakaotalk", sourceName: "카카오톡" },
  kakaostory: { sourceCode: "kakaostory", sourceName: "카카오스토리" },
  facebook: { sourceCode: "facebook", sourceName: "페이스북" },
  twitter: { sourceCode: "twitter", sourceName: "트위터" },
  youtube: { sourceCode: "youtube", sourceName: "유튜브" },
  instagram: { sourceCode: "instagram", sourceName: "인스타그램" },
  etc: { sourceCode: "sns_other", sourceName: "기타 SNS" },
  other: { sourceCode: "sns_other", sourceName: "기타 SNS" },
};

export function toKstDate(value: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof value === "string" ? new Date(value) : value);
}

export function addKstDays(ymd: string, delta: number): string {
  const date = new Date(`${ymd}T00:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + delta);
  return toKstDate(date);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function startDateFromUrl(url: string): string | undefined {
  try {
    return new URL(url).searchParams.get("startDate") ?? undefined;
  } catch {
    return undefined;
  }
}

function metricFromUrl(url: string): "pv" | "uv" {
  return new URL(url).searchParams.get("metric") === "uv" ? "uv" : "pv";
}

function emptySnapshot(date: string): DailySnapshot {
  return {
    date,
    sources: [],
    devices: [],
    popularPosts: [],
    inflowKeywords: [],
  };
}

function mapList(
  list: Record<string, unknown> | undefined,
  category: TrafficSource["category"],
  names: Record<string, { sourceCode: string; sourceName: string }>,
): TrafficSource[] {
  if (!list) return [];
  return Object.entries(list).map(([key, value]) => {
    const mapped = names[key] ?? { sourceCode: key, sourceName: key };
    return { category, ...mapped, views: num(value) };
  });
}

export function parseTistoryNetwork(networkJson: CaptureFile["networkJson"]): DailySnapshot[] {
  const rows: DailySnapshot[] = [];

  for (const item of networkJson) {
    const { url, body } = item;
    if (!url.includes("/manage/v2/statistics/blog/") || !isRecord(body)) continue;
    const data = body.data;

    if (url.includes("/trend?")) {
      if (!Array.isArray(data)) continue;
      const metric = metricFromUrl(url);
      for (const point of data) {
        if (!isRecord(point) || typeof point.timestamp !== "string") continue;
        const row = emptySnapshot(toKstDate(point.timestamp));
        if (metric === "uv") row.visitors = num(point.count);
        else row.views = num(point.count);
        rows.push(row);
      }
      continue;
    }

    if (url.includes("/inflow?")) {
      const date = startDateFromUrl(url);
      if (!date || !isRecord(data) || !isRecord(data.result)) continue;
      const result = data.result;
      const search = isRecord(result.searchEngine) ? (result.searchEngine.list as Record<string, unknown>) : undefined;
      const sns = isRecord(result.sns) ? (result.sns.list as Record<string, unknown>) : undefined;
      const ref = isRecord(result.ref) && isRecord(result.ref.list) ? result.ref.list : undefined;
      const device = isRecord(result.deviceType) && isRecord(result.deviceType.list) ? result.deviceType.list : undefined;
      const total = num(result.count);
      const pc = num(device?.pc);
      const mobile = num(device?.mobile);
      rows.push({
        ...emptySnapshot(date),
        views: total,
        sources: [
          ...mapList(search, "SEARCH", SEARCH_KEYS),
          ...mapList(sns, "SNS", SNS_KEYS),
          { category: "OTHER", sourceCode: "other", sourceName: "기타 유입", views: num(ref?.ref) },
          { category: "OTHER", sourceCode: "direct", sourceName: "직접 유입", views: num(ref?.refEtc) },
        ],
        devices: [
          { deviceType: "PC", views: pc, sharePct: total ? (pc / total) * 100 : 0 },
          { deviceType: "MOBILE", views: mobile, sharePct: total ? (mobile / total) * 100 : 0 },
        ],
      });
      continue;
    }

    if (url.endsWith("/count") || url.includes("/count?")) {
      if (!isRecord(data) || !isRecord(data.result)) continue;
      const stamp = typeof data.timestamp === "string" ? toKstDate(data.timestamp) : toKstDate(new Date());
      const yesterday = addKstDays(stamp, -1);
      const pv = isRecord(data.result.pv) ? data.result.pv : {};
      const uv = isRecord(data.result.uv) ? data.result.uv : {};
      rows.push({
        ...emptySnapshot(stamp),
        views: num(pv.today),
        visitors: num(uv.today),
        cumulativeViews: num(pv.total),
        cumulativeVisitors: num(uv.total),
      });
      rows.push({
        ...emptySnapshot(yesterday),
        views: num(pv.yesterday),
        visitors: num(uv.yesterday),
      });
      continue;
    }

    if (url.includes("/topEntry?")) {
      const date = startDateFromUrl(url);
      if (!date || !isRecord(data) || !Array.isArray(data.result)) continue;
      rows.push({
        ...emptySnapshot(date),
        popularPosts: data.result.filter(isRecord).map((post, index) => ({
          rank: index + 1,
          title: String(post.title ?? ""),
          url: typeof post.permalink === "string" ? post.permalink : undefined,
          views: num(post.count),
        })),
      });
      continue;
    }

    if (url.includes("/keyword?")) {
      const date = startDateFromUrl(url);
      if (!date || !isRecord(data) || !Array.isArray(data.result)) continue;
      rows.push({
        ...emptySnapshot(date),
        inflowKeywords: data.result.filter(isRecord).map((keyword, index) => ({
          rank: index + 1,
          keyword: String(keyword.keyword ?? keyword.query ?? keyword.name ?? ""),
          views: num(keyword.count),
        })),
      });
    }
  }

  return mergeSnapshots(rows);
}
