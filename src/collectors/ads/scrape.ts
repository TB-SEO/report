import type { BrowserContext, Page } from "playwright";

export type Grid = {
  url: string;
  headers: string[];
  rows: Array<{ cells: string[]; href?: string }>;
};

export async function readGrid(page: Page): Promise<Grid> {
  return page.evaluate(`(() => {
    const clean = (text) => (text || "").replace(/\\s+/g, " ").trim();
    const tables = [...document.querySelectorAll("table")];
    const grids = [...document.querySelectorAll("[role=grid], [role=table], .ag-root, .ess-table-canvas")];
    const blocks = [...new Set([...tables, ...grids])];
    let best = { headers: [], rows: [], score: -1 };

    const fromTable = (root) => {
      const headers = [...root.querySelectorAll("thead th, [role=columnheader]")]
        .map((el) => clean(el.textContent))
        .filter(Boolean);
      const bodyRows = [...root.querySelectorAll("tbody tr, [role=row]")].filter((row) => !row.querySelector("[role=columnheader]"));
      const rows = bodyRows.slice(0, 800).map((row) => {
        const cells = [...row.querySelectorAll("th,td,[role=gridcell]")].map((el) => clean(el.textContent));
        const link = row.querySelector("a[href]");
        return { cells, href: link ? link.href : undefined };
      }).filter((row) => row.cells.some((cell) => cell));
      return { headers, rows };
    };

    for (const block of blocks) {
      const parsed = fromTable(block);
      const head = parsed.headers.join(" ");
      const cls = (block.className || "").toString();
      let score = parsed.rows.length;
      if (/키워드/.test(head) && /노출수/.test(head)) score += 10000;
      if (/month-selector|calendar/.test(cls) || (/일/.test(head) && /월/.test(head) && /화/.test(head))) score = -1;
      if (score > best.score) best = { ...parsed, score };
    }

    if (!best.rows.length) {
      const rows = [...document.querySelectorAll("[role=row]")].slice(0, 800);
      const headerRow = rows.find((row) => row.querySelector("[role=columnheader]"));
      best.headers = headerRow
        ? [...headerRow.querySelectorAll("[role=columnheader]")].map((el) => clean(el.textContent))
        : [];
      best.rows = rows
        .filter((row) => !row.querySelector("[role=columnheader]"))
        .map((row) => {
          const cells = [...row.querySelectorAll("[role=gridcell],td,th")].map((el) => clean(el.textContent));
          const link = row.querySelector("a[href]");
          return { cells, href: link ? link.href : undefined };
        })
        .filter((row) => row.cells.some((cell) => cell));
    }

    return { url: location.href, headers: best.headers, rows: best.rows };
  })()`) as Promise<Grid>;
}

export async function readLinks(page: Page, pattern: RegExp): Promise<string[]> {
  const hrefs = (await page.evaluate(`([...document.querySelectorAll("a[href]")].map((a) => a.href))`)) as string[];
  return [...new Set(hrefs.filter((href) => pattern.test(href)))];
}

export function colIndex(headers: string[], ...needles: RegExp[]) {
  return headers.findIndex((header) => needles.some((needle) => needle.test(header.replace(/\s+/g, ""))));
}

