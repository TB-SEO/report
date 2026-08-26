import { config as loadEnv } from "dotenv";
import { openAdsChrome, pageOn, releaseChrome } from "./chrome.js";

loadEnv();

const NAVER =
  process.env.NAVER_ADS_CAMPAIGNS_URL?.trim() ||
  "https://ads.naver.com/manage/ad-accounts/1808636/sa/campaigns-by/WEB_SITE";
const GOOGLE =
  process.env.GOOGLE_ADS_KEYWORDS_URL?.trim() ||
  "https://ads.google.com/aw/keywords?ocid=318165752";

async function main() {
  const context = await openAdsChrome();
  await pageOn(context, /ads\.naver\.com/i, NAVER);
  await pageOn(context, /ads\.google\.com/i, GOOGLE);

  console.log("키워드 광고 전용 크롬 (블로그 수집 창과 다른 포트/프로필):");
  console.log(`  CDP ${process.env.CHROME_CDP_PORT}`);
  console.log(`  네이버 ${NAVER}`);
  console.log(`  구글   ${GOOGLE}`);
  console.log("이 창은 닫지 마세요. 네이버·구글 광고 로그인을 마친 뒤 npm run ads:crawl 을 실행합니다.");

  await releaseChrome(context);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
