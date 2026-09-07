import type { BrowserContext, Page } from "playwright";
import { resolve } from "node:path";
import { loadNaverCatalog, saveNaverCatalog } from "./catalog.js";
import { adsWeeks, eachDay, type AdsWeek } from "./dates.js";
import { checkNaverExcel, excelHasTotalConversions, parseNaverKeywordXlsx, type NaverExcelKeyword } from "./excel.js";
import { ensureDir, root } from "./chrome.js";
import {
  clickNaverAllStatus,
  clickNaverKeywordDownload,
  ensureNaverKeywordDownload,
  ensureNaverTotalConversionsColumn,
  gotoQuiet,
  hasNaverGroupTraffic,
  listNaverCampaignGroups,
  listNaverCampaigns,
  naverGroupIdFromUrl,
  openFreshPage,
  readNaverGroupKeywordMaster,
  scrapeNaverGroupMarketBids,
  setNaverSameDay,
  sleep,
  type NaverCampaignGroupRow,
} from "./scrape.js";
import type { PlatformCapture } from "./types.js";

const ACCOUNT = process.env.NAVER_ADS_ACCOUNT_ID?.trim() || "1808636";
const BASE = `https://ads.naver.com/manage/ad-accounts/${ACCOUNT}/sa`;
const CAMPAIGNS =
  process.env.NAVER_ADS_CAMPAIGNS_URL?.trim() ||
  process.env.NAVER_SEARCHAD_URL?.trim() ||
  `${BASE}/campaigns-by/WEB_SITE`;

type GroupNode = {
  id: string;
  name: string;
  href: string;
  keywordsByDate: Record<string, unknown[]>;
  master?: Array<{
    name: string;
    onOff?: boolean;
    matchType?: string;
    bid?: number;
    marketBidVat?: number;
    marketBidPreset?: string;
    marketBidAt?: string;
  }>;
};
type CampNode = { id: string; name: string; href: string; status?: string; groups: GroupNode[] };

function toScraped(row: NaverExcelKeyword) {
  return {
    name: row.name,
    status: row.status,
    bid: row.bid,
    impressions: row.impressions,
    clicks: row.clicks,
    conversions: row.conversions,
    ctr: row.ctr,
    cpc: row.cpc,
    cost: row.cost,
    matchType: row.bidType,
    relevanceScore: row.relevanceScore,
    expectedCtr: row.expectedCtr,
    id: row.id,
    cells: [row.name, row.status, String(row.impressions), String(row.clicks), String(row.cost), String(row.conversions)],
  };
}

function groupHref(id: string) {
  return `${BASE}/adgroups/${id}`;
}

function seedFromCatalog(catalog: ReturnType<typeof loadNaverCatalog>): CampNode[] {
  const want = (process.env.NAVER_ADS_CAMPAIGN_ID || process.env.ADS_CAMPAIGN || "")
    .split(/[,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const items = want.length
    ? catalog.campaigns.filter((item) => want.includes(item.id) || want.includes(item.name))
    : catalog.campaigns;
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    href: `${BASE}/campaigns/${item.id}`,
    status: item.status,
    groups: [] as GroupNode[],
  }));
}

function crawlTargets(tree: CampNode[]) {
  return tree.filter((camp) => /QA\s*업체/i.test(camp.name) || !/중지|OFF/i.test(camp.status || ""));
}

async function refreshCatalogFromAccount(context: BrowserContext, notes: string[]): Promise<CampNode[]> {
  const catalog = loadNaverCatalog();
  const page = await openFreshPage(context, CAMPAIGNS);
  if (!page) {
    notes.push("캠페인 목록 페이지를 열지 못해 저장된 카탈로그만 사용합니다.");
    return seedFromCatalog(catalog);
  }
  await clickNaverAllStatus(page);
  await sleep(1200);
  const live = await listNaverCampaigns(page);
  await page.close().catch(() => undefined);
  if (!live.length) {
    notes.push("캠페인 목록을 읽지 못해 저장된 카탈로그만 사용합니다.");
    return seedFromCatalog(catalog);
  }
  const byId = new Map(catalog.campaigns.map((item) => [item.id, item]));
  for (const row of live) {
    byId.set(row.id, { id: row.id, name: row.name, status: row.status || byId.get(row.id)?.status });
  }
  const next = { campaigns: [...byId.values()], groups: catalog.groups };
  saveNaverCatalog(next);
  const names = live.map((row) => row.name).join(", ");
  notes.push(`네이버 캠페인 목록 ${live.length}개: ${names}`);
  console.log(`네이버 캠페인 목록 ${live.length}개: ${names}`);
  return seedFromCatalog(next);
}

