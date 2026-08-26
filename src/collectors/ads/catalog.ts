import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
