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
