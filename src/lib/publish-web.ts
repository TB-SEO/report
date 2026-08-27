import { putAppDocument, type AppDocId } from "./app-documents.js";
import { buildReportFromLocalFiles } from "../web/load-report.js";
import { buildAdsFromLocalFiles } from "../web/load-ads.js";
import { loadPublishedWbs } from "../web/load-wbs.js";

export async function publishWebDoc(id: AppDocId) {
  if (id === "report") {
    await putAppDocument("report", buildReportFromLocalFiles());
    return;
  }
  if (id === "ads") {
    await putAppDocument("ads", buildAdsFromLocalFiles());
    return;
  }
  await putAppDocument("wbs", await loadPublishedWbs(true));
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
