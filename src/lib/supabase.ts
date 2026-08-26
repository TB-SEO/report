import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim();

  if (!url) throw new Error("SUPABASE_URL 이 없습니다.");
  if (!key) throw new Error("SUPABASE_ANON_KEY 또는 SUPABASE_SERVICE_ROLE_KEY 를 .env에 넣어 주세요.");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "public" },
  });
}
