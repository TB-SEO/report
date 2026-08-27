import { createSupabaseClient } from "./supabase.js";

export type AppDocId = "report" | "ads" | "wbs" | "weeks" | `week-${string}`;

export async function putAppDocument(id: string, payload: unknown) {
  const sb = createSupabaseClient();
  const now = new Date().toISOString();
  const row = { id, payload, updated_at: now };
  const existing = await sb.from("app_documents").select("id").eq("id", id).maybeSingle();
  if (existing.error) throw new Error(`app_documents: ${existing.error.message}`);
  if (existing.data) {
    const updated = await sb.from("app_documents").update(row).eq("id", id);
    if (updated.error) throw new Error(`app_documents update: ${updated.error.message}`);
  } else {
    const inserted = await sb.from("app_documents").insert({ ...row, created_at: now });
    if (inserted.error) throw new Error(`app_documents insert: ${inserted.error.message}`);
  }
}

export async function getAppDocument<T>(id: string): Promise<{ payload: T; updatedAt: string } | null> {
  const sb = createSupabaseClient();
  const found = await sb.from("app_documents").select("payload, updated_at").eq("id", id).maybeSingle();
  if (found.error) throw new Error(`app_documents: ${found.error.message}`);
  if (!found.data) return null;
  return { payload: found.data.payload as T, updatedAt: String(found.data.updated_at) };
}
