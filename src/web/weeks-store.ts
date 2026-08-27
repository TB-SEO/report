import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
export const weeksDir = resolve(dir, "public/weeks");
export const publicDir = resolve(dir, "public");

export type WeekSnapshot = {
  weekId: string;
  from: string;
  to: string;
  savedAt: string;
  sections: Record<string, string>;
  report?: unknown;
  ads?: unknown;
  service?: unknown;
  wbs?: unknown;
};

export function addDays(ymd: string, delta: number) {
  const date = new Date(`${ymd}T12:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + delta);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}

/** 오늘을 포함한 가장 최근 수요일 */
export function lastWednesday(ymd: string) {
  const dow = new Date(`${ymd}T12:00:00+09:00`).getUTCDay();
  const since = (dow + 4) % 7;
  return addDays(ymd, -since);
}

/** 그 주 목요일 ~ 수요일 */
export function weekRange(wednesday: string) {
  return { from: addDays(wednesday, -6), to: wednesday };
}

export function extractDivInner(html: string, id: string) {
  const token = `id="${id}"`;
  const tokenPos = html.indexOf(token);
  if (tokenPos < 0) return "";
  const gt = html.indexOf(">", tokenPos);
  let i = gt + 1;
  let depth = 1;
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf("<div", i);
    const nextClose = html.indexOf("</div>", i);
    if (nextClose < 0) break;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      i = nextOpen + 4;
    } else {
      depth -= 1;
      if (depth === 0) return html.slice(gt + 1, nextClose);
      i = nextClose + 6;
    }
  }
  return "";
}

function ensureWeeksDir() {
  mkdirSync(weeksDir, { recursive: true });
}

export function listWeeks(): string[] {
  ensureWeeksDir();
  const indexFile = resolve(weeksDir, "index.json");
  if (!existsSync(indexFile)) return [];
  try {
    const parsed = JSON.parse(readFileSync(indexFile, "utf8")) as { weeks?: string[] };
    return [...new Set(parsed.weeks ?? [])].sort();
  } catch {
    return [];
  }
}

export function readWeek(weekId: string): WeekSnapshot | null {
  const file = resolve(weeksDir, `${weekId}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as WeekSnapshot;
}

export function writeWeek(snapshot: WeekSnapshot) {
  ensureWeeksDir();
  writeFileSync(resolve(weeksDir, `${snapshot.weekId}.json`), JSON.stringify(snapshot), "utf8");
  const weeks = [...new Set([...listWeeks(), snapshot.weekId])].sort();
  writeFileSync(resolve(weeksDir, "index.json"), JSON.stringify({ weeks }, null, 2), "utf8");
}

export async function listWeeksLive(): Promise<string[]> {
  try {
    const { getAppDocument } = await import("../lib/app-documents.js");
    const stored = await getAppDocument<{ weeks: string[] }>("weeks");
    if (stored?.payload?.weeks?.length) return [...new Set(stored.payload.weeks)].sort();
  } catch {
    // 파일 목록으로 이어감
  }
  return listWeeks();
}

export async function readWeekLive(weekId: string): Promise<WeekSnapshot | null> {
  try {
    const { getAppDocument } = await import("../lib/app-documents.js");
    const stored = await getAppDocument<WeekSnapshot>(`week-${weekId}`);
    if (stored?.payload) return stored.payload;
  } catch {
    // 파일 저장본으로 이어감
  }
  return readWeek(weekId);
}

export async function writeWeekLive(snapshot: WeekSnapshot) {
  writeWeek(snapshot);
  const weeks = listWeeks();
  try {
    const { putAppDocument } = await import("../lib/app-documents.js");
    await putAppDocument("weeks", { weeks });
    await putAppDocument(`week-${snapshot.weekId}`, snapshot);
  } catch (error) {
    console.log(`Supabase 주간보고 저장 실패: ${error instanceof Error ? error.message : error}`);
  }
}
