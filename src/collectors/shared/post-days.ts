import type { DailySnapshot } from "../tistory/types.js";

export type ListedPost = {
  externalId: string;
  title?: string;
  url?: string;
  publishedAt?: string;
};

export type PostDayStat = {
  externalId: string;
  date: string;
  views: number;
  likes?: number;
  comments?: number;
};

export function applyPostDays(snapshots: DailySnapshot[], posts: ListedPost[], stats: PostDayStat[]): DailySnapshot[] {
  const meta = new Map(posts.map((post) => [post.externalId, post]));
  const byDate = new Map<string, DailySnapshot>();
  for (const row of snapshots) {
    byDate.set(row.date, {
      ...row,
      sources: [...row.sources],
      devices: [...row.devices],
      popularPosts: [...row.popularPosts],
      inflowKeywords: [...row.inflowKeywords],
    });
  }
  const fromStats = new Map<string, DailySnapshot["popularPosts"]>();
  for (const stat of stats) {
    if (!stat.views) continue;
    const post = meta.get(stat.externalId);
    const list = fromStats.get(stat.date) ?? [];
    list.push({
      rank: 0,
      title: post?.title ?? stat.externalId,
      url: post?.url,
      views: stat.views,
    });
    fromStats.set(stat.date, list);
    if (!byDate.has(stat.date)) {
      byDate.set(stat.date, {
        date: stat.date,
        views: 0,
        sources: [],
        devices: [],
        popularPosts: [],
        inflowKeywords: [],
      });
    }
  }
  for (const [date, list] of fromStats) {
    const current = byDate.get(date);
    if (current) current.popularPosts = list;
  }
  return [...byDate.values()]
    .map((row) => ({
      ...row,
      popularPosts: row.popularPosts
        .sort((a, b) => b.views - a.views)
        .map((post, index) => ({ ...post, rank: index + 1 })),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
