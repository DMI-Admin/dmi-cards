import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  return NextResponse.json({
    status: "operational",
    service: "dmi-cards",
    version: safeBuildVersion(),
    timestamp: new Date().toISOString(),
  });
}

function safeBuildVersion() {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
    "local"
  );
}
