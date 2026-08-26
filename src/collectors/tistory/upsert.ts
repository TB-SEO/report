import type { AppConfig } from "./config.js";
import type { DailySnapshot } from "./types.js";
import { upsertDailySnapshots } from "../../lib/blog-upsert.js";

export async function upsertTistorySnapshots(cfg: AppConfig, snapshots: DailySnapshot[]) {
  return upsertDailySnapshots(
    {
      clientSlug: cfg.clientSlug,
      clientName: cfg.clientName,
      platform: "TISTORY",
      blogUserId: cfg.blogUserId,
      blogUrl: cfg.blogUrl,
      name: cfg.blogUserId,
    },
    snapshots,
    "TISTORY_BLOG",
  );
}

export async function disconnectDb() {
  // Supabase REST는 연결을 유지하지 않습니다.
}