function weekDoneLabel(week: AdsWeek) {
  const md = (ymd: string) => `${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일`;
  return `${week.label} (${md(week.from)} ~ ${md(week.to)})`;
}

function upsertGroup(camp: CampNode, row: NaverCampaignGroupRow) {
  const id = row.id || row.name;
  let target = camp.groups.find((group) => group.id === id || group.name === row.name);
  if (!target) {
    target = {
      id,
      name: row.name,
      href: row.href || (row.id ? groupHref(row.id) : ""),
      keywordsByDate: {},
    };
    camp.groups.push(target);
  } else {
    if (row.id) target.id = row.id;
    if (row.href) target.href = row.href;
    target.name = row.name;
  }
  return target;
}

async function backToCampaign(page: Page, camp: CampNode) {
  if (!(await gotoQuiet(page, camp.href))) {
    await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await sleep(1200);
  }
}

async function openGroupPage(page: Page, camp: CampNode, target: GroupNode) {
  const href = target.href || (target.id.startsWith("grp-") ? groupHref(target.id) : "");
  if (href) {
    await gotoQuiet(page, href);
    await sleep(800);
  }
  if (!/\/adgroups\//.test(page.url())) {
    const link = page.locator('a[href*="/adgroups/"]').filter({ hasText: target.name }).first();
    if ((await link.count()) > 0) {
      await link.click({ timeout: 5000 });
      await sleep(1500);
    }
  }
  const id = naverGroupIdFromUrl(page.url());
  if (id) {
    target.id = id;
    target.href = groupHref(id);
  }
  if (!/\/adgroups\//.test(page.url())) throw new Error("광고그룹 페이지 이동 실패");
  await ensureNaverKeywordDownload(page);
  await ensureNaverTotalConversionsColumn(page);
}

async function downloadOneDay(page: Page, camp: CampNode, target: GroupNode, date: string, excelDir: string) {
  await openGroupPage(page, camp, target);
  if (!(await setNaverSameDay(page, date))) throw new Error("그룹 페이지 날짜지정 실패");
  await sleep(800);
  const file = resolve(excelDir, `${camp.id}_${target.id}_${date}.xlsx`);
  await clickNaverKeywordDownload(page, file);
  let parsed = parseNaverKeywordXlsx(file);
  if (!excelHasTotalConversions(parsed)) {
    await ensureNaverTotalConversionsColumn(page, true);
    await clickNaverKeywordDownload(page, file);
    parsed = parseNaverKeywordXlsx(file);
  }
  const check = checkNaverExcel(parsed);
  target.keywordsByDate[date] = parsed.rows.map(toScraped);
  if (!check.ok) throw new Error(check.issues.join("; "));
  return check;
}

async function crawlCampaignWeeks(
  page: Page,
  camp: CampNode,
  weeks: AdsWeek[],
  excelDir: string,
  notes: string[],
  onSave: () => void,
) {
  console.log(`캠페인 ${camp.name} 상세에서 일별 그룹 표 → 노출·클릭 있는 그룹만`);
  for (const week of weeks) {
    const days = eachDay(week.from, week.to);
    let fail = 0;
    let collected = 0;
    const issues: string[] = [];
    const label = weekDoneLabel(week);
    console.log(`${camp.name} ${label} ${days.length}일 수집 시작`);
    for (const date of days) {
      await backToCampaign(page, camp);
      let dateOk = false;
      for (let attempt = 0; attempt < 2 && !dateOk; attempt++) {
        dateOk = await setNaverSameDay(page, date);
      }
      if (!dateOk) {
        fail += 1;
        issues.push(`${date}: 날짜지정 실패`);
        console.log(`  ${date} 날짜지정 실패`);
        onSave();
        continue;
      }
      await sleep(2200);
      const rows = await listNaverCampaignGroups(page);
      for (const row of rows) upsertGroup(camp, row);
      const active = rows.filter(hasNaverGroupTraffic);
      const skipped = rows.filter((row) => !hasNaverGroupTraffic(row));
      console.log(
        `  ${date} 날짜지정 — 그룹 ${rows.length}개 중 실적 있음 ${active.length}개` +
          (active.length
            ? ` [${active.map((row) => `${row.name} 노출${row.impressions}/클릭${row.clicks}`).join(", ")}]`
            : "") +
          (skipped.length
            ? ` / 스킵 ${skipped.map((row) => `${row.name} 노출${row.impressions}/클릭${row.clicks}`).join(", ")}`
            : ""),
      );
      if (!active.length) {
        onSave();
        continue;
      }
      for (const row of active) {
        const target = upsertGroup(camp, row);
        try {
          const check = await downloadOneDay(page, camp, target, date, excelDir);
          collected += 1;
          console.log(
            `  ${date} ${target.name} 키워드 ${check.keywords} 노출 ${check.impressions} 클릭 ${check.clicks} 전환 ${check.conversions}`,
          );
        } catch (error) {
          fail += 1;
          const message = error instanceof Error ? error.message : String(error);
          issues.push(`${date} ${target.name}: ${message}`);
          console.log(`  ${date} ${target.name} 실패 — ${message}`);
        }
        await backToCampaign(page, camp);
        onSave();
      }
    }
    if (fail === 0) {
      const line = `${camp.name} ${label} 정상 수집 완료` + (collected ? "" : " (해당 기간 노출·클릭 그룹 없음)");
      notes.push(line);
      console.log(line);
    } else {
      const line = `${camp.name} ${label} 점검 실패 — ${issues[0] ?? `실패 ${fail}건`}`;
      notes.push(line);
      console.log(line);
    }
    onSave();
  }
}

async function enrichNaverGroups(page: Page, camp: CampNode, notes: string[]) {
  for (const group of camp.groups) {
    try {
      await openGroupPage(page, camp, group);
      const master = await readNaverGroupKeywordMaster(page);
      const snap = await scrapeNaverGroupMarketBids(page);
      const at = new Date().toISOString();
      group.master = master.map((row) => ({
        ...row,
        marketBidVat: snap.byName[row.name],
        marketBidPreset: snap.preset || undefined,
        marketBidAt: snap.byName[row.name] != null ? at : undefined,
      }));
      if (!group.master.length) notes.push(`${camp.name} / ${group.name} 키워드 ON/OFF 표를 못 읽었습니다.`);
      else console.log(`  ${group.name} 키워드 ${group.master.length}개 (ON ${group.master.filter((row) => row.onOff).length})`);
    } catch (error) {
      notes.push(`${camp.name} / ${group.name} 키워드 마스터 실패 — ${error instanceof Error ? error.message : error}`);
    }
  }
}

export async function crawlNaverAds(
  context: BrowserContext,
  dateRange: [string, string],
  onTree?: (tree: unknown[], notes: string[]) => void,
): Promise<PlatformCapture> {
  const notes: string[] = [];
  const tree = await refreshCatalogFromAccount(context, notes);
  const weeks = adsWeeks(...dateRange);
  const onSave = () => onTree?.(tree, notes);
  const excelDir = resolve(root, "data/ads-raw/naver-excel");
  ensureDir(excelDir);

  notes.push("캠페인 상세에서 하루 기간을 맞춘 뒤 실적 있는 그룹은 엑셀을 받고, 모든 그룹에서 ON/OFF·0건 키워드를 읽습니다.");
  const targets = crawlTargets(tree);
  console.log(`네이버 캠페인 ${targets.length}개 (목록 ${tree.length}개), ${weeks.length}주 (${dateRange[0]} ~ ${dateRange[1]})`);

  for (const camp of targets) {
    const page = await openFreshPage(context, camp.href);
    if (!page) {
      notes.push(`캠페인 상세 열기 실패 ${camp.name}`);
      console.log(`캠페인 상세 열기 실패 ${camp.name}`);
      continue;
    }
    await crawlCampaignWeeks(page, camp, weeks, excelDir, notes, onSave);
    await enrichNaverGroups(page, camp, notes);
    await page.close().catch(() => undefined);
  }

  return {
    pageUrl: CAMPAIGNS,
    loggedIn: true,
    notes,
    networkJson: [{ url: "scrape://naver-tree", body: tree }],
    tables: [],
  };
}

export function mergeNaverTrees(prev: unknown[] | undefined, next: unknown[]): CampNode[] {
  const camps = new Map<string, CampNode>();
  for (const camp of (prev || []) as CampNode[]) {
    camps.set(camp.id, {
      ...camp,
      groups: camp.groups.map((group) => ({ ...group, keywordsByDate: { ...group.keywordsByDate } })),
    });
  }
  for (const camp of next as CampNode[]) {
    const old = camps.get(camp.id);
    if (!old) {
      camps.set(camp.id, camp);
      continue;
    }
    old.name = camp.name || old.name;
    old.href = camp.href || old.href;
    for (const group of camp.groups) {
      const found = old.groups.find((item) => item.id === group.id || item.name === group.name);
      if (!found) {
        old.groups.push(group);
        continue;
      }
      if (group.id) found.id = group.id;
      found.name = group.name || found.name;
      found.href = group.href || found.href;
      found.keywordsByDate = { ...found.keywordsByDate, ...group.keywordsByDate };
      if (group.master?.length) found.master = group.master;
    }
  }
  return [...camps.values()];
}
