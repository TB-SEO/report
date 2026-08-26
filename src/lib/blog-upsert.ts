import { randomUUID } from "node:crypto";
import { createSupabaseClient } from "./supabase.js";
import type { DailySnapshot } from "../collectors/tistory/types.js";

export type BlogPlatform = "TISTORY" | "NAVER" | "VELOG" | "BRUNCH";
export type IngestSource = "TISTORY_BLOG" | "VELOG" | "BRUNCH" | "NAVER_BLOG";

export type BlogTarget = {
  clientSlug: string;
  clientName: string;
  platform: BlogPlatform;
  blogUserId: string;
  blogUrl?: string;
  name?: string;
};

export type PostInput = {
  externalId: string;
  title?: string;
  url?: string;
  publishedAt?: string;
};

export type PostDailyStat = {
  externalId: string;
  date: string;
  views: number;
  likes?: number;
  comments?: number;
};

function assertOk<T>(data: T | null, error: { message: string } | null, label: string): T {
  if (error) throw new Error(`${label}: ${error.message}`);
  if (data == null) throw new Error(`${label}: 응답이 비었습니다.`);
  return data;
}

export async function ensureBlog(target: BlogTarget) {
  const sb = createSupabaseClient();
  const now = new Date().toISOString();

  const existingClient = await sb.from("clients").select("id").eq("slug", target.clientSlug).maybeSingle();
  if (existingClient.error) throw new Error(`clients: ${existingClient.error.message}`);

  const clientId = existingClient.data?.id ?? randomUUID();
  if (!existingClient.data) {
    const created = await sb.from("clients").insert({
      id: clientId,
      name: target.clientName,
      slug: target.clientSlug,
      timezone: "Asia/Seoul",
      created_at: now,
      updated_at: now,
    });
    if (created.error) throw new Error(`clients insert: ${created.error.message}`);
  }

  const existingBlog = await sb
    .from("blogs")
    .select("id")
    .eq("platform", target.platform)
    .eq("blog_user_id", target.blogUserId)
    .maybeSingle();
  if (existingBlog.error) throw new Error(`blogs: ${existingBlog.error.message}`);

  const blogId = existingBlog.data?.id ?? randomUUID();
  const blogRow = {
    id: blogId,
    client_id: clientId,
    platform: target.platform,
    blog_user_id: target.blogUserId,
    name: target.name ?? target.blogUserId,
    url: target.blogUrl ?? null,
    last_synced_at: now,
    updated_at: now,
  };

  if (existingBlog.data) {
    const updated = await sb.from("blogs").update(blogRow).eq("id", blogId);
    if (updated.error) throw new Error(`blogs update: ${updated.error.message}`);
  } else {
    const created = await sb.from("blogs").insert({ ...blogRow, created_at: now });
    if (created.error) throw new Error(`blogs insert: ${created.error.message}`);
  }

  return { clientId, blogId };
}

