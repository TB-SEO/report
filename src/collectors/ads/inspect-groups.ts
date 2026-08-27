import { config as loadEnv } from "dotenv";
import { openAdsChrome, releaseChrome } from "./chrome.js";
import { closeKeywordAdsTabs, gotoQuiet, listNaverCampaignGroups, openFreshPage, setNaverSameDay, sleep } from "./scrape.js";

loadEnv();

const CAMP = "https://ads.naver.com/manage/ad-accounts/1808636/sa/campaigns/cmp-a001-01-000000010822871";
const days = process.argv.slice(2).filter((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg));
const targets = days.length ? days : ["2026-08-02", "2026-08-09", "2026-09-02"];

async function main() {
  const context = await openAdsChrome();
  await closeKeywordAdsTabs("naver");
  const page = await openFreshPage(context, CAMP);
  if (!page) throw new Error("캠페인 탭 실패");
  for (const date of targets) {
    const ok = await setNaverSameDay(page, date);
    await sleep(2500);
    const trigger = page.locator("button.ad-cms-btn.ad-cms-btn-variant-text.ad-cms-btn-lg").filter({ hasText: /\d{4}\.\d{2}\.\d{2}/ }).first();
    const shown = ((await trigger.textContent().catch(() => "")) || "").replace(/\s+/g, " ");
    const parsed = await listNaverCampaignGroups(page);
    const snippets = await page.evaluate(`(() => {
      return [...document.querySelectorAll("tr, [role=row], .ag-row")].slice(0, 12).map((row) => (row.innerText || "").replace(/\\s+/g, " ").trim()).filter(Boolean);
    })()`);
    console.log(`DATE ${date} set=${ok} trigger=${shown}`);
    console.log(`PARSED ${JSON.stringify(parsed)}`);
    for (const line of snippets as string[]) console.log(`ROW ${line.slice(0, 240)}`);
    console.log("---");
  }
  await page.close().catch(() => undefined);
  await releaseChrome(context);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
