import type { BrowserContext } from "playwright";
import { loadNaverCatalog } from "./catalog.js";
import { eachDay } from "./dates.js";
import { loadLatestCapture } from "./save.js";
import {
  clickNaverAllStatus,
  colIndex,
  numCell,
  openFreshPage,
  readGrid,
  setNaverSameDay,
  sleep,
  type Grid,
} from "./scrape.js";
import type { PlatformCapture } from "./types.js";

const ACCOUNT = process.env.NAVER_ADS_ACCOUNT_ID?.trim() || "1808636";
const BASE = `https://ads.naver.com/manage/ad-accounts/${ACCOUNT}/sa`;
const CAMPAIGNS =
  process.env.NAVER_ADS_CAMPAIGNS_URL?.trim() ||
  process.env.NAVER_SEARCHAD_URL?.trim() ||
  `${BASE}/campaigns-by/WEB_SITE`;

type GroupNode = { id: string; name: string; href: string; keywordsByDate: Record<string, unknown[]> };
type CampNode = { id: string; name: string; href: string; groups: GroupNode[] };

function cell(grid: Grid, row: Grid["rows"][number], ...needles: RegExp[]) {
  const idx = colIndex(grid.headers, ...needles);
  if (idx < 0) return "";
  return row.cells[idx] ?? "";
}

function keywordName(grid: Grid, row: Grid["rows"][number]) {
  const fromHeader = cell(grid, row, /^키워드$/);
  if (fromHeader) return fromHeader.replace(/\[.*?\]/g, " ").replace(/\s+/g, " ").trim();
  for (const value of row.cells) {
    const text = value.replace(/\[.*?\]/g, " ").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (/^(on|off)$/i.test(text)) continue;
    if (/^[\d.,%원+\-/\s]+$/.test(text)) continue;
    if (/노출가능|노출제한|검사중|입찰|기본|평균|개선필요|합계|결과|선택/.test(text)) continue;
    if (/^(키워드|상태|캠페인|광고그룹)$/.test(text)) continue;
    return text;
  }
  return "";
}

function metrics(grid: Grid, row: Grid["rows"][number]) {
  const impressions = numCell(cell(grid, row, /노출수|^노출$/));
  const clicks = numCell(cell(grid, row, /^클릭수$|^클릭$/));
  const cpc = numCell(cell(grid, row, /평균cpc|평균CPC|cpc/i));
  const costRaw = numCell(cell(grid, row, /비용|지출|소진/));
  return {
    impressions,
    clicks,
    ctr: numCell(cell(grid, row, /클릭률|ctr/i)),
    cpc,
    cost: costRaw || Math.round(clicks * cpc),
    status: cell(grid, row, /상태/),
    bid: numCell(cell(grid, row, /입찰/)),
    name: keywordName(grid, row),
    qualityScore: cell(grid, row, /품질지수|품질/),
    relevanceScore: cell(grid, row, /광고연관|연관지수|연관/),
    expectedCtr: cell(grid, row, /클릭기대|기대지수|기대/),
    headers: grid.headers,
  };
}

function seedTree(): CampNode[] {
  const prev = loadLatestCapture()?.naver.networkJson.find((item) => String(item.url).includes("scrape://naver-tree"))?.body;
  const tree: CampNode[] = [];
  if (Array.isArray(prev)) {
    for (const camp of prev as CampNode[]) {
      tree.push({
        id: camp.id,
        name: camp.name,
        href: camp.href || `${BASE}/campaigns/${camp.id}`,
        groups: (camp.groups || []).map((group) => ({
          id: group.id,
          name: group.name,
          href: group.href || `${BASE}/adgroups/${group.id}`,
          keywordsByDate: { ...(group.keywordsByDate || {}) },
        })),
      });
    }
  }
  const catalog = loadNaverCatalog();
  const mo = tree.find((c) => c.id === "cmp-a001-01-000000010974395") || {
    id: "cmp-a001-01-000000010974395",
    name: "T-ASSI 파워링크 통합_MO",
    href: `${BASE}/campaigns/cmp-a001-01-000000010974395`,
    groups: [],
  };
  if (!tree.some((c) => c.id === mo.id)) tree.push(mo);
  for (const item of catalog.campaigns) {
    let camp = tree.find((c) => c.id === item.id);
    if (!camp) {
      camp = { id: item.id, name: item.name, href: `${BASE}/campaigns/${item.id}`, groups: [] };
      tree.push(camp);
    } else if (item.name) camp.name = item.name;
  }
  for (const item of catalog.groups) {
    if (mo.groups.some((g) => g.id === item.id)) continue;
    mo.groups.push({
      id: item.id,
      name: item.name,
      href: `${BASE}/adgroups/${item.id}`,
      keywordsByDate: {},
    });
  }
  return tree;
}

