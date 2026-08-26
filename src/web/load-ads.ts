import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { root } from "../collectors/shared/chrome.js";
import { parseAdsCapture } from "../collectors/ads/parse.js";
import type { AdsCaptureFile, AdsReport } from "../collectors/ads/types.js";
import { defaultRangeKst, eachDay, emptyMetric } from "../collectors/ads/dates.js";

const ADS_PARSE_REV = 3;

let lastGood: AdsReport | null = null;
let cache: { rev: number; mtime: number; size: number; report: AdsReport; json: Buffer; gzip: Buffer } | null = null;

function emptyReport(note: string): AdsReport {
  const dateRange = defaultRangeKst();
  return {
    generatedAt: new Date().toISOString(),
    source: "crawl",
    dateRange,
    days: eachDay(...dateRange).map((date) => ({ date, naver: emptyMetric(), google: emptyMetric() })),
    campaigns: [],
    notes: [note],
    naver: { notes: [] },
    google: { notes: [] },
  };
}

function pack(report: AdsReport) {
  const json = Buffer.from(JSON.stringify(report));
  return { json, gzip: gzipSync(json) };
}

export function buildAdsFromLocalFiles(): AdsReport {
  const latest = join(root, "data/ads-raw/latest.json");
  if (!existsSync(latest)) {
    return lastGood ?? emptyReport("아직 수집본이 없습니다. npm run ads:crawl 을 실행하세요.");
  }
  const raw = JSON.parse(readFileSync(latest, "utf8")) as AdsCaptureFile;
  const report = parseAdsCapture(raw);
  report.file = "latest.json";
  lastGood = report;
  return report;
}

export async function loadAdsReport(): Promise<AdsReport> {
  return (await adsPayload()).report;
}

export async function adsPayload(): Promise<{ report: AdsReport; json: Buffer; gzip: Buffer }> {
  const { getAppDocument, putAppDocument } = await import("../lib/app-documents.js");
  try {
    const stored = await getAppDocument<AdsReport>("ads");
    if (stored) {
      if (cache && cache.rev === ADS_PARSE_REV && cache.mtime === Date.parse(stored.updatedAt)) return cache;
      lastGood = stored.payload;
      const packed = pack(stored.payload);
      cache = { rev: ADS_PARSE_REV, mtime: Date.parse(stored.updatedAt) || 0, size: packed.json.length, report: stored.payload, ...packed };
      return cache;
    }
    const report = buildAdsFromLocalFiles();
    await putAppDocument("ads", report).catch(() => undefined);
    const packed = pack(report);
    cache = { rev: ADS_PARSE_REV, mtime: Date.now(), size: packed.json.length, report, ...packed };
    return cache;
  } catch {
    const report = lastGood ?? emptyReport("수집 파일을 읽는 중입니다. 잠시 후 새로고침하세요.");
    const packed = pack(report);
    return { report, ...packed };
  }
}
