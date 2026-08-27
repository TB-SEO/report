import { config as loadEnv } from "dotenv";
import { openAdsChrome, releaseChrome } from "./chrome.js";
import { crawlNaverAds, mergeNaverTrees } from "./naver.js";
import { crawlGoogleAds, mergeGoogleByDate } from "./google.js";
import { parseAdsCapture } from "./parse.js";
import { kstToday } from "./dates.js";
import { loadLatestCapture, saveAdsCapture } from "./save.js";
import { closeKeywordAdsTabs } from "./scrape.js";
import type { AdsCaptureFile, PlatformCapture } from "./types.js";

loadEnv();

async function main() {
  const naverOnly = process.argv.includes("--naver-only");
  const googleOnly = process.argv.includes("--google-only");
  const crawlFrom = process.env.ADS_DATE_FROM?.trim() || "2026-07-01";
  const crawlTo = process.env.ADS_DATE_TO?.trim() || kstToday();
  const prev = loadLatestCapture();
  const dateRange: [string, string] = [
    [prev?.dateRange?.[0], crawlFrom].filter(Boolean).sort()[0] as string,
    [prev?.dateRange?.[1], crawlTo].filter(Boolean).sort().at(-1) as string,
  ];
  const context = await openAdsChrome();
  await closeKeywordAdsTabs(googleOnly ? "google" : naverOnly ? "naver" : "both");
  console.log(
    `기간 ${crawlFrom} ~ ${crawlTo} 수집 / 저장 범위 ${dateRange[0]} ~ ${dateRange[1]} (CDP ${process.env.CHROME_CDP_PORT}) — ${googleOnly ? "구글만" : naverOnly ? "네이버만" : "구글+네이버"}`,
  );

  const empty: PlatformCapture = { notes: [], networkJson: [], tables: [] };
  const capture: AdsCaptureFile = {
    capturedAt: new Date().toISOString(),
    dateRange,
    naver: prev?.naver ?? empty,
    google: prev?.google ?? empty,
  };

  if (!naverOnly) {
    const prevGoogle = prev?.google?.networkJson?.find((item) => String(item.url || "").includes("google-keywords"));
    const prevByDate =
      prevGoogle?.body && typeof prevGoogle.body === "object" && !Array.isArray(prevGoogle.body)
        ? (prevGoogle.body as Record<string, unknown[]>)
        : {};
    const google = await crawlGoogleAds(context, [crawlFrom, crawlTo], (byDate, notes) => {
      capture.google = {
        pageUrl: capture.google.pageUrl,
        loggedIn: true,
        notes,
        networkJson: [{ url: "scrape://google-keywords", body: mergeGoogleByDate(prevByDate, byDate) }],
        tables: [],
      };
      capture.dateRange = dateRange;
      saveAdsCapture(capture, { stamp: false });
    });
    capture.google = {
      ...google,
      networkJson: [
        {
          url: "scrape://google-keywords",
          body: mergeGoogleByDate(prevByDate, (google.networkJson[0]?.body as Record<string, unknown[]>) ?? {}),
        },
      ],
    };
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
  }

  const prevNaverTree = () => {
    const block = prev?.naver?.networkJson?.find((item) => String(item.url || "").includes("naver-tree"));
    return Array.isArray(block?.body) ? (block.body as unknown[]) : [];
  };
  const crawled = await crawlNaverAds(context, [crawlFrom, crawlTo], (tree, notes) => {
    capture.naver = {
      pageUrl: capture.naver.pageUrl,
      loggedIn: true,
      notes,
      networkJson: [{ url: "scrape://naver-tree", body: mergeNaverTrees(prevNaverTree(), tree) }],
      tables: [],
    };
    saveAdsCapture(capture, { stamp: false });
  });
  capture.naver = {
    ...crawled,
    notes: [...(prev?.naver?.notes ?? []), ...crawled.notes],
    networkJson: [{ url: "scrape://naver-tree", body: mergeNaverTrees(prevNaverTree(), crawled.networkJson[0]?.body as unknown[]) }],
  };
  capture.capturedAt = new Date().toISOString();
  const file = saveAdsCapture(capture);

  const parsed = parseAdsCapture(capture);
  console.log(`저장 ${file}`);
  console.log(
    `네이버 캠페인 ${parsed.campaigns.filter((c) => c.platform === "NAVER").length} / 구글 ${parsed.campaigns.filter((c) => c.platform === "GOOGLE").length}`,
  );
  for (const note of crawled.notes) console.log(`  - ${note}`);

  await import("../../lib/publish-web.js").then((mod) => mod.publishWebDocs(["ads"]));
  await releaseChrome(context);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
