import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureDir, root } from "./chrome.js";
import type { AdsCaptureFile } from "./types.js";

export function latestPath() {
  return resolve(root, "data/ads-raw/latest.json");
}

export function loadLatestCapture(): AdsCaptureFile | null {
  const file = latestPath();
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as AdsCaptureFile;
  } catch {
    return null;
  }
}

export function saveAdsCapture(capture: AdsCaptureFile, opts?: { stamp?: boolean }) {
  const dir = resolve(root, "data/ads-raw");
  ensureDir(dir);
  const json = JSON.stringify(capture, null, 2);
  const latest = resolve(dir, "latest.json");
  const tmp = resolve(dir, "latest.json.tmp");
  writeFileSync(tmp, json, "utf8");
  renameSync(tmp, latest);
  if (opts?.stamp === false) return latest;
  const stamped = resolve(dir, `${capture.capturedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(stamped, json, "utf8");
  return stamped;
}