function groupHref(id: string) {
  return `${BASE}/adgroups/${id}`;
}

export async function crawlNaverAds(
  context: BrowserContext,
  dateRange: [string, string],
  onTree?: (tree: unknown[], notes: string[]) => void,
): Promise<PlatformCapture> {
  const tree = seedTree();
  const days = eachDay(...dateRange);
  const notes: string[] = [];
  const onSave = () => onTree?.(tree, notes);

  const scrapeGroupPage = async (page: import("playwright").Page, group: GroupNode) => {
    await Promise.race([clickNaverAllStatus(page), sleep(5000)]);
    for (const date of days) {
      const ok = await Promise.race([
        setNaverSameDay(page, date),
        sleep(25_000).then(() => false),
      ]);
      console.log(`  그룹 ${group.name || group.id} ${date} 날짜지정 ${ok ? "OK" : "실패"}`);
      if (!ok) continue;
      let grid = await readGrid(page);
      const gridImp = (g: Grid) =>
        g.rows.reduce((sum, row) => {
          const fromHeader = numCell(cell(g, row, /노출수|^노출$/));
          return sum + (fromHeader || metrics(g, row).impressions || 0);
        }, 0);
      if (gridImp(grid) === 0) {
        await sleep(2500);
        grid = await readGrid(page);
      }
      const next = grid.rows.map((row) => ({
        ...metrics(grid, row),
        href: row.href,
        cells: row.cells,
      }));
      const prev = group.keywordsByDate[date];
      const prevImp = Array.isArray(prev)
        ? prev.reduce((sum, row) => sum + (Number((row as { impressions?: number }).impressions) || 0), 0)
        : 0;
      const nextImp = next.reduce((sum, row) => sum + (row.impressions || 0), 0);
      if (prevImp > nextImp) {
        console.log(`  그룹 ${group.name || group.id} ${date} 기존 노출 ${prevImp} 유지 (새 수집 ${nextImp})`);
      } else {
        group.keywordsByDate[date] = next;
        console.log(`  그룹 ${group.name || group.id} ${date} 키워드 ${grid.rows.length}행 노출 ${nextImp}`);
      }
      onSave();
    }
  };

  notes.push("기존 그룹 ID로 일자별 키워드를 수집합니다.");

  const preferred = [
    "grp-a001-01-000000071884521",
    "grp-a001-01-000000071884522",
    "grp-a001-01-000000071884523",
    "grp-a001-01-000000071884524",
    "grp-a001-01-000000071884526",
    "grp-a001-01-000000071868540",
    "grp-a001-01-000000071868541",
    "grp-a001-01-000000071869322",
    "grp-a001-01-000000071874027",
    "grp-a001-01-000000071872756",
  ];
  const jobs: GroupNode[] = [];
  const seen = new Set<string>();
  const take = (group: GroupNode) => {
    if (seen.has(group.id)) return;
    seen.add(group.id);
    jobs.push(group);
  };
  for (const id of preferred) {
    const group = tree.flatMap((c) => c.groups).find((g) => g.id === id);
    if (group) take(group);
    else take({ id, name: id, href: groupHref(id), keywordsByDate: {} });
  }
  for (const camp of tree) for (const group of camp.groups) take(group);

  notes.push(`광고그룹 ${jobs.length}개 × ${days.length}일`);
  console.log(`네이버 광고그룹 ${jobs.length}개, ${days[0]} ~ ${days[days.length - 1]}`);

  for (const group of jobs) {
    let camp = tree.find((c) => c.groups.some((g) => g.id === group.id));
    if (!camp) {
      camp = tree.find((c) => c.id === "cmp-a001-01-000000010974395") || tree[0];
      camp.groups.push(group);
    }
    const target = camp.groups.find((g) => g.id === group.id) || group;
    const page = await openFreshPage(context, target.href || groupHref(target.id));
    if (!page) {
      notes.push(`그룹 열기 실패 ${target.id}`);
      console.log(`그룹 열기 실패 ${target.id}`);
      continue;
    }
    try {
      await scrapeGroupPage(page, target);
    } catch (error) {
      notes.push(`그룹 수집 오류 ${target.id}: ${error instanceof Error ? error.message : error}`);
      console.log(`그룹 수집 오류 ${target.id}`);
    }
    onSave();
  }

  return {
    pageUrl: CAMPAIGNS,
    loggedIn: true,
    notes,
    networkJson: [{ url: "scrape://naver-tree", body: tree }],
    tables: [],
  };
}
