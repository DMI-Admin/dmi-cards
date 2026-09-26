import { buildPublicCardUrl } from "@/lib/public-url";
import { isSupportPublished } from "@/lib/admin-card-support";

export type CompanyReportCard = {
  card_name?: string | null; full_name?: string | null; email?: string | null;
  slug?: string | null; status?: string | null; is_published?: boolean | null;
};
function csvCell(value: string) {
  // Quoting alone does not prevent spreadsheet formula execution.
  const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(value) ? "'" + value : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function companyReport(companyName: string, cards: CompanyReportCard[]) {
  const headers = ["company name", "staff name", "email", "public URL", "views", "saves", "shares", "status"];
  const rows = cards.map(card => [companyName, card.full_name || card.card_name || "", card.email || "",
    card.slug ? buildPublicCardUrl(card.slug) : "", "0", "0", "0", isSupportPublished(card) ? "published" : "unpublished"]);
  return {
    csv: [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\n"),
    filename: `${companyName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "company"}-public-pages-report.csv`,
    count: cards.length,
  };
}
export function downloadCompanyReport(report: { csv: string; filename: string }) {
  const url = URL.createObjectURL(new Blob([report.csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = report.filename; link.click();
  URL.revokeObjectURL(url);
}
