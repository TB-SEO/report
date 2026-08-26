import { config as loadEnv } from "dotenv";
import { openAdsChrome, releaseChrome } from "./chrome.js";
import { crawlNaverAds } from "./naver.js";
import { crawlGoogleAds } from "./google.js";
import { parseAdsCapture } from "./parse.js";
import { defaultRangeKst } from "./dates.js";
import { loadLatestCapture, saveAdsCapture } from "./save.js";
import type { AdsCaptureFile, PlatformCapture } from "./types.js";

loadEnv();

async function main() {
  const googleOnly = process.argv.includes("--google-only");
  const dateRange = defaultRangeKst();
  const context = await openAdsChrome();
  const extras = context.pages().filter((page) => page.url() === "about:blank" || /chrome-error|chrome:\/\//i.test(page.url()));
  for (const extra of extras) await extra.close().catch(() => undefined);
  console.log(`기간 ${dateRange[0]} ~ ${dateRange[1]} (CDP ${process.env.CHROME_CDP_PORT}) — ${googleOnly ? "구글만" : "구글+네이버"} 긁습니다.`);

  const empty: PlatformCapture = { notes: [], networkJson: [], tables: [] };
  const prev = loadLatestCapture();
  const capture: AdsCaptureFile = {
    capturedAt: new Date().toISOString(),
    dateRange,
    naver: prev?.naver ?? empty,
    google: prev?.google ?? empty,
  };

  const google = await crawlGoogleAds(context, dateRange, (byDate, notes) => {
    capture.google = {
      pageUrl: capture.google.pageUrl,
      loggedIn: true,
      notes,
      networkJson: [{ url: "scrape://google-keywords", body: byDate }],
      tables: [],
    };
    capture.dateRange = dateRange;
    saveAdsCapture(capture, { stamp: false });
  });
  capture.google = google;
  saveAdsCapture(capture);
  if (googleOnly) {
    capture.capturedAt = new Date().toISOString();
    const file = saveAdsCapture(capture);
    const parsed = parseAdsCapture(capture);
    console.log(`저장 ${file} (구글만)`);
    console.log(`구글 캠페인 ${parsed.campaigns.filter((c) => c.platform === "GOOGLE").length}`);
    for (const note of google.notes) console.log(`  - ${note}`);
    await import("../../lib/publish-web.js").then((mod) => mod.publishWebDocs(["ads"]));
    await releaseChrome(context);
    return;
  }
  console.log("구글 수집분을 latest.json 에 먼저 저장했습니다. 이어서 네이버를 긁습니다.");

  const naver = await crawlNaverAds(context, dateRange, (tree, notes) => {
    capture.naver = {
      pageUrl: capture.naver.pageUrl,
      loggedIn: true,
      notes,
      networkJson: [{ url: "scrape://naver-tree", body: tree }],
      tables: [],
    };
    saveAdsCapture(capture, { stamp: false });
  });
  capture.naver = naver;
  capture.capturedAt = new Date().toISOString();
  const file = saveAdsCapture(capture);

  const parsed = parseAdsCapture(capture);
  console.log(`저장 ${file}`);
  console.log(`네이버 캠페인 ${parsed.campaigns.filter((c) => c.platform === "NAVER").length} / 구글 ${parsed.campaigns.filter((c) => c.platform === "GOOGLE").length}`);
  for (const note of [...naver.notes, ...google.notes]) console.log(`  - ${note}`);

  await import("../../lib/publish-web.js").then((mod) => mod.publishWebDocs(["ads"]));
  await releaseChrome(context);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