export function numCell(value?: string) {
  if (!value) return 0;
  const cleaned = value.replace(/[,원%\s]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function cdpBase() {
  const port = process.env.CHROME_CDP_PORT?.trim() || "19445";
  return `http://127.0.0.1:${port}`;
}

export async function gotoQuiet(page: Page, url: string) {
  const current = page.url().split("?")[0].replace(/\/$/, "");
  const target = url.split("?")[0].replace(/\/$/, "");
  if (current === target) {
    console.log(`이미 해당 페이지 ${url}`);
    return true;
  }
  console.log(`이동 ${url}`);
  const ok = await Promise.race([
    page.goto(url, { waitUntil: "domcontentloaded", timeout: 12_000 }).then(() => true).catch(() => false),
    sleep(14_000).then(() => false),
  ]);
  if (!ok) {
    console.log(`이동 시간초과 ${url}`);
    return false;
  }
  await sleep(1200);
  return true;
}

export async function openFreshPage(context: BrowserContext, url: string) {
  const before = new Set(context.pages());
  let createdId = "";
  try {
    const res = await fetch(`${cdpBase()}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    const info = (await res.json()) as { id?: string };
    createdId = info.id || "";
    console.log(`CDP 새 탭 ${createdId || "?"} → ${url}`);
  } catch (error) {
    console.log(`CDP 새 탭 실패: ${error instanceof Error ? error.message : error}`);
  }
  const deadline = Date.now() + 16_000;
  while (Date.now() < deadline) {
    const page = context.pages().find((p) => !before.has(p));
    if (page) {
      page.setDefaultNavigationTimeout(12_000);
      page.setDefaultTimeout(8_000);
      await sleep(2200);
      console.log(`새 탭 연결 ${page.url()}`);
      return page;
    }
    await sleep(350);
  }
  if (createdId) await fetch(`${cdpBase()}/json/close/${createdId}`).catch(() => undefined);
  console.log(`새 탭 실패 ${url}`);
  return null;
}

export async function scrollList(page: Page) {
  await page
    .evaluate(`(async () => {
      const els = [...document.querySelectorAll(".ag-body-viewport, [role=grid], .MuiDataGrid-virtualScroller, .ad-cms-table")].slice(0, 3);
      for (const el of els) {
        for (let i = 0; i < 8; i++) {
          el.scrollTop = el.scrollHeight;
          await new Promise((done) => setTimeout(done, 120));
        }
      }
      window.scrollTo(0, document.body.scrollHeight);
    })()`)
    .catch(() => undefined);
}

export async function clickNaverAllStatus(page: Page) {
  const all = page.getByRole("button", { name: /^전체$/ }).first();
  if ((await all.count()) > 0) await all.click({ force: true }).catch(() => undefined);
  const tab = page.locator("button, [role=tab]").filter({ hasText: /^전체$/ }).first();
  if ((await tab.count()) > 0) await tab.click({ force: true }).catch(() => undefined);
  await page.waitForTimeout(800);
}

export async function collectUrls(page: Page, kind: "campaigns" | "adgroups", account: string) {
  const re = kind === "campaigns" ? /\/sa\/campaigns\/(cmp-[a-zA-Z0-9-]+)/g : /\/sa\/adgroups\/(grp-[a-zA-Z0-9-]+)/g;
  const ids = new Set<string>();
  const harvest = async () => {
    await scrollList(page);
    const html = await page.content();
    for (const match of html.matchAll(re)) ids.add(match[1]);
  };
  await harvest();
  let stagnant = 0;
  for (let pageNo = 2; pageNo <= 15; pageNo++) {
    const numbered = page.locator(".ad-cms-pagination button, [class*='ad-cms-pagination'] button").filter({
      hasText: new RegExp(`^${pageNo}$`),
    });
    const next = page.locator("button.ad-cms-pagination-next, .ad-cms-pagination button:has-text('다음')").last();
    if ((await numbered.count()) > 0) {
      await numbered.first().click({ force: true }).catch(() => undefined);
    } else if ((await next.count()) > 0 && !(await next.isDisabled().catch(() => true))) {
      await next.click({ force: true }).catch(() => undefined);
    } else {
      break;
    }
    await page.waitForTimeout(900);
    const before = ids.size;
    await harvest();
    if (ids.size === before) {
      stagnant += 1;
      if (stagnant >= 2) break;
    } else {
      stagnant = 0;
    }
  }
  const path = kind === "campaigns" ? "campaigns" : "adgroups";
  return [...ids].map((id) => `https://ads.naver.com/manage/ad-accounts/${account}/sa/${path}/${id}`);
}

export function naverDateValue(ymd: string) {
  const [y, m, d] = ymd.split("-");
  return `${y}.${m}.${d}.`;
}

function naverTriggerDates(text: string) {
  return ((text || "").replace(/\s+/g, "").match(/\d{4}\.\d{2}\.\d{2}\.?/g) || []).map((part) =>
    part.endsWith(".") ? part : `${part}.`,
  );
}

function isNaverSameDay(text: string, ymd: string) {
  const value = naverDateValue(ymd);
  const parts = naverTriggerDates(text);
  if (parts.length >= 2) return parts[0] === value && parts[1] === value;
  return parts.length === 1 && parts[0] === value;
}

/** 네이버 기간 팝오버 캘린더에서 해당 일을 3번 눌러 시작=종료=하루로 맞춘다. */
export async function setNaverSameDay(page: Page, ymd: string) {
  try {
    const [year, month, day] = ymd.split("-");
    const monthBit = `${String(Number(month)).padStart(2, "0")}월`;
    const dayNum = String(Number(day));
    const trigger = page.locator("button.ad-cms-btn.ad-cms-btn-variant-text.ad-cms-btn-lg").filter({ hasText: /\d{4}\.\d{2}\.\d{2}/ }).first();
    await trigger.waitFor({ timeout: 8000 });
    const shown = ((await trigger.textContent()) || "").replace(/\s+/g, "");
    if (isNaverSameDay(shown, ymd)) return true;

    const confirm = page.locator(".ad-cms-popover-content button.ad-cms-btn-color-primary").filter({ hasText: /^확인$/ });
    if ((await confirm.count()) === 0) {
      await trigger.click({ force: true, timeout: 5000 });
      await confirm.waitFor({ state: "visible", timeout: 5000 }).catch(() => undefined);
    }
    if ((await confirm.count()) === 0) {
      await page.keyboard.press("Escape").catch(() => undefined);
      await trigger.click({ force: true, timeout: 5000 });
      await confirm.waitFor({ state: "visible", timeout: 5000 }).catch(() => undefined);
    }
    if ((await confirm.count()) === 0) return false;

    const monthPanel = page.locator(".ad-cms-popover-content .rwc-month").filter({ hasText: `${year}년` }).filter({ hasText: monthBit });
    const nav = page.locator(".ad-cms-popover-content button.ad-cms-btn-icon-only").filter({ hasNotText: /\d/ });
    for (let i = 0; i < 24 && (await monthPanel.count()) === 0; i++) {
      await nav.nth(1).click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(220);
    }

    const cell = monthPanel.first().locator("button.ad-cms-btn-sm").filter({ hasText: new RegExp(`^${dayNum}$`) });
    if ((await cell.count()) === 0) return false;
    for (let i = 0; i < 3; i++) {
      await cell.first().click({ force: true });
      await page.waitForTimeout(180);
    }

    await confirm.click({ force: true, timeout: 5000 });
    await page.waitForTimeout(2200);
    const after = ((await trigger.textContent()) || "").replace(/\s+/g, "");
    return isNaverSameDay(after, ymd);
  } catch {
    return false;
  }
}

function googleTypedDate(ymd: string) {
  const [year, month, day] = ymd.split("-");
  return `${year}. ${Number(month)}. ${Number(day)}.`;
}

function isGoogleSameDay(text: string, ymd: string) {
  const compact = (text || "").replace(/\s+/g, " ");
  const [year, month, day] = ymd.split("-");
  const monthNum = String(Number(month));
  const dayNum = String(Number(day));
  const label = `${year}년 ${monthNum}월 ${dayNum}일`;
  if (!compact.includes(label)) return false;
  const span = compact.match(/(\d{1,2})일\s*~\s*(\d{1,2})일/);
  if (span && span[1] !== span[2]) return false;
  return true;
}

async function fillGoogleDateInput(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true });
  await input.click({ timeout: 8000 });
  await input.press("Control+A");
  await input.press("Backspace");
  await input.type(value, { delay: 12 });
}

/** 구글 Ads 시작일/종료일을 같은 하루로 넣고 적용 */
export async function setGoogleSameDay(page: Page, ymd: string) {
  try {
    const trigger = page.locator('div.button.border[aria-haspopup="dialog"]').filter({ hasText: /\d{4}년/ }).first();
    await trigger.waitFor({ timeout: 8000 });
    const shown = ((await trigger.getAttribute("aria-label")) || (await trigger.textContent()) || "").replace(/\s+/g, " ");
    if (isGoogleSameDay(shown, ymd) && !/~/.test(shown)) return true;

    if ((await trigger.getAttribute("aria-expanded")) !== "true") {
      await trigger.click({ timeout: 8000 });
      await sleep(700);
    }

    const typed = googleTypedDate(ymd);
    await fillGoogleDateInput(page, "시작일", typed);
    await fillGoogleDateInput(page, "종료일", typed);
    await sleep(350);
    await page.locator("material-button.apply, material-button, button").filter({ hasText: /^적용$|^Apply$/ }).first().click({ timeout: 5000 });

    const deadline = Date.now() + 14_000;
    while (Date.now() < deadline) {
      const after = ((await trigger.getAttribute("aria-label")) || (await trigger.textContent()) || "").replace(/\s+/g, " ");
      if (isGoogleSameDay(after, ymd)) {
        if ((await trigger.getAttribute("aria-expanded")) === "true") {
          await page.keyboard.press("Escape").catch(() => undefined);
        }
        await sleep(900);
        return true;
      }
      await sleep(400);
    }
    await page.keyboard.press("Escape").catch(() => undefined);
    return false;
  } catch {
    await page.keyboard.press("Escape").catch(() => undefined);
    return false;
  }
}
