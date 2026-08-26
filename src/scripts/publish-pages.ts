import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { publicDir } from "../web/weeks-store.js";
import { root } from "../collectors/shared/chrome.js";

export function publishPages() {
  const dest = resolve(root, "docs");
  mkdirSync(dest, { recursive: true });
  cpSync(publicDir, dest, { recursive: true });
  writeFileSync(resolve(dest, ".nojekyll"), "");
  console.log(`GitHub Pages 복사: ${dest}`);
}

if (process.argv[1]?.includes("publish-pages")) {
  publishPages();
}
