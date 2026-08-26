import { config as loadEnv } from "dotenv";
import { openPersistentChrome, pageOn, releaseChrome } from "./shared/chrome.js";
import { blogTargets } from "./shared/targets.js";

loadEnv();

/**
 * 티스토리·벨로그·브런치가 같은 구글 세션을 쓰도록 공용 크롬만 엽니다.
 * 이 창은 닫지 않습니다. 수집기도 같은 창에 붙습니다.
 */
async function main() {
  const targets = blogTargets();
  const context = await openPersistentChrome();

  await pageOn(context, /tbell\.tistory\.com\/manage\/statistics\/blog/i, targets.tistoryStatsUrl);
  await pageOn(context, /velog\.io\/@tbell\/posts/i, targets.velogPostsUrl);
  await pageOn(context, /brunch\.co\.kr\/@tbell\/stats/i, targets.brunchStatsUrl);

  console.log("통계 주소 탭:");
  console.log(`  티스토리 ${targets.tistoryStatsUrl}`);
  console.log(`  벨로그 ${targets.velogPostsUrl}`);
  console.log(`  브런치 ${targets.brunchStatsUrl}`);
  console.log("이 크롬 창은 닫지 마세요. 수집할 때도 이 탭을 그대로 씁니다.");

  await releaseChrome(context);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
