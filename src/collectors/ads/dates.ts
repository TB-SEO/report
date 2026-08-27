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

export type AdsWeek = { id: string; label: string; from: string; to: string };

/** 그달 1일부터 7일씩. 7월 15일 시작이어도 3주차로 잡힌다. */
export function adsWeeks(from: string, to: string): AdsWeek[] {
  const weeks: AdsWeek[] = [];
  const month = Number(from.slice(5, 7));
  let start = `${from.slice(0, 7)}-01`;
  let n = 0;
  while (start <= to) {
    n += 1;
    const rawEnd = addKstDays(start, 6);
    const clipFrom = start < from ? from : start;
    const clipTo = rawEnd > to ? to : rawEnd;
    if (clipFrom <= clipTo) {
      weeks.push({
        id: `${clipFrom}_${clipTo}`,
        label: `${month}월 ${n}주차`,
        from: clipFrom,
        to: clipTo,
      });
    }
    start = addKstDays(start, 7);
  }
  return weeks;
}

export function emptyMetric() {
  return { impressions: 0, clicks: 0, cost: 0, ctr: 0, cpc: 0, conversions: 0 };
}

export function sumMetrics<T extends { impressions: number; clicks: number; cost: number; conversions?: number }>(rows: T[]) {
  const impressions = rows.reduce((sum, row) => sum + (row.impressions || 0), 0);
  const clicks = rows.reduce((sum, row) => sum + (row.clicks || 0), 0);
  const cost = rows.reduce((sum, row) => sum + (row.cost || 0), 0);
  const conversions = rows.reduce((sum, row) => sum + (row.conversions || 0), 0);
  return {
    impressions,
    clicks,
    cost,
    conversions,
    ctr: impressions ? (clicks / impressions) * 100 : 0,
    cpc: clicks ? cost / clicks : 0,
  };
}
