import {
  canAccessFeature,
  getFeatureAccess,
  type DmiFeature,
  type DmiPlan,
} from "@/lib/entitlements";

export type ClientPlan = DmiPlan;

export type ClientFeature =
  | "contacts"
  | "qr-code"
  | "wallet"
  | "tap-to-share"
  | "analytics"
  | "integrations";

const clientFeatureToEntitlement: Record<ClientFeature, DmiFeature> = {
  contacts: "contacts",
  "qr-code": "qr_code",
  wallet: "wallet",
  "tap-to-share": "tap_to_share",
  analytics: "analytics",
  integrations: "integrations",
};

export function isClientFeatureLocked(feature: ClientFeature, plan: ClientPlan) {
  return !canAccessFeature(plan, clientFeatureToEntitlement[feature]);
}

export function getClientFeatureAccess(feature: ClientFeature, plan: ClientPlan) {
  return getFeatureAccess(plan, clientFeatureToEntitlement[feature]);
}
