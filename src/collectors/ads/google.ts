import type { BrowserContext } from "playwright";
import { resolve } from "node:path";
import { eachDay } from "./dates.js";
import { parseGoogleKeywordCsv } from "./excel.js";
import { ensureDir, root } from "./chrome.js";
import { clickGoogleKeywordDownload, openFreshPage, setGoogleSameDay, sleep } from "./scrape.js";
import type { PlatformCapture } from "./types.js";

const KEYWORDS =
  process.env.GOOGLE_ADS_KEYWORDS_URL?.trim() ||
  "https://ads.google.com/aw/keywords?ocid=318165752&workspaceId=0&authuser=0";

export function mergeGoogleByDate(
  prev: Record<string, unknown[]> | undefined,
  next: Record<string, unknown[]>,
) {
  return { ...(prev ?? {}), ...next };
}

export async function crawlGoogleAds(
  context: BrowserContext,
  dateRange: [string, string],
  onByDate?: (byDate: Record<string, unknown[]>, notes: string[]) => void,
): Promise<PlatformCapture> {
  const notes: string[] = [];
  const byDate: Record<string, unknown[]> = {};
  const csvDir = resolve(root, "data/ads-raw/google-csv");
  ensureDir(csvDir);

  const page = await openFreshPage(context, KEYWORDS);
  if (!page) {
    notes.push("구글 키워드 탭을 열지 못했습니다.");
    return {
      pageUrl: KEYWORDS,
      loggedIn: false,
      notes,
      networkJson: [{ url: "scrape://google-keywords", body: byDate }],
      tables: [],
    };
  }
  notes.push(`키워드 목록 ${page.url()}`);
  let saved = 0;
  let failed = 0;

  for (const date of eachDay(...dateRange)) {
    const ok = await Promise.race([
      setGoogleSameDay(page, date),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 40_000)),
    ]);
    console.log(`구글 ${date} 날짜지정 ${ok ? "OK" : "실패"}`);
    if (!ok) {
      failed += 1;
      continue;
    }
    await sleep(1200);
    const file = resolve(csvDir, `${date}.csv`);
    try {
      await clickGoogleKeywordDownload(page, file);
      const parsed = parseGoogleKeywordCsv(file);
      if (!parsed.headers.some((header) => /키워드/.test(header))) {
        throw new Error("검색 키워드 보고서 헤더가 없습니다");
      }
      const next = parsed.rows.map((row) => ({
        name: row.name,
        matchType: row.matchType,
        campaign: row.campaign,
        group: row.group,
        impressions: row.impressions,
        clicks: row.clicks,
        ctr: row.ctr,
        cpc: row.cpc,
        cost: row.cost,
        conversions: row.conversions,
        status: row.status || row.keywordStatus,
        headers: parsed.headers,
        cells: [
          row.name,
          row.matchType,
          row.campaign,
          row.group,
          String(row.impressions),
          String(row.clicks),
          String(row.cost),
          String(row.conversions),
        ],
      }));
      byDate[date] = next;
      saved += 1;
      const imp = parsed.rows.reduce((sum, row) => sum + row.impressions, 0);
      const clk = parsed.rows.reduce((sum, row) => sum + row.clicks, 0);
      const conv = parsed.rows.reduce((sum, row) => sum + row.conversions, 0);
      console.log(`구글 ${date} 키워드 ${parsed.rows.length} 노출 ${imp} 클릭 ${clk} 전환 ${conv}`);
      onByDate?.(byDate, notes);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      notes.push(`${date} 구글 다운로드 실패: ${message}`);
      console.log(`구글 ${date} 실패 — ${message}`);
    }
  }

  notes.push(`구글 저장 ${saved}일, 실패 ${failed}일`);

  return {
    pageUrl: KEYWORDS,
    loggedIn: true,
    notes,
    networkJson: [{ url: "scrape://google-keywords", body: byDate }],
    tables: [],
  };
}
