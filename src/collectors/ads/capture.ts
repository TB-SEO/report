import type { Page, Response } from "playwright";
import type { PlatformCapture } from "./types.js";

async function safeJson(response: Response): Promise<unknown | null> {
  const type = response.headers()["content-type"] ?? "";
  if (!/json|javascript|text\/plain/i.test(type) && !/json/i.test(response.url())) return null;
  try {
    return await response.json();
  } catch {
    try {
      const text = await response.text();
      if (!text || text.length < 2) return null;
      if (text.startsWith("{") || text.startsWith("[")) return JSON.parse(text);
    } catch {
      return null;
    }
    return null;
  }
}

function summarize(body: unknown): unknown {
  const json = JSON.stringify(body);
  if (!json) return body;
  if (json.length < 80_000) return body;
  return { _truncated: true, preview: json.slice(0, 12_000), bytes: json.length };
}

export async function capturePage(page: Page, matchUrl: RegExp, waitMs = 6_000): Promise<Omit<PlatformCapture, "loggedIn" | "notes">> {
  const networkJson: PlatformCapture["networkJson"] = [];
  const onResponse = async (response: Response) => {
    const url = response.url();
    if (!matchUrl.test(url)) return;
    if (/\.(css|woff2?|png|jpe?g|gif|svg|ico|mp4)(\?|$)/i.test(url)) return;
    const body = await safeJson(response);
    if (body == null) return;
    networkJson.push({ url, status: response.status(), body: summarize(body) });
  };
  page.on("response", onResponse);
  await page.waitForTimeout(waitMs);
  page.off("response", onResponse);

  const tables = await page
    .evaluate(() => {
      const grids = [...document.querySelectorAll("table")];
      const rows: string[][] = [];
      for (const table of grids.slice(0, 4)) {
        for (const tr of [...table.querySelectorAll("tr")].slice(0, 80)) {
          const cells = [...tr.querySelectorAll("th,td")].map((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim());
          if (cells.some((cell) => cell)) rows.push(cells);
        }
      }
      return rows;
    })
    .catch(() => [] as string[][]);

  return { pageUrl: page.url(), networkJson, tables };
}
