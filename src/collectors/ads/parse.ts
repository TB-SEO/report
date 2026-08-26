import type { AdsCaptureFile, AdsReport, CampaignRow, DailyPoint, DayTuple, GroupRow, KeywordRow, Metric, Platform, PlatformCapture } from "./types.js";
import { defaultRangeKst, eachDay, emptyMetric, sumMetrics } from "./dates.js";
import { loadNaverCatalog } from "./catalog.js";

type Rec = Record<string, unknown>;

function asRec(value: unknown): Rec | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : null;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[,원%\s]/g, "");
    if (!cleaned) return undefined;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function str(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

function pick(row: Rec, keys: string[]): unknown {
  const lower = new Map(Object.keys(row).map((key) => [key.toLowerCase(), row[key]]));
  for (const key of keys) {
    if (key in row && row[key] != null && row[key] !== "") return row[key];
    const found = lower.get(key.toLowerCase());
    if (found != null && found !== "") return found;
  }
  return undefined;
}

function metricFrom(row: Rec): Metric {
  const impressions = num(pick(row, ["impressions", "impCnt", "imp", "impression", "metrics.impressions"])) ?? 0;
  const clicks = num(pick(row, ["clicks", "clkCnt", "clk", "click", "metrics.clicks"])) ?? 0;
  const cost = num(pick(row, ["cost", "salesAmt", "spend", "costMicros", "metrics.cost_micros", "totalCost"])) ?? 0;
  const costWon = cost > 10_000_000 ? Math.round(cost / 1_000_000) : cost;
  const ctrRaw = num(pick(row, ["ctr", "clkRt"]));
  const cpcRaw = num(pick(row, ["cpc", "avgCpc", "averageCpc", "metrics.average_cpc"]));
  return {
    impressions,
    clicks,
    cost: costWon,
    ctr: ctrRaw != null ? (ctrRaw > 1 ? ctrRaw : ctrRaw * 100) : impressions ? (clicks / impressions) * 100 : 0,
    cpc: cpcRaw ?? (clicks ? costWon / clicks : 0),
  };
}

function looksLikeKeyword(row: Rec) {
  return Boolean(
    pick(row, ["keyword", "keywordText", "query", "nccKeywordId", "criterionId"]) &&
      (pick(row, ["impressions", "impCnt", "clicks", "clkCnt", "bidAmt", "cpcBidMicros"]) != null ||
        pick(row, ["nccKeywordId", "keywordId"])),
  );
}

function looksLikeGroup(row: Rec) {
  return Boolean(pick(row, ["nccAdgroupId", "adgroupId", "adGroupId", "ad_group.id"]) || (pick(row, ["adgroupNm", "adGroupName"]) && pick(row, ["nccCampaignId", "campaignId"])));
}

function looksLikeCampaign(row: Rec) {
  return Boolean(pick(row, ["nccCampaignId", "campaignId", "campaign.id"]) || (pick(row, ["campaignNm", "campaignName"]) && pick(row, ["dailyBudget", "budget"])));
}

function walkArrays(node: unknown, found: Rec[][], depth = 0) {
  if (depth > 12 || node == null) return;
  if (Array.isArray(node)) {
    const objects = node.filter((item) => asRec(item)) as Rec[];
    if (objects.length >= 1) found.push(objects);
    for (const item of node) walkArrays(item, found, depth + 1);
    return;
  }
  const rec = asRec(node);
  if (!rec) return;
  for (const value of Object.values(rec)) walkArrays(value, found, depth + 1);
}

function dateOf(row: Rec): string | undefined {
  const raw = pick(row, ["date", "statDt", "day", "datetime", "reportDate", "segments.date"]);
  const text = str(raw);
  if (!text) return undefined;
  const iso = text.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const compact = text.replace(/\D/g, "");
  if (compact.length === 8) return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  return undefined;
}

function keywordFrom(row: Rec, platform: Platform, index: number): KeywordRow {
  const name = str(pick(row, ["keyword", "keywordText", "query", "name", "criterion"])) || `키워드 ${index + 1}`;
  const id = str(pick(row, ["nccKeywordId", "keywordId", "id", "criterionId"])) || `${platform}-kw-${index}-${name}`;
  return {
    id,
    name,
    matchType: str(pick(row, ["matchType", "keywordMatchType", "type"])),
    status: str(pick(row, ["status", "userStatus", "nccStatus"])),
    bid: num(pick(row, ["bidAmt", "bid", "cpcBidMicros", "cpcBid"])),
    qualityScore: str(pick(row, ["qi", "qualityIndex", "qualityScore"])),
    expectedCtr: str(pick(row, ["clkExp", "expectedCtr"])),
    ...metricFrom(row),
  };
}

function groupFrom(row: Rec, platform: Platform, index: number, keywords: KeywordRow[]): GroupRow {
  const name = str(pick(row, ["name", "adgroupNm", "adGroupName"])) || `그룹 ${index + 1}`;
  const id = str(pick(row, ["nccAdgroupId", "adgroupId", "adGroupId", "id"])) || `${platform}-grp-${index}-${name}`;
  const metrics = keywords.length ? sumMetrics(keywords) : metricFrom(row);
  return {
    id,
    name,
    status: str(pick(row, ["status", "userStatus"])),
    bid: num(pick(row, ["bidAmt", "bid", "cpcBid"])),
    keywords,
    ...metrics,
  };
}

function campaignFrom(row: Rec, platform: Platform, index: number, groups: GroupRow[]): CampaignRow {
  const name = str(pick(row, ["name", "campaignNm", "campaignName"])) || `캠페인 ${index + 1}`;
  const id = str(pick(row, ["nccCampaignId", "campaignId", "id"])) || `${platform}-camp-${index}-${name}`;
  const metrics = groups.length ? sumMetrics(groups) : metricFrom(row);
  return {
    id,
    platform,
    name,
    status: str(pick(row, ["status", "userStatus"])),
    channel: str(pick(row, ["campaignTp", "channelType", "advertisingChannelType"])) || "검색",
    dailyBudget: num(pick(row, ["dailyBudget", "budget", "amount"])),
    groups,
    ...metrics,
  };
}

function flattenKeywordsFromTables(tables: string[][], platform: Platform): KeywordRow[] {
  if (!tables.length) return [];
  const header = tables[0].map((cell) => cell.replace(/\s+/g, "").toLowerCase());
  const nameIdx = header.findIndex((cell) => /키워드|keyword/.test(cell));
  const impIdx = header.findIndex((cell) => /노출/.test(cell));
  const clkIdx = header.findIndex((cell) => /클릭수|clicks/.test(cell));
  const ctrIdx = header.findIndex((cell) => /클릭률|ctr/.test(cell));
  const cpcIdx = header.findIndex((cell) => /cpc|평균/.test(cell));
  const bidIdx = header.findIndex((cell) => /입찰/.test(cell));
  const statusIdx = header.findIndex((cell) => /상태|status/.test(cell));
  if (nameIdx < 0) return [];
  const keywords: KeywordRow[] = [];
  for (let i = 1; i < tables.length; i++) {
    const row = tables[i];
    const name = row[nameIdx]?.replace(/\[.*?\]/g, "").trim();
    if (!name || /결과|합계|total/i.test(name)) continue;
    const impressions = num(row[impIdx]) ?? 0;
    const clicks = num(row[clkIdx]) ?? 0;
    const cpc = num(row[cpcIdx]) ?? 0;
    keywords.push({
      id: `${platform}-table-${i}-${name}`,
      name,
      status: row[statusIdx],
      bid: num(row[bidIdx]),
      impressions,
      clicks,
      cost: Math.round(clicks * cpc),
      ctr: num(row[ctrIdx]) ?? (impressions ? (clicks / impressions) * 100 : 0),
      cpc,
    });
  }
  return keywords;
}

function parsePlatform(platform: Platform, capture: PlatformCapture, range: [string, string]): { campaigns: CampaignRow[]; days: Map<string, Metric> } {
  const arrays: Rec[][] = [];
  for (const item of capture.networkJson) walkArrays(item.body, arrays);

  const keywordRows: Rec[] = [];
  const groupRows: Rec[] = [];
  const campaignRows: Rec[] = [];
  const dayMap = new Map<string, Metric>();

  for (const list of arrays) {
    const sample = list[0];
    if (!sample) continue;
    if (list.some((row) => dateOf(row) && (num(pick(row, ["impressions", "impCnt", "clicks", "clkCnt"])) != null))) {
      for (const row of list) {
        const date = dateOf(row);
        if (!date || date < range[0] || date > range[1]) continue;
        const metric = metricFrom(row);
        const prev = dayMap.get(date) ?? emptyMetric();
        dayMap.set(date, {
          impressions: prev.impressions + metric.impressions,
          clicks: prev.clicks + metric.clicks,
          cost: prev.cost + metric.cost,
          ctr: 0,
          cpc: 0,
        });
      }
    }
    if (list.some(looksLikeKeyword)) keywordRows.push(...list.filter(looksLikeKeyword));
    else if (list.some(looksLikeGroup)) groupRows.push(...list.filter(looksLikeGroup));
    else if (list.some(looksLikeCampaign)) campaignRows.push(...list.filter(looksLikeCampaign));
  }

  const tableKeywords = flattenKeywordsFromTables(capture.tables, platform);
  const keywords = (keywordRows.length ? keywordRows.map((row, i) => keywordFrom(row, platform, i)) : tableKeywords).filter(
    (row, index, all) => all.findIndex((other) => other.id === row.id || other.name === row.name) === index,
  );

  const groups: GroupRow[] =
    groupRows.length > 0
      ? groupRows.map((row, i) => {
          const groupId = str(pick(row, ["nccAdgroupId", "adgroupId", "adGroupId", "id"]));
          const owned = keywordRows
            .map((kw, ki) => ({ rec: kw, parsed: keywordFrom(kw, platform, ki) }))
            .filter(({ rec }) => str(pick(rec, ["nccAdgroupId", "adgroupId", "adGroupId"])) === groupId)
            .map(({ parsed }) => parsed);
          return groupFrom(row, platform, i, owned.length ? owned : i === 0 ? keywords : []);
        })
      : keywords.length
        ? [groupFrom({ name: "키워드" }, platform, 0, keywords)]
        : [];

  const campaigns: CampaignRow[] =
    campaignRows.length > 0
      ? campaignRows.map((row, i) => {
          const campaignId = str(pick(row, ["nccCampaignId", "campaignId", "id"]));
          const owned = groupRows
            .map((grp, gi) => ({ rec: grp, parsed: groups[gi] }))
            .filter(({ rec }) => str(pick(rec, ["nccCampaignId", "campaignId"])) === campaignId)
            .map(({ parsed }) => parsed)
            .filter(Boolean) as GroupRow[];
          return campaignFrom(row, platform, i, owned.length ? owned : i === 0 ? groups : []);
        })
      : groups.length
        ? [campaignFrom({ name: platform === "NAVER" ? "네이버 검색광고" : "Google Ads" }, platform, 0, groups)]
        : [];

  for (const metric of dayMap.values()) {
    metric.ctr = metric.impressions ? (metric.clicks / metric.impressions) * 100 : 0;
    metric.cpc = metric.clicks ? metric.cost / metric.clicks : 0;
  }

  return { campaigns, days: dayMap };
}

type ScrapedMetric = {
  name?: string;
  campaign?: string;
  group?: string;
  impressions?: number;
  clicks?: number;
  ctr?: number;
  cpc?: number;
  cost?: number;
  status?: string;
  bid?: number;
  cells?: string[];
  headers?: string[];
  qualityScore?: string;
  expectedCtr?: string;
  relevanceScore?: string;
};

function skipName(name?: string) {
  if (!name) return true;
  return /^(합계|결과|total|전체|선택|키워드|캠페인|광고그룹|그룹|상태|이름|대시보드|on\/?off|광고\s*연관|연관지수|클릭\s*기대|품질지수|품질평가|현재\s*입찰가|노출수|클릭수|클릭률)/i.test(name.trim());
}

function nameFromRow(row: ScrapedMetric) {
  const tidy = (value: string) => {
    const stripped = value.replace(/\[.*?\]/g, " ").replace(/\s+/g, " ").trim();
    return stripped || value.replace(/\s+/g, " ").trim();
  };
  const fromHeader = cellName(row.name);
  if (fromHeader && !skipName(fromHeader)) return tidy(fromHeader);
  for (const value of row.cells ?? []) {
    const text = tidy(value);
    if (!text) continue;
    if (/^(on|off)$/i.test(text)) continue;
    if (/^[\d.,%원+\-/\s]+$/.test(text)) continue;
    if (/연관지수|클릭기대|품질지수/.test(text)) continue;
    if (skipName(text)) continue;
    if (/^campaign #/i.test(text) || /^ad group #/i.test(text)) continue;
    if (text.length >= 1) return text;
  }
  return "";
}

function cellName(name?: string) {
  if (!name) return "";
  return name.replace(/\s+/g, " ").trim();
}

function scoreCell(cells: string[] | undefined, needle: RegExp) {
  return (cells ?? []).map((cell) => cell.replace(/\s+/g, " ").trim()).find((text) => needle.test(text));
}

function addKeywordDay(kw: KeywordRow, date: string, impressions: number, clicks: number, cost: number) {
  if (!impressions && !clicks && !cost) return;
  const map = kw.byDate ?? (kw.byDate = {});
  const prev = map[date] ?? [0, 0, 0];
  const next: DayTuple = [prev[0] + impressions, prev[1] + clicks, prev[2] + cost];
  if (!next[0] && !next[1] && !next[2]) delete map[date];
  else map[date] = next;
}

function mergeByDate(rows: Array<{ byDate?: Record<string, DayTuple> }>): Record<string, DayTuple> | undefined {
  const map: Record<string, DayTuple> = {};
  for (const row of rows) {
    for (const [date, cell] of Object.entries(row.byDate || {})) {
      const prev = map[date] ?? [0, 0, 0];
      map[date] = [prev[0] + cell[0], prev[1] + cell[1], prev[2] + cell[2]];
    }
  }
  return Object.keys(map).length ? map : undefined;
}

function attachScores(prev: KeywordRow, row: ScrapedMetric) {
  const slashed = (row.cells ?? []).filter((cell) => /\d+\s*\/\s*10/.test(cell));
  const relevance = row.relevanceScore || row.qualityScore || scoreCell(row.cells, /연관|품질/);
  const expected = row.expectedCtr || scoreCell(row.cells, /기대/);
  if (relevance) prev.relevanceScore = relevance;
  else if (!prev.relevanceScore && slashed[0]) prev.relevanceScore = slashed[0];
  if (expected) prev.expectedCtr = expected;
  else if (!prev.expectedCtr && slashed[1]) prev.expectedCtr = slashed[1];
  if (row.qualityScore) prev.qualityScore = row.qualityScore;
}

function placeholderGroupName(name?: string) {
  if (!name) return true;
  return /^(대시보드|키워드|광고그룹|그룹)$/i.test(name.trim()) || /^grp-/i.test(name);
}

function keywordOverlap(a: KeywordRow[], b: KeywordRow[]) {
  const names = new Set(a.map((kw) => kw.name));
  return b.reduce((sum, kw) => sum + (names.has(kw.name) ? 1 : 0), 0);
}

function applyNaverCatalog(campaigns: CampaignRow[]): CampaignRow[] {
  const catalog = loadNaverCatalog();
  if (!catalog.campaigns.length && !catalog.groups.length) return campaigns;
  const campMeta = new Map(catalog.campaigns.map((item) => [item.id, item]));
  const groupMeta = new Map(catalog.groups.map((item) => [item.id, item]));
  const catalogOrder = catalog.groups.map((item) => item.id);

  const withNames = campaigns.map((camp) => {
    const meta = campMeta.get(camp.id);
    const groups = camp.groups.map((group) => {
      const hit = groupMeta.get(group.id);
      return {
        ...group,
        name: hit?.name || (placeholderGroupName(group.name) ? group.id : group.name),
        status: hit?.status || group.status,
      };
    });
    if (catalogOrder.length) {
      groups.sort((a, b) => {
        const ai = catalogOrder.indexOf(a.id);
        const bi = catalogOrder.indexOf(b.id);
        if (ai >= 0 && bi >= 0) return ai - bi;
        if (ai >= 0) return -1;
        if (bi >= 0) return 1;
        return a.name.localeCompare(b.name, "ko");
      });
    }
    return {
      ...camp,
      name: meta?.name || camp.name,
      status: meta?.status || camp.status,
      groups,
      byDate: mergeByDate(groups),
      ...sumMetrics(groups),
    };
  });

  const mo = withNames.find((camp) => camp.id === "cmp-a001-01-000000010974395");
  return withNames.map((camp) => {
    if (camp.id !== "cmp-a001-01-000000010973508" || !mo) return camp;
    const used = new Set<string>();
    const groups = camp.groups.map((group) => {
      if (groupMeta.has(group.id)) return group;
      let bestName = group.name;
      let bestStatus = group.status;
      let best = 0;
      for (const src of mo.groups) {
        if (used.has(src.name)) continue;
        const score = keywordOverlap(group.keywords, src.keywords);
        if (score > best) {
          best = score;
          bestName = src.name;
          bestStatus = src.status;
        }
      }
      if (best > 0) used.add(bestName);
      return { ...group, name: bestName, status: bestStatus };
    });
    groups.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    return { ...camp, groups, byDate: mergeByDate(groups), ...sumMetrics(groups) };
  });
}

function parseNaverTree(body: unknown, range: [string, string]): { campaigns: CampaignRow[]; days: Map<string, Metric> } | null {
  if (!Array.isArray(body) || !body.length) return null;
  const dayMap = new Map<string, Metric>();
  const campaigns: CampaignRow[] = [];
  for (const camp of body as Array<{ id: string; name: string; groups?: Array<{ id: string; name: string; keywordsByDate?: Record<string, ScrapedMetric[]> }> }>) {
    const groups: GroupRow[] = [];
    for (const group of camp.groups ?? []) {
      const byName = new Map<string, KeywordRow>();
      const dates = Object.entries(group.keywordsByDate ?? {});
      for (const [date, rows] of dates) {
        if (date < range[0] || date > range[1]) continue;
        const header = rows.find((row) => (row.cells ?? []).includes("노출수"))?.cells ?? [];
        const idx = (label: string) => header.findIndex((cell) => cell.replace(/\s+/g, "") === label.replace(/\s+/g, ""));
        let dayImp = 0;
        let dayClk = 0;
        let dayCost = 0;
        for (const row of rows) {
          const cells = row.cells ?? [];
          if (cells.includes("노출수") || cells.includes("키워드") && cells.includes("클릭수")) continue;
          const name = nameFromRow(row);
          if (skipName(name) || !name) continue;
          const impressions = num(cells[idx("노출수")]) ?? row.impressions ?? 0;
          const clicks = num(cells[idx("클릭수")]) ?? row.clicks ?? 0;
          const cpc = num(cells[idx("평균 CPC")]) ?? row.cpc ?? 0;
          const cost = num(cells[idx("총비용")]) ?? row.cost ?? Math.round(clicks * cpc);
          const status = (idx("상태") >= 0 ? cells[idx("상태")] : "") || row.status;
          const prev = byName.get(name) ?? {
            id: `${group.id}-${name}`,
            name,
            status,
            bid: row.bid,
            impressions: 0,
            clicks: 0,
            cost: 0,
            ctr: 0,
            cpc: 0,
          };
          if (status) prev.status = status;
          prev.impressions += impressions;
          prev.clicks += clicks;
          prev.cost += cost;
          addKeywordDay(prev, date, impressions, clicks, cost);
          attachScores(prev, row);
          byName.set(name, prev);
          dayImp += impressions;
          dayClk += clicks;
          dayCost += cost;
        }
        const cur = dayMap.get(date) ?? emptyMetric();
        dayMap.set(date, {
          impressions: cur.impressions + dayImp,
          clicks: cur.clicks + dayClk,
          cost: cur.cost + dayCost,
          ctr: 0,
          cpc: 0,
        });
      }
      const keywords = [...byName.values()].map((kw) => ({
        ...kw,
        ctr: kw.impressions ? (kw.clicks / kw.impressions) * 100 : 0,
        cpc: kw.clicks ? kw.cost / kw.clicks : kw.cpc,
      }));
      groups.push({
        id: group.id,
        name: placeholderGroupName(group.name) ? group.id : group.name,
        keywords,
        byDate: mergeByDate(keywords),
        ...sumMetrics(keywords),
      });
    }
    campaigns.push({
      id: camp.id,
      platform: "NAVER",
      name: camp.name,
      groups,
      byDate: mergeByDate(groups),
      ...sumMetrics(groups),
    });
  }
  const named = applyNaverCatalog(campaigns);
  for (const metric of dayMap.values()) {
    metric.ctr = metric.impressions ? (metric.clicks / metric.impressions) * 100 : 0;
    metric.cpc = metric.clicks ? metric.cost / metric.clicks : 0;
  }
  return { campaigns: named, days: dayMap };
}

function headerKey(header: string) {
  return header.replace(/help_outline|정보/gi, "").replace(/\s+/g, "");
}

function colAt(headers: string[], ...needles: RegExp[]) {
  return headers.findIndex((header) => needles.some((needle) => needle.test(headerKey(header))));
}

function googleOffset(headers: string[], cells: string[]) {
  const ki = colAt(headers, /^키워드$/, /keyword/i);
  if (ki < 0) return 0;
  if ((cells[ki] || "").trim()) return 0;
  if ((cells[ki + 1] || "").trim()) return 1;
  return 0;
}

function googleCell(headers: string[], cells: string[], ...needles: RegExp[]) {
  const idx = colAt(headers, ...needles);
  if (idx < 0) return "";
  return (cells[idx + googleOffset(headers, cells)] || "").trim();
}

function googleDayFingerprint(rows: ScrapedMetric[]) {
  return JSON.stringify(
    (rows ?? []).map((row) => (row.cells?.length ? row.cells : [row.name, row.impressions, row.clicks, row.cost])),
  );
}

function parseGoogleByDate(
  body: unknown,
  range: [string, string],
): { campaigns: CampaignRow[]; days: Map<string, Metric>; skippedCopies: string[] } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const byDate = body as Record<string, ScrapedMetric[]>;
  const keys = Object.keys(byDate).sort();
  if (!keys.length) return null;
  const dayMap = new Map<string, Metric>();
  const campMap = new Map<string, CampaignRow>();
  const seen = new Set<string>();
  const skippedCopies: string[] = [];
  for (const date of keys) {
    if (date < range[0] || date > range[1]) continue;
    const fp = googleDayFingerprint(byDate[date] ?? []);
    if (seen.has(fp)) {
      skippedCopies.push(date);
      continue;
    }
    seen.add(fp);
    let dayImp = 0;
    let dayClk = 0;
    let dayCost = 0;
    for (const row of byDate[date] ?? []) {
      const headers = row.headers?.length ? row.headers : [];
      const cells = row.cells ?? [];
      const name = headers.length
        ? googleCell(headers, cells, /^키워드$/, /keyword/i)
        : nameFromRow(row) || row.name || "";
      if (skipName(name) || !name) continue;
      const campName = headers.length
        ? googleCell(headers, cells, /^캠페인$/, /campaign/i)
        : row.campaign || "";
      const groupName = headers.length
        ? googleCell(headers, cells, /^광고그룹$/, /adgroup/i, /ad group/i)
        : row.group || "";
      const matchType = headers.length ? googleCell(headers, cells, /검색유형/, /match/i) : "";
      const campaign = campName && !skipName(campName) ? campName : "Google Ads";
      const groupLabel = groupName && !skipName(groupName) ? groupName : "광고그룹";
      const impressions = headers.length ? (num(googleCell(headers, cells, /^노출수$/, /impressions/i)) ?? row.impressions ?? 0) : (row.impressions || 0);
      const clicks = headers.length ? (num(googleCell(headers, cells, /^클릭수$/, /^clicks$/i)) ?? row.clicks ?? 0) : (row.clicks || 0);
      const cost = headers.length ? (num(googleCell(headers, cells, /^비용$/, /^cost$/i)) ?? row.cost ?? 0) : (row.cost || 0);
      const camp = campMap.get(campaign) ?? {
        id: `google-${campaign}`,
        platform: "GOOGLE",
        name: campaign,
        groups: [],
        impressions: 0,
        clicks: 0,
        cost: 0,
        ctr: 0,
        cpc: 0,
      };
      let group = camp.groups.find((g) => g.name === groupLabel);
      if (!group) {
        group = { id: `${camp.id}-${groupLabel}`, name: groupLabel, keywords: [], impressions: 0, clicks: 0, cost: 0, ctr: 0, cpc: 0 };
        camp.groups.push(group);
      }
      let kw = group.keywords.find((k) => k.name === name && (k.matchType || "") === (matchType || ""));
      if (!kw) {
        kw = { id: `${group.id}-${name}-${matchType}`, name, matchType: matchType || undefined, status: row.status, impressions: 0, clicks: 0, cost: 0, ctr: 0, cpc: 0 };
        group.keywords.push(kw);
      }
      kw.impressions += impressions;
      kw.clicks += clicks;
      kw.cost += cost;
      addKeywordDay(kw, date, impressions, clicks, cost);
      dayImp += impressions;
      dayClk += clicks;
      dayCost += cost;
      campMap.set(campaign, camp);
    }
    dayMap.set(date, {
      impressions: dayImp,
      clicks: dayClk,
      cost: dayCost,
      ctr: dayImp ? (dayClk / dayImp) * 100 : 0,
      cpc: dayClk ? dayCost / dayClk : 0,
    });
  }
  const campaigns = [...campMap.values()].map((camp) => {
    camp.groups = camp.groups.map((group) => {
      const keywords = group.keywords.map((kw) => ({
        ...kw,
        ctr: kw.impressions ? (kw.clicks / kw.impressions) * 100 : 0,
        cpc: kw.clicks ? kw.cost / kw.clicks : 0,
      }));
      return { ...group, keywords, byDate: mergeByDate(keywords), ...sumMetrics(keywords) };
    });
    return { ...camp, ...sumMetrics(camp.groups), byDate: mergeByDate(camp.groups) };
  });
  return { campaigns, days: dayMap, skippedCopies };
}

export function parseAdsCapture(raw: AdsCaptureFile): AdsReport {
  const dateRange = raw.dateRange?.length === 2 ? raw.dateRange : defaultRangeKst();
  const naverTree = raw.naver.networkJson.find((item) => String(item.url).includes("scrape://naver-tree"));
  const googleTree = raw.google.networkJson.find((item) => String(item.url).includes("scrape://google-keywords"));
  const naver = parseNaverTree(naverTree?.body, dateRange) ?? parsePlatform("NAVER", raw.naver, dateRange);
  const google =
    parseGoogleByDate(googleTree?.body, dateRange) ??
    { ...parsePlatform("GOOGLE", raw.google, dateRange), skippedCopies: [] as string[] };
  const days: DailyPoint[] = eachDay(...dateRange).map((date) => {
    const n = naver.days.get(date) ?? emptyMetric();
    const g = google.days.get(date) ?? emptyMetric();
    return { date, naver: n, google: g };
  });

  const notes: string[] = [];
  if (!naver.campaigns.length) notes.push("네이버 캠페인/키워드를 아직 읽지 못했습니다.");
  if (!google.campaigns.length) notes.push("구글 키워드는 아직 수집되지 않았습니다.");
  if (google.skippedCopies?.length) {
    notes.push(
      `구글 ${google.skippedCopies[0]}~${google.skippedCopies[google.skippedCopies.length - 1]} (${google.skippedCopies.length}일)은 날짜가 안 바뀐 채 같은 표가 복사된 값이라 제외했습니다.`,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    source: "crawl",
    capturedAt: raw.capturedAt,
    dateRange,
    days,
    campaigns: [...naver.campaigns, ...google.campaigns],
    notes: [...notes, ...raw.naver.notes, ...raw.google.notes],
    naver: { pageUrl: raw.naver.pageUrl, loggedIn: raw.naver.loggedIn, notes: raw.naver.notes },
    google: { pageUrl: raw.google.pageUrl, loggedIn: raw.google.loggedIn, notes: raw.google.notes },
  };
}
