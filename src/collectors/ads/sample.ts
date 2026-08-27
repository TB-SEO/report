import type { AdsReport, CampaignRow, DailyPoint, Metric } from "./types.js";
import { defaultRangeKst, eachDay, emptyMetric } from "./dates.js";

function m(impressions: number, clicks: number, cpc: number): Metric {
  const cost = Math.round(clicks * cpc);
  return {
    impressions,
    clicks,
    cost,
    ctr: impressions ? (clicks / impressions) * 100 : 0,
    cpc,
    conversions: 0,
  };
}

export function sampleAdsReport(): AdsReport {
  const dateRange = defaultRangeKst();
  const days = eachDay(...dateRange);
  const series: DailyPoint[] = days.map((date, i) => {
    const wave = [0.7, 0.85, 0.9, 1, 1.35, 1.8, 1.1][i] ?? 1;
    return {
      date,
      naver: m(Math.round(420 * wave), Math.round(3 * wave), 280),
      google: m(Math.round(310 * wave), Math.round(4 * wave), 420),
    };
  });

  const naver: CampaignRow = {
    id: "naver-camp-1",
    platform: "NAVER",
    name: "A_외주대행",
    status: "노출가능",
    channel: "검색",
    dailyBudget: 50_000,
    ...m(2803, 12, 310),
    groups: [
      {
        id: "naver-grp-1",
        name: "A_외주대행",
        status: "ON",
        bid: 200,
        ...m(2803, 12, 310),
        keywords: [
          { id: "nk-1", name: "QA가격", matchType: "확장검색", status: "노출가능", bid: 200, qualityScore: "2/10 (개선필요)", expectedCtr: "8/10 (평균)", ...m(412, 2, 210) },
          { id: "nk-2", name: "QA견적", matchType: "확장검색", status: "노출가능", bid: 200, qualityScore: "3/10 (평균)", expectedCtr: "7/10 (평균)", ...m(380, 1, 200) },
          { id: "nk-3", name: "QA대행", status: "노출가능", bid: 1080, qualityScore: "5/10 (평균)", expectedCtr: "8/10 (평균)", ...m(890, 4, 390) },
          { id: "nk-4", name: "소프트웨어테스트", status: "노출가능", bid: 200, qualityScore: "4/10 (평균)", expectedCtr: "6/10 (평균)", ...m(621, 3, 250) },
          { id: "nk-5", name: "앱테스트대행", matchType: "확장검색", status: "노출가능", bid: 350, qualityScore: "6/10 (평균)", expectedCtr: "8/10 (평균)", ...m(500, 2, 330) },
        ],
      },
    ],
  };

  const google: CampaignRow = {
    id: "google-camp-1",
    platform: "GOOGLE",
    name: "Search_QA_Agency",
    status: "사용 설정됨",
    channel: "검색",
    dailyBudget: 40_000,
    ...m(2140, 18, 440),
    groups: [
      {
        id: "google-grp-1",
        name: "QA 외주",
        status: "사용 설정됨",
        bid: 500,
        ...m(1400, 12, 430),
        keywords: [
          { id: "gk-1", name: "qa 외주", matchType: "구문", status: "적격", bid: 500, qualityScore: "7/10", ...m(620, 6, 410) },
          { id: "gk-2", name: "qa 대행", matchType: "완전일치", status: "적격", bid: 720, qualityScore: "8/10", ...m(480, 4, 480) },
          { id: "gk-3", name: "소프트웨어 테스트", matchType: "구문", status: "적격", bid: 400, qualityScore: "6/10", ...m(300, 2, 390) },
        ],
      },
      {
        id: "google-grp-2",
        name: "앱 테스트",
        status: "사용 설정됨",
        bid: 450,
        ...m(740, 6, 460),
        keywords: [
          { id: "gk-4", name: "앱 테스트 대행", matchType: "구문", status: "적격", bid: 450, qualityScore: "7/10", ...m(440, 4, 450) },
          { id: "gk-5", name: "모바일 qa", matchType: "광범위", status: "적격", bid: 380, qualityScore: "5/10", ...m(300, 2, 480) },
        ],
      },
    ],
  };

  return {
    generatedAt: new Date().toISOString(),
    source: "sample",
    dateRange,
    days: series,
    campaigns: [naver, google],
    notes: ["아직 수집본이 없어 화면 구조용 예시 데이터입니다. npm run ads:login 후 npm run ads:crawl 을 실행하세요."],
    naver: { loggedIn: false, notes: ["수집 전"] },
    google: { loggedIn: false, notes: ["수집 전"] },
  };
}

export { emptyMetric };
