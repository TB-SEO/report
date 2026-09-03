export type AdsDesk = "tassi" | "tbell" | "security" | "other";

export const DESK_LABELS: Record<AdsDesk, string> = {
  tassi: "T-ASSI",
  tbell: "TBELL",
  security: "보안",
  other: "기타",
};

const SECURITY_GROUP_IDS = new Set(["grp-a001-01-000000072729272"]);

export function assignDesk(campaignName: string, campaignId?: string, groupName?: string, groupId?: string): AdsDesk {
  if (groupId && SECURITY_GROUP_IDS.has(groupId)) return "security";
  const blob = `${campaignId || ""} ${campaignName || ""} ${groupId || ""} ${groupName || ""}`;
  if (/보안|security|secu/i.test(blob)) return "security";
  if (/티벨|tbell|\(주\)티벨/i.test(blob)) return "tbell";
  if (/t-?assi|파워링크|랜딩/i.test(blob)) return "tassi";
  return "other";
}
