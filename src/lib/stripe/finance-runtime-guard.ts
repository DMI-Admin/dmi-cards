import "server-only";

/** Target selection only; does not initialize Finance or verify external services. */
export function isFinanceTargetEnabled(): boolean {
  const target = process.env.VERCEL_TARGET_ENV || process.env.VERCEL_ENV;
  return process.env.VERCEL_ENV !== "production" && target === "staging";
}
