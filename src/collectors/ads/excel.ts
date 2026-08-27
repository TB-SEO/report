import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";

export type NaverExcelKeyword = {
  name: string;
  status: string;
  bidType: string;
  bid: number;
  relevanceScore: string;
  expectedCtr: string;
  impressions: number;
  clicks: number;
  ctr: number;
  conversions: number;
  cpc: number;
  cost: number;
  id: string;
  registeredAt: string;
  updatedAt: string;
};

export type NaverExcelReport = {
  headers: string[];
  keywordCount: number;
  totals: { impressions: number; clicks: number; ctr: number; conversions: number; cpc: number; cost: number };
  rows: NaverExcelKeyword[];
};

function num(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").replace(/[,원%\s]/g, "");
  if (!text || text === "-") return 0;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  const raw = String(value ?? "").trim();
  return raw === "-" ? "" : raw;
}

function col(headers: string[], ...needles: RegExp[]) {
  return headers.findIndex((header) => needles.some((needle) => needle.test(header.replace(/\s+/g, ""))));
}

export function parseNaverKeywordXlsx(filePath: string): NaverExcelReport {
  const workbook = XLSX.read(readFileSync(filePath), { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });
  const headers = (matrix[0] ?? []).map((cell) => String(cell ?? "").trim());
  const totalRow = matrix[1] ?? [];
  const nameIdx = col(headers, /^키워드$/);
  const statusIdx = col(headers, /^상태$/);
  const bidTypeIdx = col(headers, /입찰가유형|입찰유형/);
  const bidIdx = col(headers, /^입찰가$/);
  const relIdx = col(headers, /광고연관/);
  const expIdx = col(headers, /클릭기대/);
  const impIdx = col(headers, /^노출수$/);
  const clkIdx = col(headers, /^클릭수$/);
  const ctrIdx = col(headers, /클릭률/);
  const convIdx = (() => {
    const total = col(headers, /^총전환수$/);
    return total >= 0 ? total : col(headers, /^전환수$/);
  })();
  const cpcIdx = col(headers, /평균CPC|평균cpc/);
  const costIdx = col(headers, /총비용/);
  const idIdx = col(headers, /키워드ID/);
  const regIdx = col(headers, /등록시각/);
  const updIdx = col(headers, /수정시각/);

  const countMatch = String(totalRow[nameIdx] ?? totalRow[0] ?? "").match(/키워드\s*(\d+)\s*개/);
  const keywordCount = countMatch ? Number(countMatch[1]) : 0;
  const totals = {
    impressions: num(impIdx >= 0 ? totalRow[impIdx] : 0),
    clicks: num(clkIdx >= 0 ? totalRow[clkIdx] : 0),
    ctr: num(ctrIdx >= 0 ? totalRow[ctrIdx] : 0),
    conversions: num(convIdx >= 0 ? totalRow[convIdx] : 0),
    cpc: num(cpcIdx >= 0 ? totalRow[cpcIdx] : 0),
    cost: num(costIdx >= 0 ? totalRow[costIdx] : 0),
  };

  const rows: NaverExcelKeyword[] = [];
  for (const raw of matrix.slice(2)) {
    const name = text(nameIdx >= 0 ? raw[nameIdx] : raw[0]);
    if (!name || /개\s*결과/.test(name)) continue;
    rows.push({
      name,
      status: text(statusIdx >= 0 ? raw[statusIdx] : ""),
      bidType: text(bidTypeIdx >= 0 ? raw[bidTypeIdx] : ""),
      bid: num(bidIdx >= 0 ? raw[bidIdx] : 0),
      relevanceScore: text(relIdx >= 0 ? raw[relIdx] : ""),
      expectedCtr: text(expIdx >= 0 ? raw[expIdx] : ""),
      impressions: num(impIdx >= 0 ? raw[impIdx] : 0),
      clicks: num(clkIdx >= 0 ? raw[clkIdx] : 0),
      ctr: num(ctrIdx >= 0 ? raw[ctrIdx] : 0),
      conversions: num(convIdx >= 0 ? raw[convIdx] : 0),
      cpc: num(cpcIdx >= 0 ? raw[cpcIdx] : 0),
      cost: num(costIdx >= 0 ? raw[costIdx] : 0),
      id: text(idIdx >= 0 ? raw[idIdx] : ""),
      registeredAt: text(regIdx >= 0 ? raw[regIdx] : ""),
      updatedAt: text(updIdx >= 0 ? raw[updIdx] : ""),
    });
  }

  return { headers, keywordCount, totals, rows };
}

export function excelHasTotalConversions(report: NaverExcelReport) {
  return report.headers.some((header) => /총전환수|^전환수$/.test(header.replace(/\s+/g, "")));
}

