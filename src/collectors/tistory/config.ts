import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function optional(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value || value === "your-blog") return "";
  return value;
}

export type AppConfig = {
  clientSlug: string;
  clientName: string;
  blogUserId: string;
  blogUrl: string;
  statsUrl: string;
  chromeProfileDir: string;
  rawDir: string;
};

export function loadConfig(): AppConfig {
  const blogUserId = optional("TISTORY_BLOG_ID");
  const blogUrl = (optional("TISTORY_BLOG_URL") || (blogUserId ? `https://${blogUserId}.tistory.com` : "")).replace(
    /\/$/,
    "",
  );
  const statsPath = process.env.TISTORY_STATS_PATH?.trim() || "/manage/statistics/blog";
  return {
    clientSlug: optional("CLIENT_SLUG") || blogUserId || "default",
    clientName: optional("CLIENT_NAME") || blogUserId || "default",
    blogUserId,
    blogUrl,
    statsUrl: blogUrl ? `${blogUrl}${statsPath.startsWith("/") ? statsPath : `/${statsPath}`}` : "https://www.tistory.com/manage",
    chromeProfileDir: resolve(root, process.env.TISTORY_CHROME_PROFILE ?? "secrets/tistory-chrome-profile"),
    rawDir: resolve(root, "data/tistory-raw"),
  };
}

export function withBlog(cfg: AppConfig, blogUserId: string, blogUrl: string): AppConfig {
  const statsPath = process.env.TISTORY_STATS_PATH?.trim() || "/manage/statistics/blog";
  return {
    ...cfg,
    blogUserId,
    blogUrl,
    clientSlug: cfg.clientSlug === "default" ? blogUserId : cfg.clientSlug,
    clientName: cfg.clientName === "default" ? blogUserId : cfg.clientName,
    statsUrl: `${blogUrl}${statsPath.startsWith("/") ? statsPath : `/${statsPath}`}`,
  };
}

export function ensureParentDir(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
}

export function ensureDir(dirPath: string) {
  if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
}

export { root };
