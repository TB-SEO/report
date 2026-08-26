import { config as loadEnv } from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadReport } from "../web/load-report.js";
import { loadAdsReport } from "../web/load-ads.js";
import { loadServiceReport } from "../web/load-service.js";
import { getAppDocument } from "../lib/app-documents.js";
import {
  extractDivInner,
  lastWednesday,
  listWeeks,
  publicDir,
  weekRange,
  writeWeek,
} from "../web/weeks-store.js";

loadEnv();

const SECTION_IDS = ["sec-progress", "sec-detail", "sec-next", "sec-note"];

export async function saveWeek(weekId: string, sections?: Record<string, string>) {
  const html = readFileSync(resolve(publicDir, "index.html"), "utf8");
  const fromFile = Object.fromEntries(SECTION_IDS.map((id) => [id, extractDivInner(html, id)]));
  const { from, to } = weekRange(weekId);
  const snapshot = {
    weekId,
    from,
    to,
    savedAt: new Date().toISOString(),
    sections: { ...fromFile, ...sections },
    report: await loadReport(),
    ads: await loadAdsReport(),
    service: await loadServiceReport(),
    wbs: (await getAppDocument<unknown>("wbs"))?.payload ?? null,
  };
  writeWeek(snapshot);
  const apiDir = resolve(publicDir, "api");
  mkdirSync(apiDir, { recursive: true });
  writeFileSync(resolve(apiDir, "report.json"), JSON.stringify(snapshot.report));
  writeFileSync(resolve(apiDir, "ads.json"), JSON.stringify(snapshot.ads));
  writeFileSync(resolve(apiDir, "service.json"), JSON.stringify(snapshot.service));
  writeFileSync(resolve(apiDir, "wbs.json"), JSON.stringify(snapshot.wbs ?? { sheets: [] }));
  writeFileSync(resolve(apiDir, "weeks.json"), JSON.stringify({ weeks: listWeeks() }));

  return snapshot;
}

async function main() {
  const arg = process.argv.find((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const weekId = arg || lastWednesday(today);
  const snap = await saveWeek(weekId);
  console.log(`주간보고 저장 ${snap.weekId} (${snap.from} ~ ${snap.to})`);
}

const isMain = process.argv[1]?.includes("save-week");
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
