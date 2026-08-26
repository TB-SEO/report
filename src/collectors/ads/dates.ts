export function kstToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

export function addKstDays(ymd: string, delta: number) {
  const date = new Date(`${ymd}T12:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + delta);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}

/** 검색광고 시작(7월)부터 어제까지. ADS_DATE_FROM 으로 바꿀 수 있음. */
export function defaultRangeKst(): [string, string] {
  const to = addKstDays(kstToday(), -1);
  const from = process.env.ADS_DATE_FROM?.trim() || `${to.slice(0, 4)}-07-01`;
  return [from <= to ? from : to, to];
}

export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let cursor = from; cursor <= to; cursor = addKstDays(cursor, 1)) days.push(cursor);
  return days;
}

export function emptyMetric() {
  return { impressions: 0, clicks: 0, cost: 0, ctr: 0, cpc: 0 };
}

export function sumMetrics<T extends { impressions: number; clicks: number; cost: number }>(rows: T[]) {
  const impressions = rows.reduce((sum, row) => sum + (row.impressions || 0), 0);
  const clicks = rows.reduce((sum, row) => sum + (row.clicks || 0), 0);
  const cost = rows.reduce((sum, row) => sum + (row.cost || 0), 0);
  return {
    impressions,
    clicks,
    cost,
    ctr: impressions ? (clicks / impressions) * 100 : 0,
    cpc: clicks ? cost / clicks : 0,
  };
}
