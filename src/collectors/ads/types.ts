export type Platform = "NAVER" | "GOOGLE";

export type Metric = {
  impressions: number;
  clicks: number;
  cost: number;
  ctr: number;
  cpc: number;
  conversions: number;
};

export type DailyPoint = {
  date: string;
  naver: Metric;
  google: Metric;
};

/** 노출, 클릭, 비용, 총 전환수. 0인 날은 넣지 않음. */
export type DayTuple = [number, number, number, number?];

export type KeywordRow = {
  id: string;
  name: string;
  matchType?: string;
  status?: string;
  bid?: number;
  qualityScore?: string;
  expectedCtr?: string;
  rankHint?: string;
  relevanceScore?: string;
  byDate?: Record<string, DayTuple>;
} & Metric;

export type GroupRow = {
  id: string;
  name: string;
  status?: string;
  bid?: number;
  keywords: KeywordRow[];
  byDate?: Record<string, DayTuple>;
} & Metric;

export type CampaignRow = {
  id: string;
  platform: Platform;
  name: string;
  status?: string;
  channel?: string;
  dailyBudget?: number;
  groups: GroupRow[];
  byDate?: Record<string, DayTuple>;
} & Metric;

export type AdsCaptureFile = {
  capturedAt: string;
  dateRange: [string, string];
  naver: PlatformCapture;
  google: PlatformCapture;
};

export type PlatformCapture = {
  pageUrl?: string;
  loggedIn?: boolean;
  notes: string[];
  networkJson: Array<{ url: string; status?: number; body: unknown }>;
  tables: string[][];
};

export type AdsReport = {
  generatedAt: string;
  source: "crawl" | "sample";
  file?: string;
  capturedAt?: string;
  dateRange: [string, string];
  days: DailyPoint[];
  campaigns: CampaignRow[];
  notes: string[];
  naver: { pageUrl?: string; loggedIn?: boolean; notes: string[] };
  google: { pageUrl?: string; loggedIn?: boolean; notes: string[] };
};
