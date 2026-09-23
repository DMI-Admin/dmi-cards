type Account = { id: string; account_type: string | null; created_at: string };
export function accountsForArea<T extends Account>(rows: T[], area: "individual" | "business"): T[] {
  return rows.filter(row => area === "individual" ? row.account_type === "individual" : ["business", "enterprise"].includes(row.account_type || ""))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
}
export function clientPage<T>(rows: T[], requestedPage: number) {
  const pages = Math.max(1, Math.ceil(rows.length / 25));
  const page = Math.min(pages, Math.max(1, requestedPage));
  return { rows: rows.slice((page - 1) * 25, page * 25), page, pages };
}
// Display/filter compatibility only. Never used for entitlements.
export function individualPlanLabel(plan: string | null) {
  return plan === "free" ? "Free" : ["paid", "pro", "individual_pro"].includes(plan || "") ? "Pro" : "Unknown";
}
