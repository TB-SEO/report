import type { BrowserContext } from "playwright";
import { eachDay } from "./dates.js";
import { colIndex, numCell, openFreshPage, readGrid, setGoogleSameDay } from "./scrape.js";
import type { PlatformCapture } from "./types.js";

const KEYWORDS =
  process.env.GOOGLE_ADS_KEYWORDS_URL?.trim() ||
  "https://ads.google.com/aw/keywords?ocid=318165752&workspaceId=0&authuser=0";

function stripHeader(text: string) {
  return text.replace(/help_outline|정보/gi, "").replace(/\s+/g, " ").trim();
}

function gridFingerprint(rows: unknown[]) {
  return JSON.stringify(
    rows.map((row) => {
      const rec = row as { cells?: string[]; name?: string; impressions?: number; clicks?: number; cost?: number };
      return rec.cells?.length ? rec.cells : [rec.name, rec.impressions, rec.clicks, rec.cost];
    }),
  );
}

export async function crawlGoogleAds(
  context: BrowserContext,
  dateRange: [string, string],
  onByDate?: (byDate: Record<string, unknown[]>, notes: string[]) => void,
): Promise<PlatformCapture> {
  const notes: string[] = [];
  const byDate: Record<string, unknown[]> = {};

  const existing = context.pages().find((p) => /ads\.google\.com\/aw/i.test(p.url()));
  const page = existing ?? (await openFreshPage(context, KEYWORDS));
  if (existing) {
    await existing.bringToFront().catch(() => undefined);
    console.log(`구글은 열린 탭을 씁니다 ${existing.url()}`);
  }
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
  let skippedCopy = 0;
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
    const grid = await readGrid(page);
    grid.headers = grid.headers.map(stripHeader);
    if (!grid.headers.some((header) => /키워드/.test(header))) {
      failed += 1;
      console.log(`구글 ${date} 키워드 표가 아니라 건너뜁니다`);
      await page.keyboard.press("Escape").catch(() => undefined);
      continue;
    }
    const nameIdx = colIndex(grid.headers, /^키워드$/, /keyword/i);
    const typeIdx = colIndex(grid.headers, /검색유형/, /match/i);
    const campIdx = colIndex(grid.headers, /^캠페인$/, /campaign/i);
    const groupIdx = colIndex(grid.headers, /^광고그룹$/, /ad group/i, /adgroup/i);
    const impIdx = colIndex(grid.headers, /^노출수$/, /impr/i);
    const clkIdx = colIndex(grid.headers, /^클릭수$/, /^clicks$/i);
    const ctrIdx = colIndex(grid.headers, /클릭률|^ctr$/i);
    const cpcIdx = colIndex(grid.headers, /평균cpc|^cpc$/i);
    const costIdx = colIndex(grid.headers, /^비용$/, /^cost$/i);
    const statusIdx = colIndex(grid.headers, /^상태$/, /status/i);
    const sample = grid.rows[0]?.cells || [];
    const shift = nameIdx >= 0 && !(sample[nameIdx] || "").trim() && (sample[nameIdx + 1] || "").trim() ? 1 : 0;
    const at = (cells: string[], idx: number) => (idx < 0 ? "" : cells[idx + shift] || "");
    const next = grid.rows.map((row) => ({
      name: at(row.cells, nameIdx) || row.cells[0],
      matchType: at(row.cells, typeIdx),
      campaign: at(row.cells, campIdx),
      group: at(row.cells, groupIdx),
      impressions: numCell(at(row.cells, impIdx)),
      clicks: numCell(at(row.cells, clkIdx)),
      ctr: numCell(at(row.cells, ctrIdx)),
      cpc: numCell(at(row.cells, cpcIdx)),
      cost: numCell(at(row.cells, costIdx)),
      status: at(row.cells, statusIdx),
      cells: row.cells,
      headers: grid.headers,
    }));
    const fp = gridFingerprint(next);
    const hasMetrics = next.some((row) => (row.impressions || 0) + (row.clicks || 0) + (row.cost || 0) > 0);
    const copiedFrom = Object.keys(byDate)
      .sort()
      .find((other) => other !== date && gridFingerprint(byDate[other] || []) === fp);
    if (copiedFrom && hasMetrics) {
      skippedCopy += 1;
      console.log(`구글 ${date} 표가 ${copiedFrom}와 같아 저장하지 않습니다`);
      notes.push(`${date} 구글 표가 ${copiedFrom}와 같아 건너뜀`);
      continue;
    }
    byDate[date] = next;
    saved += 1;
    console.log(`구글 ${date} 키워드 ${grid.rows.length}행`);
    onByDate?.(byDate, notes);
  }

  notes.push(`구글 저장 ${saved}일, 날짜실패 ${failed}일, 복사 건너뜀 ${skippedCopy}일`);

  return {
    pageUrl: KEYWORDS,
    loggedIn: true,
    notes,
    networkJson: [{ url: "scrape://google-keywords", body: byDate }],
    tables: [],
  };
}
