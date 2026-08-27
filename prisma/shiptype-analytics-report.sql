-- GitHub Pages / 브라우저 대시보드용. service_role 불필요.
-- 원본 테이블은 RLS로 직접 SELECT 불가 유지.
-- 공개 조회는 마스킹된 RPC shiptype_analytics_report 만.

CREATE OR REPLACE FUNCTION shiptype_mask_ip(ip text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN ip IS NULL OR btrim(ip) = '' THEN NULL
    WHEN ip ~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' THEN regexp_replace(ip, '\.[0-9]{1,3}$', '.x')
    WHEN strpos(ip, ':') > 0 THEN array_to_string((string_to_array(ip, ':'))[1:3], ':') || ':…'
    ELSE 'x'
  END
$$;

CREATE OR REPLACE FUNCTION shiptype_analytics_report()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH visitors AS (
    SELECT
      v.id,
      v.first_seen_at,
      v.last_seen_at,
      to_char(timezone('Asia/Seoul', v.first_seen_at), 'YYYY-MM-DD') AS first_date,
      to_char(timezone('Asia/Seoul', v.last_seen_at), 'YYYY-MM-DD') AS last_date,
      v.first_landing_path,
      v.first_referrer,
      v.first_utm_source,
      v.first_utm_campaign,
      v.first_utm_content,
      shiptype_mask_ip(v.first_ip) AS first_ip_masked,
      shiptype_mask_ip(v.last_ip) AS last_ip_masked,
      v.event_count
    FROM shiptype_analytics_visitors v
    WHERE v.id <> '00000000-0000-4000-8000-000000000000'
      AND coalesce(v.first_landing_path, '') <> '/setup-check'
  ),
  events AS (
    SELECT
      e.occurred_at,
      to_char(timezone('Asia/Seoul', e.occurred_at), 'YYYY-MM-DD') AS date,
      e.event_name,
      e.result_name,
      e.visitor_id,
      e.play_id,
      e.landing_path,
      e.referrer,
      e.utm_source,
      e.utm_campaign,
      v.first_landing_path,
      v.first_referrer,
      v.first_utm_source,
      v.first_utm_campaign,
      v.first_utm_content,
      shiptype_mask_ip(e.client_ip) AS client_ip_masked,
      v.last_ip_masked
    FROM shiptype_analytics_events e
    JOIN visitors v ON v.id = e.visitor_id
    WHERE coalesce(e.landing_path, '') <> '/setup-check'
  )
  SELECT jsonb_build_object(
    'generatedAt', to_jsonb(now()),
    'notes', jsonb_build_array(
      '사람은 브라우저(visitor_id, 오리진마다 다름)와 서버가 본 IP 두 단위로 봅니다. IP는 공개 화면에 마스킹합니다.',
      'start는 /play 마운트·세션 생성 시입니다. 버튼 전용이 아니고 새로고침도 찍힙니다. 직접 접속이면 첫 UTM 공란이 정상입니다.',
      '배포 전·로컬 이벤트는 IP가 비어 있습니다.'
    ),
    'stats', jsonb_build_object(
      'browsers', (SELECT count(*) FROM visitors),
      'ips', (SELECT count(DISTINCT last_ip_masked) FROM visitors WHERE last_ip_masked IS NOT NULL),
      'plays', (SELECT count(DISTINCT play_id) FROM events WHERE play_id IS NOT NULL),
      'results', (SELECT count(*) FROM events WHERE event_name = 'result'),
      'events', (SELECT count(*) FROM events),
      'eventsWithIp', (SELECT count(*) FROM events WHERE client_ip_masked IS NOT NULL)
    ),
    'visitors', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'firstSeenAt', first_seen_at,
        'lastSeenAt', last_seen_at,
        'firstDate', first_date,
        'lastDate', last_date,
        'firstLandingPath', first_landing_path,
        'firstReferrer', first_referrer,
        'firstUtmSource', first_utm_source,
        'firstUtmCampaign', first_utm_campaign,
        'firstUtmContent', first_utm_content,
        'firstIpMasked', first_ip_masked,
        'lastIpMasked', last_ip_masked,
        'eventCount', event_count
      ) ORDER BY last_seen_at DESC)
      FROM visitors
    ), '[]'::jsonb),
    'events', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'occurredAt', occurred_at,
        'date', date,
        'eventName', event_name,
        'resultName', result_name,
        'visitorId', visitor_id,
        'playId', play_id,
        'landingPath', landing_path,
        'referrer', referrer,
        'utmSource', utm_source,
        'utmCampaign', utm_campaign,
        'firstLandingPath', first_landing_path,
        'firstReferrer', first_referrer,
        'firstUtmSource', first_utm_source,
        'firstUtmCampaign', first_utm_campaign,
        'firstUtmContent', first_utm_content,
        'clientIpMasked', client_ip_masked,
        'lastIpMasked', last_ip_masked
      ) ORDER BY occurred_at DESC)
      FROM events
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION shiptype_mask_ip(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION shiptype_analytics_report() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shiptype_analytics_report() TO anon, authenticated, service_role;

REVOKE SELECT ON TABLE shiptype_analytics_visitors FROM anon, authenticated;
REVOKE SELECT ON TABLE shiptype_analytics_events FROM anon, authenticated;
REVOKE SELECT ON TABLE shiptype_analytics_timeline FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
