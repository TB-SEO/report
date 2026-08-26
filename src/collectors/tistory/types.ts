export type TrafficCategory = "SEARCH" | "SNS" | "OTHER";
export type DeviceType = "PC" | "MOBILE";

export type TrafficSource = {
  category: TrafficCategory;
  sourceCode: string;
  sourceName: string;
  views: number;
};

export type DailySnapshot = {
  date: string;
  views?: number;
  visitors?: number;
  cumulativeViews?: number;
  cumulativeVisitors?: number;
  sources: TrafficSource[];
  devices: Array<{ deviceType: DeviceType; sharePct: number; views?: number }>;
  popularPosts: Array<{ rank: number; title: string; url?: string; views: number }>;
  inflowKeywords: Array<{ rank?: number; keyword: string; views: number }>;
};

export type CaptureFile = {
  capturedAt: string;
  pageUrl: string;
  pageText?: string;
  networkJson: Array<{ url: string; body: unknown }>;
  snapshots: DailySnapshot[];
  posts?: Array<{ externalId: string; title?: string; url?: string; publishedAt?: string }>;
  postStats?: Array<{ externalId: string; date: string; views: number; likes?: number; comments?: number }>;
  totals?: Array<{ id: string; title?: string; total: number }>;
};