export function checkNaverExcel(report: NaverExcelReport) {
  const impressions = report.rows.reduce((sum, row) => sum + row.impressions, 0);
  const clicks = report.rows.reduce((sum, row) => sum + row.clicks, 0);
  const cost = report.rows.reduce((sum, row) => sum + row.cost, 0);
  const issues: string[] = [];
  if (report.keywordCount && report.keywordCount !== report.rows.length) {
    issues.push(`키워드 수 ${report.keywordCount} ≠ 행 ${report.rows.length}`);
  }
  if (Math.abs(impressions - report.totals.impressions) > 1) {
    issues.push(`노출 합 ${impressions} ≠ 합계 ${report.totals.impressions}`);
  }
  if (Math.abs(clicks - report.totals.clicks) > 1) {
    issues.push(`클릭 합 ${clicks} ≠ 합계 ${report.totals.clicks}`);
  }
  if (Math.abs(cost - report.totals.cost) > 1) {
    issues.push(`비용 합 ${cost} ≠ 합계 ${report.totals.cost}`);
  }
  if (!report.rows.length) issues.push("키워드 행이 없습니다");
  return {
    ok: issues.length === 0,
    issues,
    impressions,
    clicks,
    cost,
    conversions: report.rows.reduce((sum, row) => sum + row.conversions, 0),
    keywords: report.rows.length,
  };
}

export type GoogleCsvKeyword = {
  name: string;
  matchType: string;
  campaign: string;
  group: string;
  status: string;
  keywordStatus: string;
  impressions: number;
  clicks: number;
  ctr: number;
  conversions: number;
  cpc: number;
  cost: number;
};

function decodeReportBuffer(buf: Buffer) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString("utf16le");
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.alloc(buf.length - 2);
    for (let i = 2; i + 1 < buf.length; i += 2) {
      swapped[i - 2] = buf[i + 1];
      swapped[i - 1] = buf[i];
    }
    return swapped.toString("utf16le");
  }
  return buf.toString("utf8").replace(/^\uFEFF/, "");
}

function splitReportLine(line: string, delim: string) {
  if (delim === "\t") return line.split("\t").map((cell) => cell.replace(/^"|"$/g, "").trim());
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else quoted = !quoted;
      continue;
    }
    if (ch === delim && !quoted) {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

export function parseGoogleKeywordCsv(filePath: string): { headers: string[]; rows: GoogleCsvKeyword[] } {
  const text = decodeReportBuffer(readFileSync(filePath)).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n").filter((line) => line.trim().length);
  const headerIdx = Math.max(
    0,
    lines.findIndex((line) => /키워드/.test(line) && /노출수/.test(line)),
  );
  const headerLine = lines[headerIdx] ?? "";
  const delim = headerLine.includes("\t") ? "\t" : ",";
  const headers = splitReportLine(headerLine, delim);
  const idx = (...needles: RegExp[]) =>
    headers.findIndex((header) => needles.some((needle) => needle.test(header.replace(/\s+/g, ""))));
  const nameIdx = idx(/^키워드$/);
  const typeIdx = idx(/검색유형/);
  const campIdx = idx(/^캠페인$/);
  const groupIdx = idx(/^광고그룹$/);
  const statusIdx = idx(/^상태$/);
  const kwStatusIdx = idx(/키워드상태/);
  const impIdx = idx(/^노출수$/);
  const clkIdx = idx(/^클릭수$/);
  const ctrIdx = idx(/클릭률|^CTR$/i);
  const convIdx = idx(/^전환수$/);
  const cpcIdx = idx(/평균CPC|^CPC$/i);
  const costIdx = idx(/^비용$/);
  const rows: GoogleCsvKeyword[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const cells = splitReportLine(line, delim);
    const name = (nameIdx >= 0 ? cells[nameIdx] : "").trim();
    if (!name || /합계|총계|total|보고서/i.test(name)) continue;
    rows.push({
      name,
      matchType: typeIdx >= 0 ? cells[typeIdx] || "" : "",
      campaign: campIdx >= 0 ? cells[campIdx] || "" : "",
      group: groupIdx >= 0 ? cells[groupIdx] || "" : "",
      status: statusIdx >= 0 ? cells[statusIdx] || "" : "",
      keywordStatus: kwStatusIdx >= 0 ? cells[kwStatusIdx] || "" : "",
      impressions: num(impIdx >= 0 ? cells[impIdx] : 0),
      clicks: num(clkIdx >= 0 ? cells[clkIdx] : 0),
      ctr: num(ctrIdx >= 0 ? cells[ctrIdx] : 0),
      conversions: num(convIdx >= 0 ? cells[convIdx] : 0),
      cpc: num(cpcIdx >= 0 ? cells[cpcIdx] : 0),
      cost: num(costIdx >= 0 ? cells[costIdx] : 0),
    });
  }
  return { headers, rows };
}
