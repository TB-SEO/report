import { readdirSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { loadConfig } from "./config.js";
import { extractSeriesFromJson, mergeSnapshots, parseTistoryPageText } from "./parse.js";
import { parseTistoryNetwork } from "./parse-api.js";
import type { CaptureFile, DailySnapshot } from "./types.js";
import { upsertTistorySnapshots, disconnectDb } from "./upsert.js";

loadEnv();

async function main() {
  const cfg = loadConfig();
  const files = readdirSync(cfg.rawDir)
    .filter((name) => extname(name) === ".json")
    .map((name) => resolve(cfg.rawDir, name));

  if (!files.length) {
    throw new Error(`${cfg.rawDir} 에 캡처 JSON이 없습니다. 먼저 tistory:collect 또는 브라우저 캡처를 실행하세요.`);
  }

  const snapshots: DailySnapshot[] = [];
  for (const file of files) {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as CaptureFile | DailySnapshot[];
    if (Array.isArray(parsed)) {
      snapshots.push(...parsed);
      continue;
    }
    if (parsed.snapshots?.length) snapshots.push(...parsed.snapshots);
    if (parsed.pageText) {
      const fromText = parseTistoryPageText(parsed.pageText);
      if (fromText) snapshots.push(fromText);
    }
    if (parsed.networkJson?.length) {
      snapshots.push(...parseTistoryNetwork(parsed.networkJson));
    }
    for (const item of parsed.networkJson ?? []) {
      snapshots.push(...extractSeriesFromJson(item.body));
    }
  }

  const merged = mergeSnapshots(snapshots);
  console.log(`정규화된 날짜 ${merged.length}건`);
  if (merged.length) console.log(`기간: ${merged[0].date} ~ ${merged.at(-1)?.date}`);

  try {
    const result = await upsertTistorySnapshots(cfg, merged);
    await disconnectDb();
    console.log(`적재 완료: ${merged.length}일 / daily ${result.daily} / sources ${result.sources}`);
  } catch (error) {
    await disconnectDb().catch(() => undefined);
    console.log("DB가 없어 파일 정규화만 했습니다. Docker를 켠 뒤 다시 ingest 하면 됩니다.");
    console.log(error instanceof Error ? error.message : error);
  }
  await import("../../lib/publish-web.js").then((mod) => mod.publishWebDocs(["report"]));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
