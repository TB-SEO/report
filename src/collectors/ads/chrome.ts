import { config as loadEnv } from "dotenv";
import { openPersistentChrome, pageOn, releaseChrome, waitUntil, root, ensureDir } from "../shared/chrome.js";
import type { BrowserContext } from "playwright";

loadEnv();

export function applyAdsChromeEnv() {
  process.env.CHROME_PROFILE = process.env.ADS_CHROME_PROFILE?.trim() || "secrets/chrome-profiles/keyword-ads";
  process.env.CHROME_CDP_PORT = process.env.ADS_CHROME_CDP_PORT?.trim() || "19445";
  process.env.CHROME_LABEL = "키워드 광고 전용 크롬";
}

export async function openAdsChrome(): Promise<BrowserContext> {
  applyAdsChromeEnv();
  return openPersistentChrome();
}

export { pageOn, releaseChrome, waitUntil, root, ensureDir };
