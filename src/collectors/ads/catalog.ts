import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { root } from "../shared/chrome.js";

export type CatalogItem = { id: string; name: string; status?: string };

export type NaverCatalog = {
  campaigns: CatalogItem[];
  groups: CatalogItem[];
};

export function loadNaverCatalog(): NaverCatalog {
  const file = join(root, "data/ads-catalog/naver.json");
  if (!existsSync(file)) return { campaigns: [], groups: [] };
  const raw = JSON.parse(readFileSync(file, "utf8")) as NaverCatalog;
  return {
    campaigns: raw.campaigns ?? [],
    groups: raw.groups ?? [],
  };
}

export function saveNaverCatalog(catalog: NaverCatalog) {
  const file = join(root, "data/ads-catalog/naver.json");
  mkdirSync(dirname(file), { recursive: true });
  const seen = new Map<string, CatalogItem>();
  for (const item of catalog.campaigns) {
    if (!item.id) continue;
    seen.set(item.id, { id: item.id, name: item.name, status: item.status });
  }
  writeFileSync(
    file,
    JSON.stringify(
      {
        campaigns: [...seen.values()],
        groups: catalog.groups ?? [],
      },
      null,
      2,
    ),
    "utf8",
  );
}
