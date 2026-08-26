import type { DailySnapshot, TrafficSource } from "./types.js";

const SOURCE_LABELS: Array<{
  label: string;
  category: TrafficSource["category"];
  sourceCode: string;
  sourceName: string;
}> = [
  { label: "네이버 검색", category: "SEARCH", sourceCode: "naver", sourceName: "네이버 검색" },
  { label: "다음 검색", category: "SEARCH", sourceCode: "daum", sourceName: "다음 검색" },
  { label: "구글 검색", category: "SEARCH", sourceCode: "google", sourceName: "구글 검색" },
  { label: "줌 검색", category: "SEARCH", sourceCode: "zum", sourceName: "줌 검색" },
  { label: "빙 검색", category: "SEARCH", sourceCode: "bing", sourceName: "빙 검색" },
  { label: "야후 검색", category: "SEARCH", sourceCode: "yahoo", sourceName: "야후 검색" },
  { label: "기타 검색", category: "SEARCH", sourceCode: "search_other", sourceName: "기타 검색" },
  { label: "카카오톡", category: "SNS", sourceCode: "kakaotalk", sourceName: "카카오톡" },
  { label: "카카오스토리", category: "SNS", sourceCode: "kakaostory", sourceName: "카카오스토리" },
  { label: "페이스북", category: "SNS", sourceCode: "facebook", sourceName: "페이스북" },
  { label: "트위터", category: "SNS", sourceCode: "twitter", sourceName: "트위터" },
  { label: "유튜브", category: "SNS", sourceCode: "youtube", sourceName: "유튜브" },
  { label: "인스타그램", category: "SNS", sourceCode: "instagram", sourceName: "인스타그램" },
  { label: "기타 SNS", category: "SNS", sourceCode: "sns_other", sourceName: "기타 SNS" },
  { label: "직접 유입", category: "OTHER", sourceCode: "direct", sourceName: "직접 유입" },
  { label: "기타 유입", category: "OTHER", sourceCode: "other", sourceName: "기타 유입" },
];

function toNumber(value: string | number | undefined | null): number | undefined {
  if (value == null) return undefined;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function parseHeaderDate(text: string): string | undefined {
  const match = text.match(/(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})/);
  if (!match) return undefined;
  const [, y, m, d] = match;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function labeledCount(text: string, label: string): number | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escaped}\\s*([\\d,]+)`));
  return match ? toNumber(match[1]) : undefined;
}

/** 티스토리 통계 화면 텍스트에서 선택한 날짜의 유입/디바이스를 뽑는다. */
export function parseTistoryPageText(text: string): DailySnapshot | null {
  const date = parseHeaderDate(text);
  if (!date) return null;

  const views =
    labeledCount(text, "일간조회수") ??
    labeledCount(text, "조회수");
  const visitors = labeledCount(text, "일간방문자") ?? labeledCount(text, "방문자");

  const sources: TrafficSource[] = [];
  for (const item of SOURCE_LABELS) {
    const viewsCount = labeledCount(text, item.label);
    if (viewsCount == null) continue;
    sources.push({
      category: item.category,
      sourceCode: item.sourceCode,
      sourceName: item.sourceName,
      views: viewsCount,
    });
  }

  const pc = text.match(/PC\s*([\d.]+)\s*%/i);
  const mobile = text.match(/모바일\s*([\d.]+)\s*%/);

  return {
    date,
    views,
    visitors,
    sources,
    devices: [
      pc ? { deviceType: "PC" as const, sharePct: Number(pc[1]) } : null,
      mobile ? { deviceType: "MOBILE" as const, sharePct: Number(mobile[1]) } : null,
    ].filter((row): row is NonNullable<typeof row> => row != null),
    popularPosts: [],
    inflowKeywords: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function lookLikeDate(value: unknown): string | undefined {
  if (typeof value === "number" && value > 20100101 && value < 21001231) {
    const s = String(value);
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  if (typeof value !== "string") return undefined;
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const dotted = value.match(/^(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})$/);
  if (dotted) {
    return `${dotted[1]}-${dotted[2].padStart(2, "0")}-${dotted[3].padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return undefined;
}

function pickMetric(row: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const found = Object.keys(row).find((k) => k.toLowerCase() === key.toLowerCase());
    if (found) {
      const n = toNumber(row[found] as string | number);
      if (n != null) return n;
    }
  }
  return undefined;
}

/** 네트워크 JSON에서 날짜별 조회수/방문자 시계열을 최대한 찾아낸다. */
export function extractSeriesFromJson(payload: unknown): DailySnapshot[] {
  const found: DailySnapshot[] = [];

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      const rows = node.filter(isRecord);
      const dated = rows
        .map((row) => {
          const date =
            lookLikeDate(row.datetime) ??
            lookLikeDate(row.date) ??
            lookLikeDate(row.statDate) ??
            lookLikeDate(row.stdDate) ??
            lookLikeDate(row.day) ??
            lookLikeDate(row.dt);
          if (!date) return null;
          return {
            date,
            views: pickMetric(row, ["pv", "pvs", "views", "viewCnt", "visitCnt", "count", "cnt", "value"]),
            visitors: pickMetric(row, ["uv", "uvs", "visitors", "visitorCnt", "unique"]),
            sources: [],
            devices: [],
            popularPosts: [],
            inflowKeywords: [],
          } satisfies DailySnapshot;
        })
        .filter((row): row is DailySnapshot => row != null);

      if (dated.length >= 2) found.push(...dated);
      for (const item of node) visit(item);
      return;
    }

    if (!isRecord(node)) return;
    for (const value of Object.values(node)) visit(value);
  };

  visit(payload);
  return found;
}

export function mergeSnapshots(rows: DailySnapshot[]): DailySnapshot[] {
  const byDate = new Map<string, DailySnapshot>();
  for (const row of rows) {
    const current = byDate.get(row.date);
    if (!current) {
      byDate.set(row.date, {
        ...row,
        sources: [...row.sources],
        devices: [...row.devices],
        popularPosts: [...row.popularPosts],
        inflowKeywords: [...row.inflowKeywords],
      });
      continue;
    }
    current.views = row.views ?? current.views;
    current.visitors = row.visitors ?? current.visitors;
    current.cumulativeViews = row.cumulativeViews ?? current.cumulativeViews;
    current.cumulativeVisitors = row.cumulativeVisitors ?? current.cumulativeVisitors;
    if (row.sources.length) current.sources = row.sources;
    if (row.devices.length) current.devices = row.devices;
    if (row.popularPosts.length) current.popularPosts = row.popularPosts;
    if (row.inflowKeywords.length) current.inflowKeywords = row.inflowKeywords;
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
