import type { BrowserContext, Download, Page } from "playwright";
import { copyFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
      if (/광고그룹/.test(head) && /노출/.test(head)) score += 8000;
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

type CdpTarget = { id?: string; type?: string; url?: string; title?: string };

async function listCdpPages(): Promise<CdpTarget[]> {
  const res = await fetch(`${cdpBase()}/json/list`);
  const items = (await res.json()) as CdpTarget[];
  return items.filter((item) => (item.type || "page") === "page");
}

function isKeywordAdsTab(url: string, kind: "naver" | "google" | "both") {
  const naver = /ads\.naver\.com|searchad\.naver\.com/i.test(url);
  const google = /ads\.google\.com/i.test(url);
  if (kind === "naver") return naver;
  if (kind === "google") return google;
  return naver || google;
}

function isCrawlerJunkTab(url: string) {
  return (
    !url ||
    url === "about:blank" ||
    /^chrome:\/\/(newtab|new-tab-page)/i.test(url) ||
    /chrome-error/i.test(url)
  );
}

/** 같은 키워드 광고 탭이 남아 있으면 닫고, 크롬이 꺼지지 않게 빈 탭을 하나 남긴다. */
export async function closeKeywordAdsTabs(kind: "naver" | "google" | "both" = "both") {
  let keeperId = "";
  try {
    const created = await fetch(`${cdpBase()}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
    const info = (await created.json()) as CdpTarget;
    keeperId = info.id || "";
  } catch (error) {
    console.log(`빈 탭 만들기 실패: ${error instanceof Error ? error.message : error}`);
  }
  await sleep(400);

  let closed = 0;
  for (const tab of await listCdpPages()) {
    if (!tab.id || tab.id === keeperId) continue;
    const url = tab.url || "";
    if (!isKeywordAdsTab(url, kind) && !isCrawlerJunkTab(url)) continue;
    const ok = await fetch(`${cdpBase()}/json/close/${tab.id}`).then((res) => res.ok).catch(() => false);
    if (ok) {
      closed += 1;
      console.log(`이전 탭 닫음 ${tab.title || ""} ${url}`);
    }
  }
  console.log(`키워드 광고 관련 탭 ${closed}개 닫음. 새 탭에서 시작합니다.`);
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

function monthHeading(ymd: string) {
  const [year, month] = ymd.split("-");
  const monthNum = Number(month);
  return {
    year: Number(year),
    monthNum,
    label: `${Number(year)}년 ${monthNum}월`,
    key: Number(year) * 12 + monthNum,
  };
}

function escapeRe(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function naverMonthLabel(page: Page, ymd: string) {
  const { label } = monthHeading(ymd);
  return page.locator(".ad-cms-popover-content .ad-cms-typography-secondary").filter({ hasText: label });
}

function naverMonthGrid(page: Page, ymd: string) {
  return naverMonthLabel(page, ymd).locator("xpath=following::div[contains(@class,'rwc-month')][1]");
}

function datePopover(page: Page) {
  return page.locator(".ad-cms-popover-content").filter({ has: page.locator(".rwc-month") }).last();
}

async function openNaverDatePopover(page: Page) {
  const trigger = page.locator("button.ad-cms-btn.ad-cms-btn-variant-text.ad-cms-btn-lg").filter({ hasText: /\d{4}\.\d{2}\.\d{2}/ }).first();
  await trigger.waitFor({ timeout: 8000 });
  const pop = () => datePopover(page);
  const confirm = () => pop().locator("button.ad-cms-btn-color-primary").filter({ hasText: /^확인$/ });
  const opened = async () => {
    const box = pop();
    if ((await box.count()) === 0) return false;
    const calendar = box.locator(".rwc-month").first();
    const input = box.locator('input[placeholder="YYYY.MM.DD."], input[placeholder*="YYYY"]').first();
    return (await calendar.isVisible().catch(() => false)) && (await input.isVisible().catch(() => false));
  };

  if (!(await opened())) {
    await trigger.click({ timeout: 5000 });
    await page.waitForTimeout(500);
  }
  if (!(await opened())) {
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(200);
    await trigger.click({ timeout: 5000 });
    await page.waitForTimeout(500);
  }
  const ok = await opened();
  console.log(ok ? "  날짜 필터 열림" : "  날짜 필터 열기 실패");
  return { trigger, confirm: confirm(), opened: ok };
}

function dottedToYmd(dotted: string) {
  const digits = dotted.replace(/\D/g, "");
  if (digits.length < 8) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function currentNaverRange(text: string) {
  const parts = naverTriggerDates(text);
  if (!parts.length) return null;
  const from = dottedToYmd(parts[0]);
  const to = dottedToYmd(parts[1] || parts[0]);
  if (!from || !to) return null;
  return { from, to };
}

async function fillNaverDateInput(page: Page, index: number, ymd: string) {
  const input = datePopover(page).locator('input[placeholder="YYYY.MM.DD."], input[placeholder*="YYYY"]').nth(index);
  await input.waitFor({ state: "visible", timeout: 4000 });
  const value = naverDateValue(ymd);
  await input.click({ timeout: 4000 });
  await page.waitForTimeout(80);
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(value, { delay: 25 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(450);
  const got = ((await input.inputValue().catch(() => "")) || "").replace(/\s+/g, "");
  return got.includes(value.slice(0, 10));
}

/** 네이버 기간을 시작=종료=하루로 맞춘다. 날짜 필터를 연 뒤 현재 기간을 보고 시작/종료 순서를 고른다. */
export async function setNaverSameDay(page: Page, ymd: string) {
  try {
    const trigger = page.locator("button.ad-cms-btn.ad-cms-btn-variant-text.ad-cms-btn-lg").filter({ hasText: /\d{4}\.\d{2}\.\d{2}/ }).first();
    await trigger.waitFor({ timeout: 8000 });
    const shown = ((await trigger.textContent()) || "").replace(/\s+/g, "");
    if (isNaverSameDay(shown, ymd)) return true;

    const current = currentNaverRange(shown);
    const later = Boolean(current && ymd > current.to);
    const order = later ? [1, 0] : [0, 1];
    console.log(`  기간 ${current ? `${current.from}~${current.to}` : "?"} → ${ymd} (${later ? "종료 먼저" : "시작 먼저"})`);

    const pop = await openNaverDatePopover(page);
    if (!pop.opened) return false;
    for (const index of order) {
      if (!(await fillNaverDateInput(page, index, ymd))) return false;
    }

    await pop.confirm.click({ timeout: 5000 });
    await page.waitForTimeout(1800);
    const after = ((await trigger.textContent()) || "").replace(/\s+/g, "");
    return isNaverSameDay(after, ymd);
  } catch {
    return false;
  }
}

function isNaverRange(text: string, from: string, to: string) {
  const parts = naverTriggerDates(text);
  if (parts.length >= 2) return parts[0] === naverDateValue(from) && parts[1] === naverDateValue(to);
  return from === to && parts.length === 1 && parts[0] === naverDateValue(from);
}

async function visibleMonthKeys(page: Page) {
  const loc = page.locator(".ad-cms-popover-content .ad-cms-typography-secondary");
  const n = await loc.count();
  const keys: number[] = [];
  for (let i = 0; i < n; i++) {
    const text = ((await loc.nth(i).textContent()) || "").replace(/\s+/g, " ").trim();
    const match = text.match(/(\d{4})년\s*(\d{1,2})월/);
    if (match) keys.push(Number(match[1]) * 12 + Number(match[2]));
  }
  return keys;
}

async function showNaverMonth(page: Page, ymd: string) {
  const target = monthHeading(ymd).key;
  const nav = page.locator(".ad-cms-popover-content button.ad-cms-btn-icon-only").filter({ hasNotText: /\d/ });
  for (let i = 0; i < 24; i++) {
    if ((await naverMonthLabel(page, ymd).count()) > 0) return true;
    const keys = await visibleMonthKeys(page);
    if (!keys.length) return false;
    const min = Math.min(...keys);
    const max = Math.max(...keys);
    if (target < min) await nav.first().click().catch(() => undefined);
    else if (target > max) await nav.nth(1).click().catch(() => undefined);
    else return false;
    await page.waitForTimeout(200);
  }
  return (await naverMonthLabel(page, ymd).count()) > 0;
}

async function clickNaverDay(page: Page, ymd: string) {
  const dayNum = String(Number(ymd.slice(8)));
  const cell = naverMonthGrid(page, ymd).locator(".rwc-day.rwc-day-enabled").filter({ hasText: new RegExp(`^${dayNum}$`) });
  if ((await cell.count()) === 0) return false;
  await cell.first().click();
  await page.waitForTimeout(250);
  return true;
}

/** 네이버 기간을 from~to 로 맞춘다. 입력칸은 쓰지 않고 캘린더만 클릭한다. */
export async function setNaverDateRange(page: Page, from: string, to: string) {
  if (from === to) return setNaverSameDay(page, from);
  try {
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(200);
    const trigger = page.locator("button.ad-cms-btn.ad-cms-btn-variant-text.ad-cms-btn-lg").filter({ hasText: /\d{4}\.\d{2}\.\d{2}/ }).first();
    await trigger.waitFor({ timeout: 8000 });
    const shown = ((await trigger.textContent()) || "").replace(/\s+/g, "");
    if (isNaverRange(shown, from, to)) return true;

    const pop = await openNaverDatePopover(page);
    if (!pop.opened) return false;
    if (!(await showNaverMonth(page, from))) return false;
    if (!(await clickNaverDay(page, from))) return false;
    if (from.slice(0, 7) !== to.slice(0, 7) && !(await showNaverMonth(page, to))) return false;
    if (!(await clickNaverDay(page, to))) return false;

    await pop.confirm.click({ timeout: 5000 });
    await page.waitForTimeout(1800);
    const after = ((await trigger.textContent()) || "").replace(/\s+/g, "");
    return isNaverRange(after, from, to);
  } catch {
    return false;
  }
}

function naverGroupFilterButton(page: Page) {
  return page.locator("button.ad-cms-btn-round.ad-cms-btn-color-primary.ad-cms-btn-variant-filled").filter({
    hasNotText: /다운로드|확인|적용|조회|검색|전체/,
  });
}

export async function listNaverAdGroupFilterOptions(page: Page) {
  const trigger = naverGroupFilterButton(page).first();
  await trigger.waitFor({ timeout: 8000 });
  await trigger.click({ timeout: 5000 });
  await page.waitForTimeout(400);
  const pop = page.locator(".ad-cms-popover-content, [role=listbox], [role=menu]").last();
  const texts = await pop.locator("button, [role=option], li, label").allTextContents();
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(200);
  const names = texts.map((text) => text.replace(/\s+/g, " ").trim()).filter((text) => text && !/^(전체|선택|확인|적용|닫기)$/.test(text));
  return [...new Set(names)];
}

export function naverGroupIdFromUrl(url: string) {
  return url.match(/\/adgroups\/(grp-[a-zA-Z0-9-]+)/)?.[1] || "";
}

export type NaverCampaignGroupRow = {
  name: string;
  id: string;
  href: string;
  impressions: number;
  clicks: number;
};

export async function readNaverCampaignGroupRows(page: Page): Promise<NaverCampaignGroupRow[]> {
  await scrollList(page);
  await page
    .evaluate(`(() => {
      const scroller = document.querySelector(".ag-body-horizontal-scroll-viewport, .ag-center-cols-viewport, [class*='horizontal-scroll']");
      if (scroller) scroller.scrollLeft = scroller.scrollWidth;
    })()`)
    .catch(() => undefined);
  await page.waitForTimeout(400);
  return page.evaluate(`(() => {
    const clean = (text) => (text || "").replace(/\\s+/g, " ").trim();
    const num = (text) => {
      const parsed = Number(String(text || "").replace(/[,원%\\s]/g, ""));
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const headerOf = (root) => [...root.querySelectorAll("thead th, [role=columnheader], th")].map((el) => clean(el.textContent));
    const idx = (headers, re) => headers.findIndex((header) => re.test(header.replace(/\\s+/g, "")));
    const metricsFromText = (text) => {
      const match = String(text || "").replace(/\\s+/g, " ").match(/https?:\\/\\/\\S+\\s+([\\d,]+)\\s+([\\d,]+)/);
      if (!match) return null;
      return { impressions: num(match[1]), clicks: num(match[2]) };
    };
    const parseRow = (row, headers) => {
      const text = clean(row.innerText || row.textContent);
      if (/개\\s*결과/.test(text)) return null;
      const link = row.querySelector('a[href*="/adgroups/"]');
      const cells = [...row.querySelectorAll("th,td,[role=gridcell],.ag-cell")].map((el) => clean(el.textContent));
      const nameIdx = idx(headers, /광고그룹이름|광고그룹|그룹명/);
      const name = clean(link ? link.textContent : "") || (nameIdx >= 0 ? cells[nameIdx] : "");
      if (!name || /개\\s*결과|광고그룹\\s*이름|^(합계|결과|전체)$/.test(name)) return null;
      const href = link ? link.href : "";
      const id = (href.match(/adgroups\\/(grp-[a-zA-Z0-9-]+)/) || [])[1] || "";
      const impIdx = idx(headers, /노출수/);
      const clkIdx = idx(headers, /클릭수/);
      let impressions = impIdx >= 0 ? num(cells[impIdx]) : 0;
      let clicks = clkIdx >= 0 ? num(cells[clkIdx]) : 0;
      const fromUrl = metricsFromText(text);
      if (fromUrl) {
        impressions = fromUrl.impressions;
        clicks = fromUrl.clicks;
      }
      return { name, id, href, impressions, clicks };
    };
    let best = [];
    const pageHeaders = headerOf(document);
    for (const table of document.querySelectorAll("table, [role=grid], [role=table], .ag-root")) {
      const headers = headerOf(table);
      const use = headers.some((header) => /노출수/.test(header)) ? headers : pageHeaders;
      const body = [...table.querySelectorAll("tbody tr, [role=row], .ag-row")].filter((row) => !row.querySelector("[role=columnheader]"));
      const rows = [];
      for (const row of body) {
        const parsed = parseRow(row, use);
        if (parsed) rows.push(parsed);
      }
      if (rows.length > best.length) best = rows;
    }
    if (!best.length) {
      for (const row of document.querySelectorAll("tr, [role=row], .ag-row")) {
        if (!row.querySelector('a[href*="/adgroups/"]')) continue;
        const parsed = parseRow(row, pageHeaders);
        if (parsed) best.push(parsed);
      }
    }
    return best;
  })()`) as Promise<NaverCampaignGroupRow[]>;
}

export async function listNaverCampaignGroups(page: Page): Promise<NaverCampaignGroupRow[]> {
  const all = new Map<string, NaverCampaignGroupRow>();
  const harvest = async () => {
    for (const row of await readNaverCampaignGroupRows(page)) {
      all.set(row.id || row.name, row);
    }
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
    const before = all.size;
    await harvest();
    if (all.size === before) {
      stagnant += 1;
      if (stagnant >= 2) break;
    } else {
      stagnant = 0;
    }
  }
  return [...all.values()];
}

export function hasNaverGroupTraffic(row: NaverCampaignGroupRow) {
  return row.impressions > 0 || row.clicks > 0;
}

let conversionsColumnReady = false;

export async function ensureNaverTotalConversionsColumn(page: Page, force = false) {
  if (conversionsColumnReady && !force) return;
  const header = page.locator("th, [role=columnheader], .ag-header-cell").filter({ hasText: /총\s*전환수|^전환수$/ });
  if (!force && (await header.count()) > 0) {
    conversionsColumnReady = true;
    return;
  }
  const openBtn = page.locator("button, a, [role=button]").filter({ hasText: /열\s*맞춤\s*설정|열맞춤\s*설정/ }).first();
  if (!(await openBtn.count())) return;
  await openBtn.click({ timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  const pop = page.locator("[role=dialog], .ad-cms-modal, .ad-cms-popover-content, [class*='column-setting']").last();
  const perf = pop.getByText(/성과\s*지표/, { exact: false }).first();
  if ((await perf.count()) > 0) await perf.click({ timeout: 3000 }).catch(() => undefined);
  const label = pop.getByText("총 전환수", { exact: true }).first();
  if ((await label.count()) > 0) {
    const already = await label.evaluate((el) => {
      const root = el.closest("label, li, div") || el.parentElement;
      const input = root?.querySelector("input[type=checkbox], [aria-checked]");
      if (!input) return false;
      if (input instanceof HTMLInputElement) return input.checked;
      return input.getAttribute("aria-checked") === "true";
    }).catch(() => false);
    if (!already) await label.click({ timeout: 3000 }).catch(() => undefined);
  }
  const ok = page.locator("button").filter({ hasText: /^(확인|적용)$/ }).last();
  if ((await ok.count()) > 0) await ok.click({ timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(700);
  if ((await header.count()) > 0) conversionsColumnReady = true;
}

export async function ensureNaverKeywordDownload(page: Page) {
  const btn = page.locator("button.ad-cms-btn-variant-outlined").filter({ hasText: /다운로드/ }).first();
  if (await btn.count()) return;
  const tab = page.locator("button, a, [role=tab]").filter({ hasText: /^키워드$/ }).first();
  if ((await tab.count()) > 0) {
    await tab.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(800);
  }
}

/** 같은 화면에서 광고그룹 필터만 바꾼다. 날짜는 그대로 둔다. */
export async function selectNaverAdGroupFilter(page: Page, name: string) {
  const trigger = naverGroupFilterButton(page).first();
  await trigger.waitFor({ timeout: 8000 });
  const shown = ((await trigger.textContent()) || "").replace(/\s+/g, "");
  if (shown.includes(name.replace(/\s+/g, ""))) return true;

  await trigger.click({ timeout: 5000 });
  await page.waitForTimeout(400);
  const pop = page.locator(".ad-cms-popover-content, [role=listbox], [role=menu]").last();
  const exact = pop.locator("button, [role=option], li, label, a, div").filter({ hasText: new RegExp(`^${escapeRe(name)}$`) });
  const option = (await exact.count()) > 0 ? exact.first() : page.getByText(name, { exact: true }).last();
  await option.click({ timeout: 5000 });
  await page.waitForTimeout(1200);
  const after = ((await trigger.textContent()) || "").replace(/\s+/g, "");
  return after.includes(name.replace(/\s+/g, ""));
}

function newestDownloadSince(dir: string, since: number, pattern = /\.xlsx?$/i) {
  const files = readdirSync(dir)
    .filter((file) => pattern.test(file) && !file.endsWith(".crdownload") && !file.endsWith(".tmp"))
    .map((file) => ({ file, mtime: statSync(join(dir, file)).mtimeMs }))
    .filter((item) => item.mtime >= since - 2000)
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] ? join(dir, files[0].file) : "";
}

export async function clickNaverKeywordDownload(page: Page, dest: string) {
  const btn = page.locator("button.ad-cms-btn-variant-outlined").filter({ hasText: /다운로드/ }).first();
  await btn.waitFor({ state: "visible", timeout: 8000 });
  const since = Date.now();
  const downloadsDir = join(homedir(), "Downloads");
  let download: Download | null = null;
  try {
    [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 45_000 }),
      btn.click({ timeout: 8000 }),
    ]);
  } catch {
    await btn.click({ timeout: 8000 }).catch(() => undefined);
  }
  if (download) {
    try {
      await download.saveAs(dest);
      return dest;
    } catch {
      /* CDP 크롬은 Downloads 폴더로 떨어질 때가 있다 */
    }
  }
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const found = newestDownloadSince(downloadsDir, since);
    if (found) {
      copyFileSync(found, dest);
      return dest;
    }
    await sleep(250);
  }
  throw new Error("엑셀 다운로드 파일을 찾지 못했습니다");
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

export async function clickGoogleKeywordDownload(page: Page, dest: string) {
  await page.keyboard.press("Escape").catch(() => undefined);
  await sleep(200);
  const btn = page
    .locator("material-button.trigger-button, material-button")
    .filter({ hasText: /다운로드|Download/ })
    .filter({ hasNotText: /앱/ })
    .first();
  await btn.waitFor({ state: "visible", timeout: 10_000 });
  const since = Date.now();
  const downloadsDir = join(homedir(), "Downloads");
  await btn.click({ timeout: 8000 });
  const menu = page.locator("material-select-item.menu-item, .menu-item-row, [role=menuitem]");
  await menu.first().waitFor({ state: "visible", timeout: 8000 });
  const excelCsv = menu.filter({ hasText: /Excel용\s*\.csv/i });
  const plainCsv = menu.filter({ hasText: /^\s*\.csv\s*$/ });
  const choice = (await excelCsv.count()) > 0 ? excelCsv.first() : plainCsv.first();
  let download: Download | null = null;
  try {
    [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 45_000 }),
      choice.click({ timeout: 8000 }),
    ]);
  } catch {
    await choice.click({ timeout: 8000 }).catch(() => undefined);
  }
  if (download) {
    try {
      await download.saveAs(dest);
      return dest;
    } catch {
      /* CDP 크롬은 Downloads 폴더로 떨어질 때가 있다 */
    }
  }
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const found = newestDownloadSince(downloadsDir, since, /\.csv$/i);
    if (found) {
      copyFileSync(found, dest);
      return dest;
    }
    await sleep(250);
  }
  throw new Error("구글 CSV 다운로드 파일을 찾지 못했습니다");
}
