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
  referrer: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  firstLandingPath: string | null;
  firstReferrer: string | null;
  firstUtmSource: string | null;
  firstUtmCampaign: string | null;
  firstUtmContent: string | null;
  clientIpMasked: string | null;
  lastIpMasked: string | null;
};

export type ServiceVisitor = {
  id: string;
  firstSeenAt: string;
  lastSeenAt: string;
  firstDate: string;
  lastDate: string;
  firstLandingPath: string | null;
  firstReferrer: string | null;
  firstUtmSource: string | null;
  firstUtmCampaign: string | null;
  firstUtmContent: string | null;
  firstIpMasked: string | null;
  lastIpMasked: string | null;
  eventCount: number;
};

export type ServiceReport = {
  generatedAt: string;
  notes: string[];
  stats: {
    browsers: number;
    ips: number;
    plays: number;
    results: number;
    events: number;
    eventsWithIp: number;
  };
  visitors: ServiceVisitor[];
  events: ServiceEvent[];
};

export async function loadServiceReport(): Promise<ServiceReport> {
  const sb = createSupabaseClient();
  const found = await sb.rpc("shiptype_analytics_report");
  if (found.error) throw new Error(`shiptype_analytics_report: ${found.error.message}`);
  return found.data as ServiceReport;
}
