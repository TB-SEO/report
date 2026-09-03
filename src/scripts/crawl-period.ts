import { spawn } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { crawlRange } from "../collectors/shared/crawl-range.js";

loadEnv();

function run(script: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("npx", ["tsx", script, ...args], {
      stdio: "inherit",
      env,
      shell: true,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited ${code}`));
    });
  });
}

async function main() {
  const { from, to } = crawlRange();
  if (!from || !to) {
    throw new Error("기간을 지정하세요. 예: --from=2026-08-28 --to=2026-08-30 또는 --yesterday");
  }
  const span = [`--from=${from}`, `--to=${to}`];
  console.log(`블로그 · 검색광고 수집 ${from} ~ ${to}`);

  console.log("\n===== tistory =====");
  await run("src/collectors/tistory/crawl.ts", span);
  console.log("\n===== velog =====");
  await run("src/collectors/velog/crawl.ts", span);
  console.log("\n===== brunch =====");
  await run("src/collectors/brunch/crawl.ts", span);
  console.log("\n===== ads =====");
  await run("src/collectors/ads/crawl.ts", [], {
    ...process.env,
    ADS_DATE_FROM: from,
    ADS_DATE_TO: to,
  });
  console.log(`\n수집 완료 ${from} ~ ${to}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
