export type BlogTargets = {
  tistoryId: string;
  velogUser: string;
  brunchId: string;
  tistoryStatsUrl: string;
  velogPostsUrl: string;
  brunchStatsUrl: string;
};

export function blogTargets(): BlogTargets {
  const tistoryId = process.env.TISTORY_BLOG_ID?.trim() || "tbell";
  const velogUser = process.env.VELOG_USERNAME?.trim() || tistoryId;
  const brunchId = process.env.BRUNCH_ID?.trim() || tistoryId;
  const tistoryBlog = (process.env.TISTORY_BLOG_URL?.trim() || `https://${tistoryId}.tistory.com`).replace(/\/$/, "");
  const statsPath = process.env.TISTORY_STATS_PATH?.trim() || "/manage/statistics/blog";
  return {
    tistoryId,
    velogUser,
    brunchId,
    tistoryStatsUrl:
      process.env.TISTORY_STATS_URL?.trim() ||
      `${tistoryBlog}${statsPath.startsWith("/") ? statsPath : `/${statsPath}`}`,
    velogPostsUrl: process.env.VELOG_POSTS_URL?.trim() || `https://velog.io/@${velogUser}/posts`,
    brunchStatsUrl: process.env.BRUNCH_STATS_URL?.trim() || `https://brunch.co.kr/@${brunchId}/stats`,
  };
}
