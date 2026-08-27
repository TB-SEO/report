import { config as loadEnv } from "dotenv";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { loadReport } from "./load-report.js";
import { adsPayload } from "./load-ads.js";
import { loadPublishedWbs } from "./load-wbs.js";
import { loadServiceReport } from "./load-service.js";
import { listWeeksLive, readWeekLive, weekRange } from "./weeks-store.js";
import { saveWeek } from "../scripts/save-week.js";

loadEnv();

const dir = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(dir, "public");
const port = Number(process.env.WEB_PORT?.trim() || "3456");

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const server = createServer((req, res) => {
  const url = req.url?.split("?")[0] || "/";

  const sendJson = (status: number, body: unknown, extra: Record<string, string> = {}) => {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    });
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };

  void (async () => {
    try {
      if (url === "/api/report") {
        sendJson(200, await loadReport());
        return;
      }
      if (url === "/api/ads") {
        const payload = await adsPayload();
        const gzip = (req.headers["accept-encoding"] || "").includes("gzip");
        sendJson(200, gzip ? payload.gzip : payload.json, gzip ? { "content-encoding": "gzip" } : {});
        return;
      }
      if (url === "/api/wbs") {
        sendJson(200, await loadPublishedWbs());
        return;
      }
      if (url === "/api/service") {
        sendJson(200, await loadServiceReport());
        return;
      }
      if (url === "/api/weeks") {
        sendJson(200, { weeks: await listWeeksLive() });
        return;
      }
      if (url.startsWith("/api/weeks/")) {
        const weekId = decodeURIComponent(url.slice("/api/weeks/".length));
        if (!/^\d{4}-\d{2}-\d{2}$/.test(weekId)) {
          sendJson(400, { error: "weekId 는 YYYY-MM-DD 수요일입니다." });
          return;
        }
        if (req.method === "POST") {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const raw = Buffer.concat(chunks).toString("utf8") || "{}";
          const body = JSON.parse(raw);
          const snapshot = await saveWeek(weekId, body.sections);
          sendJson(200, { ok: true, weekId: snapshot.weekId, from: snapshot.from, to: snapshot.to });
          return;
        }
        const found = await readWeekLive(weekId);
        if (!found) {
          sendJson(404, { error: "해당 주 저장본이 없습니다.", weekId, ...weekRange(weekId) });
          return;
        }
        sendJson(200, found);
        return;
      }

      const file =
        url === "/"
          ? "index.html"
          : url === "/blog"
            ? "blog.html"
            : url === "/check"
              ? "check.html"
              : url === "/ads" || url === "/keyword"
                ? "ads.html"
                : url === "/wbs"
                  ? "wbs.html"
                  : url === "/service"
                    ? "service.html"
                    : url.slice(1);
      if (file.endsWith("wbs-data.json")) {
        sendJson(200, await loadPublishedWbs());
        return;
      }
      const body = readFileSync(resolve(publicDir, file));
      res.writeHead(200, { "content-type": types[extname(file)] || "text/plain; charset=utf-8", "cache-control": "no-store" });
      res.end(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) sendJson(500, { error: message });
    }
  })();
});

server.listen(port, "127.0.0.1", () => {
  console.log(`http://127.0.0.1:${port}`);
});
