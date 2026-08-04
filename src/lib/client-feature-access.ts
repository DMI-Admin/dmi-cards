export type ClientPlan = "free" | "paid" | "individual_pro" | "business" | "enterprise";

export type ClientFeature =
  | "contacts"
  | "qr-code"
  | "wallet"
  | "tap-to-share"
  | "analytics"
  | "integrations";

const proOnlyFeatures = new Set<ClientFeature>([
  "contacts",
  "tap-to-share",
  "analytics",
  "integrations",
]);

export function isClientFeatureLocked(feature: ClientFeature, plan: ClientPlan) {
  return plan === "free" && proOnlyFeatures.has(feature);
}
