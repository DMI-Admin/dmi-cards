import { readCompanyReport } from "@/lib/admin-company-report-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function GET(request: Request) {
  return readCompanyReport(request);
}