export async function upsertDailySnapshots(
  target: BlogTarget,
  snapshots: DailySnapshot[],
  source: IngestSource,
) {
  const sb = createSupabaseClient();
  const { clientId, blogId } = await ensureBlog(target);
  const now = new Date().toISOString();
  let daily = 0;
  let sources = 0;
  let devices = 0;

  for (const row of snapshots) {
    const existing = await sb
      .from("blog_stats_daily")
      .select("id")
      .eq("blog_id", blogId)
      .eq("stat_date", row.date)
      .maybeSingle();
    if (existing.error) throw new Error(`blog_stats_daily: ${existing.error.message}`);

    const payload = {
      blog_id: blogId,
      stat_date: row.date,
      views: row.views ?? 0,
      visitors: row.visitors ?? 0,
      cumulative_views: row.cumulativeViews ?? null,
      cumulative_visitors: row.cumulativeVisitors ?? null,
      raw_json: row,
      collected_at: now,
    };

    if (existing.data?.id) {
      const updated = await sb.from("blog_stats_daily").update(payload).eq("id", existing.data.id);
      if (updated.error) throw new Error(`blog_stats_daily update: ${updated.error.message}`);
    } else {
      const inserted = await sb.from("blog_stats_daily").insert({ id: randomUUID(), ...payload });
      if (inserted.error) throw new Error(`blog_stats_daily insert: ${inserted.error.message}`);
    }
    daily += 1;

    for (const sourceRow of row.sources) {
      const found = await sb
        .from("blog_traffic_sources_daily")
        .select("id")
        .eq("blog_id", blogId)
        .eq("stat_date", row.date)
        .eq("category", sourceRow.category)
        .eq("source_code", sourceRow.sourceCode)
        .maybeSingle();
      if (found.error) throw new Error(found.error.message);
      const srcPayload = {
        blog_id: blogId,
        stat_date: row.date,
        category: sourceRow.category,
        source_code: sourceRow.sourceCode,
        source_name: sourceRow.sourceName,
        views: sourceRow.views,
        collected_at: now,
      };
      if (found.data?.id) {
        const updated = await sb.from("blog_traffic_sources_daily").update(srcPayload).eq("id", found.data.id);
        if (updated.error) throw new Error(updated.error.message);
      } else {
        const inserted = await sb.from("blog_traffic_sources_daily").insert({ id: randomUUID(), ...srcPayload });
        if (inserted.error) throw new Error(inserted.error.message);
      }
      sources += 1;
    }

    for (const device of row.devices) {
      const found = await sb
        .from("blog_device_stats_daily")
        .select("id")
        .eq("blog_id", blogId)
        .eq("stat_date", row.date)
        .eq("device_type", device.deviceType)
        .maybeSingle();
      if (found.error) throw new Error(found.error.message);
      const devicePayload = {
        blog_id: blogId,
        stat_date: row.date,
        device_type: device.deviceType,
        views: device.views ?? 0,
        share_pct: device.sharePct ?? null,
        collected_at: now,
      };
      if (found.data?.id) {
        const updated = await sb.from("blog_device_stats_daily").update(devicePayload).eq("id", found.data.id);
        if (updated.error) throw new Error(updated.error.message);
      } else {
        const inserted = await sb.from("blog_device_stats_daily").insert({ id: randomUUID(), ...devicePayload });
        if (inserted.error) throw new Error(inserted.error.message);
      }
      devices += 1;
    }

    for (const post of row.popularPosts) {
      if (!post.title) continue;
      const found = await sb
        .from("blog_popular_posts_daily")
        .select("id")
        .eq("blog_id", blogId)
        .eq("stat_date", row.date)
        .eq("rank", post.rank)
        .maybeSingle();
      const postPayload = {
        blog_id: blogId,
        stat_date: row.date,
        rank: post.rank,
        title: post.title,
        url: post.url ?? null,
        views: post.views,
        collected_at: now,
      };
      if (found.data?.id) {
        await sb.from("blog_popular_posts_daily").update(postPayload).eq("id", found.data.id);
      } else {
        await sb.from("blog_popular_posts_daily").insert({ id: randomUUID(), ...postPayload });
      }
    }

    for (const keyword of row.inflowKeywords) {
      if (!keyword.keyword) continue;
      const found = await sb
        .from("blog_inflow_keywords_daily")
        .select("id")
        .eq("blog_id", blogId)
        .eq("stat_date", row.date)
        .eq("keyword", keyword.keyword)
        .maybeSingle();
      const kwPayload = {
        blog_id: blogId,
        stat_date: row.date,
        keyword: keyword.keyword,
        rank: keyword.rank ?? null,
        views: keyword.views,
        collected_at: now,
      };
      if (found.data?.id) {
        await sb.from("blog_inflow_keywords_daily").update(kwPayload).eq("id", found.data.id);
      } else {
        await sb.from("blog_inflow_keywords_daily").insert({ id: randomUUID(), ...kwPayload });
      }
    }
  }

  await sb.from("ingest_batches").insert({
    id: randomUUID(),
    client_id: clientId,
    source,
    status: "SUCCESS",
    period_start: snapshots[0]?.date ?? null,
    period_end: snapshots.at(-1)?.date ?? null,
    row_count: snapshots.length,
    started_at: now,
    finished_at: now,
    created_at: now,
  });

  return { daily, sources, devices, blogId };
}

export async function upsertPostsAndStats(target: BlogTarget, posts: PostInput[], stats: PostDailyStat[]) {
  const sb = createSupabaseClient();
  const { blogId } = await ensureBlog(target);
  const now = new Date().toISOString();
  const postIds = new Map<string, string>();

  for (const post of posts) {
    const found = await sb
      .from("blog_posts")
      .select("id")
      .eq("blog_id", blogId)
      .eq("external_id", post.externalId)
      .maybeSingle();
    if (found.error) throw new Error(found.error.message);
    const id = found.data?.id ?? randomUUID();
    const payload = {
      blog_id: blogId,
      external_id: post.externalId,
      title: post.title ?? null,
      url: post.url ?? null,
      published_at: post.publishedAt ?? null,
      updated_at: now,
    };
    if (found.data?.id) {
      const updated = await sb.from("blog_posts").update(payload).eq("id", id);
      if (updated.error) throw new Error(updated.error.message);
    } else {
      const inserted = await sb.from("blog_posts").insert({ id, ...payload, created_at: now });
      if (inserted.error) throw new Error(inserted.error.message);
    }
    postIds.set(post.externalId, id);
  }

  for (const stat of stats) {
    const postId = postIds.get(stat.externalId);
    if (!postId) continue;
    const found = await sb
      .from("blog_post_stats_daily")
      .select("id")
      .eq("post_id", postId)
      .eq("stat_date", stat.date)
      .maybeSingle();
    const payload = {
      post_id: postId,
      stat_date: stat.date,
      views: stat.views,
      likes: stat.likes ?? null,
      comments: stat.comments ?? null,
      collected_at: now,
    };
    if (found.data?.id) {
      const updated = await sb.from("blog_post_stats_daily").update(payload).eq("id", found.data.id);
      if (updated.error) throw new Error(updated.error.message);
    } else {
      const inserted = await sb.from("blog_post_stats_daily").insert({ id: randomUUID(), ...payload });
      if (inserted.error) throw new Error(inserted.error.message);
    }
  }

  return { blogId, posts: posts.length, stats: stats.length };
}

export { assertOk };
