import { createSupabaseClient } from "../lib/supabase.js";

export const SETUP_VISITOR_ID = "00000000-0000-4000-8000-000000000000";

export type ServiceEvent = {
  occurredAt: string;
  date: string;
  eventName: string;
  resultName: string | null;
  visitorId: string;
  playId: string | null;
  landingPath: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  firstUtmSource: string | null;
  firstUtmCampaign: string | null;
  firstUtmContent: string | null;
};

export type ServiceVisitor = {
  id: string;
  firstSeenAt: string;
  lastSeenAt: string;
  firstDate: string;
  lastDate: string;
  firstLandingPath: string | null;
  firstUtmSource: string | null;
  firstUtmCampaign: string | null;
  firstUtmContent: string | null;
  eventCount: number;
};

export type ServiceReport = {
  generatedAt: string;
  notes: string[];
  visitors: ServiceVisitor[];
  events: ServiceEvent[];
};

const PAGE = 1000;

function kstYmd(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(iso));
}

function isSetup(visitorId: string, path?: string | null) {
  if (visitorId === SETUP_VISITOR_ID) return true;
  return path === "/setup-check";
}

async function fetchAll<T extends Record<string, unknown>>(table: string): Promise<T[]> {
  const sb = createSupabaseClient();
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const found = await sb.from(table).select("*").range(from, from + PAGE - 1);
    if (found.error) throw new Error(`${table}: ${found.error.message}`);
    const chunk = (found.data ?? []) as T[];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return rows;
}

export async function loadServiceReport(): Promise<ServiceReport> {
  const rawVisitors = await fetchAll<{
    id: string;
    first_seen_at: string;
    last_seen_at: string;
    first_landing_path: string | null;
    first_utm_source: string | null;
    first_utm_campaign: string | null;
    first_utm_content: string | null;
    event_count: number;
  }>("shiptype_analytics_visitors");

  const rawEvents = await fetchAll<{
    visitor_id: string;
    play_id: string | null;
    event_name: string;
    result_name: string | null;
    landing_path: string | null;
    utm_source: string | null;
    utm_campaign: string | null;
    occurred_at: string;
  }>("shiptype_analytics_events");

  const visitors = rawVisitors
    .filter((row) => !isSetup(row.id, row.first_landing_path))
    .map((row) => ({
      id: row.id,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      firstDate: kstYmd(row.first_seen_at),
      lastDate: kstYmd(row.last_seen_at),
      firstLandingPath: row.first_landing_path,
      firstUtmSource: row.first_utm_source,
      firstUtmCampaign: row.first_utm_campaign,
      firstUtmContent: row.first_utm_content,
      eventCount: Number(row.event_count ?? 0),
    }))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));

  const byVisitor = new Map(visitors.map((row) => [row.id, row]));

  const events = rawEvents
    .filter((row) => !isSetup(row.visitor_id, row.landing_path) && byVisitor.has(row.visitor_id))
    .map((row) => {
      const person = byVisitor.get(row.visitor_id);
      return {
        occurredAt: row.occurred_at,
        date: kstYmd(row.occurred_at),
        eventName: row.event_name,
        resultName: row.result_name,
        visitorId: row.visitor_id,
        playId: row.play_id,
        landingPath: row.landing_path,
        utmSource: row.utm_source,
        utmCampaign: row.utm_campaign,
        firstUtmSource: person?.firstUtmSource ?? null,
        firstUtmCampaign: person?.firstUtmCampaign ?? null,
        firstUtmContent: person?.firstUtmContent ?? null,
      };
    })
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  return {
    generatedAt: new Date().toISOString(),
    notes: [
      "ShipType 로그는 테이블 2개(visitors, events)와 뷰 timeline 입니다. SQL Editor에서 원본을 보세요.",
      "셋업 테스트(/setup-check) 행은 화면에서 뺐습니다.",
    ],
    visitors,
    events,
  };
}
