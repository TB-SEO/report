import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

let attached: Browser | null = null;

export function chromeProfileDir() {
  const fromEnv =
    process.env.CHROME_PROFILE?.trim() ||
    process.env.TISTORY_CHROME_PROFILE?.trim() ||
    "secrets/chrome-profiles/seo-report";
  return resolve(root, fromEnv);
}

export function cdpPort() {
  const parsed = Number(process.env.CHROME_CDP_PORT?.trim() || "19444");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 19444;
}

export function cdpUrl() {
  return `http://127.0.0.1:${cdpPort()}`;
}

export function ensureDir(dirPath: string) {
  if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
}

function chromeExecutable() {
  const fromEnv = process.env.CHROME_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const local = process.env.LOCALAPPDATA ?? "";
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    local ? resolve(local, "Google/Chrome/Application/chrome.exe") : "",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ].filter(Boolean);
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error("Chrome 실행 파일을 찾지 못했습니다. .env에 CHROME_PATH 를 넣어 주세요.");
  }
  return found;
}

async function cdpReady(timeoutMs = 8_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${cdpUrl()}/json/version`);
      if (response.ok) return true;
    } catch {
      // 아직 안 열림
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  return false;
}

function spawnSharedChrome() {
  const userDataDir = chromeProfileDir();
  ensureDir(userDataDir);
  const child = spawn(
    chromeExecutable(),
    [
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${cdpPort()}`,
      "--remote-debugging-address=127.0.0.1",
      "--remote-allow-origins=*",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-session-crashed-bubble",
      "--hide-crash-restore-bubble",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1440,960",
    ],
    { detached: true, stdio: "ignore", windowsHide: false },
  );
  child.unref();
  const label = process.env.CHROME_LABEL?.trim() || "구글 공용 크롬";
  console.log(`${label}을 열었습니다. 이 창은 수집이 끝나도 닫지 않습니다. (CDP ${cdpPort()})`);
}

async function connectCdp(): Promise<Browser> {
  return chromium.connectOverCDP(cdpUrl(), { timeout: 10_000 });
}

export async function openPersistentChrome(): Promise<BrowserContext> {
  if (attached) {
    const context = attached.contexts()[0];
    if (context) return context;
  }

  if (!(await cdpReady(1_000))) {
    spawnSharedChrome();
    const ready = await cdpReady(20_000);
    if (!ready) {
      throw new Error(
        "공용 크롬에 붙지 못했습니다. 예전에 연 자동화 크롬이 프로필을 잠그고 있으면 그 창만 닫고 npm run login 을 다시 실행해 주세요. 이번 공용 창은 닫지 마세요.",
      );
    }
  }

  attached = await connectCdp();
  const browser = attached;
  browser.on("disconnected", () => {
    if (attached === browser) attached = null;
  });
  const context = browser.contexts()[0] ?? (await browser.newContext({ locale: "ko-KR", timezoneId: "Asia/Seoul" }));
  return context;
}

export function keepChromeOpen() {
  return !process.argv.includes("--close");
}

export async function waitForEnter(message: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolvePromise) => {
    rl.question(`${message}\n`, () => resolvePromise());
  });
  rl.close();
}

/** timeoutMs 0 = 로그인 끝날 때까지 창을 닫지 않고 대기 */
export async function waitUntil(
  page: Page,
  check: () => Promise<boolean>,
  message: string,
  timeoutMs = 0,
) {
  if (await check()) {
    console.log("이미 로그인된 세션입니다.");
    return;
  }
  console.log(message);
  console.log("이 크롬 창은 닫지 않습니다. 구글 로그인이 끝나면 세 블로그가 같은 세션을 씁니다.");
  const started = Date.now();
  let lastPing = started;
  while (timeoutMs === 0 || Date.now() - started < timeoutMs) {
    if (await check()) {
      console.log("로그인 확인됨. 공용 크롬 세션을 그대로 유지합니다.");
      await page.waitForTimeout(800);
      return;
    }
    if (Date.now() - lastPing > 30_000) {
      console.log("아직 로그인 대기 중… 창에서 구글 로그인을 마쳐 주세요.");
      lastPing = Date.now();
    }
    await page.waitForTimeout(1500);
  }
  throw new Error("로그인 대기 시간이 지났습니다. 공용 크롬 창에서 로그인한 뒤 다시 실행해 주세요.");
}

/** 수집기만 떼어 냅니다. 구글 공용 크롬 창은 닫지 않습니다. */
export async function releaseChrome(_context?: BrowserContext) {
  const browser = attached;
  attached = null;
  if (!browser) return;
  if (process.argv.includes("--close")) {
    await browser.close().catch(() => undefined);
    return;
  }
  const maybeDisconnect = (browser as { disconnect?: () => void }).disconnect;
  if (typeof maybeDisconnect === "function") {
    maybeDisconnect.call(browser);
  } else {
    // Playwright 1.55: CDP 연결의 close()는 브라우저를 끄지 않고 연결만 끊습니다.
    await browser.close().catch(() => undefined);
  }
  console.log("수집기는 끝났지만 구글 공용 크롬은 그대로 둡니다.");
}

export const closeChrome = releaseChrome;

export async function pageOn(context: BrowserContext, match: RegExp, url: string): Promise<Page> {
  const existing = context.pages().find((page) => match.test(page.url()));
  const page = existing ?? (await context.newPage());
  await page.bringToFront();
  if (!match.test(page.url())) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } else {
    console.log(`이미 열린 탭을 씁니다: ${page.url()}`);
  }
  return page;
}

export { root };
