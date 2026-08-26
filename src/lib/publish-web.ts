import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "../collectors/shared/chrome.js";
import { putAppDocument, type AppDocId } from "./app-documents.js";
import { buildReportFromLocalFiles } from "../web/load-report.js";
import { buildAdsFromLocalFiles } from "../web/load-ads.js";

export async function publishWebDoc(id: AppDocId) {
  if (id === "report") {
    await putAppDocument("report", buildReportFromLocalFiles());
    return;
  }
  if (id === "ads") {
    await putAppDocument("ads", buildAdsFromLocalFiles());
    return;
  }
  const file = join(root, "src/web/public/wbs-data.json");
  if (!existsSync(file)) throw new Error("wbs-data.json 이 없습니다.");
  await putAppDocument("wbs", JSON.parse(readFileSync(file, "utf8")));
}

export async function publishWebDocs(ids: AppDocId[] = ["report", "ads", "wbs"]) {
  for (const id of ids) {
    try {
      await publishWebDoc(id);
      console.log(`Supabase 문서 저장: ${id}`);
    } catch (error) {
      console.log(`Supabase 문서 저장 실패 (${id}): ${error instanceof Error ? error.message : error}`);
    }
  }
}
