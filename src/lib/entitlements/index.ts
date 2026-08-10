export type DmiPlan = "free" | "pro" | "enterprise";

export type DmiFeature =
  | "digital_card"
  | "public_card"
  | "qr_code"
  | "wallet"
  | "contacts"
  | "analytics"
  | "integrations"
  | "tap_to_share"
  | "premium_templates"
  | "advanced_qr"
  | "smart_share";

export type DmiFeatureAccess =
  | {
      status: "allowed";
      allowed: true;
      feature: DmiFeature;
      plan: DmiPlan;
    }
  | {
      status: "locked";
      allowed: false;
      feature: DmiFeature;
      plan: DmiPlan;
      requiredPlan: DmiPlan;
      reason: "upgrade_required";
    }
  | {
      status: "unsupported";
      allowed: false;
      feature: string;
      plan: DmiPlan;
      reason: "unknown_feature";
    };

export type DmiEntitlementSet = Record<DmiFeature, DmiFeatureAccess>;

const knownFeatures = [
  "digital_card",
  "public_card",
  "qr_code",
  "wallet",
  "contacts",
  "analytics",
  "integrations",
  "tap_to_share",
  "premium_templates",
  "advanced_qr",
  "smart_share",
] as const satisfies readonly DmiFeature[];

const freeFeatures = new Set<DmiFeature>([
  "digital_card",
  "public_card",
  "qr_code",
  "wallet",
]);

const proFeatures = new Set<DmiFeature>([
  ...freeFeatures,
  "contacts",
  "analytics",
  "integrations",
  "tap_to_share",
  "premium_templates",
  "advanced_qr",
  "smart_share",
]);

export const featureAccessByPlan: Record<DmiPlan, ReadonlySet<DmiFeature>> = {
  free: freeFeatures,
  pro: proFeatures,
  enterprise: proFeatures,
};

export const defaultClientPlan: DmiPlan = "free";

export const clientFeaturePreviewPlans = {
  dashboard: "free",
  sidebar: "free",
  cards: "free",
  qrCode: "free",
  tapToShare: "free",
  billing: "free",
  settings: "free",
  contacts: "pro",
  analytics: "pro",
  integrations: "pro",
} as const satisfies Record<string, DmiPlan>;

export function isDmiFeature(value: string): value is DmiFeature {
  return knownFeatures.includes(value as DmiFeature);
}

export function normalizeDmiPlan(plan: string | null | undefined): DmiPlan {
  if (plan === "pro" || plan === "enterprise") {
    return plan;
  }

  if (plan === "paid" || plan === "individual_pro" || plan === "business") {
    return "pro";
  }

  return "free";
}

export function isPaidPlan(plan: DmiPlan | string | null | undefined) {
  return normalizeDmiPlan(plan) !== "free";
}

export function canAccessFeature(
  plan: DmiPlan | string | null | undefined,
  feature: DmiFeature | string
) {
  return getFeatureAccess(plan, feature).allowed;
}

export function getFeatureAccess(
  plan: DmiPlan | string | null | undefined,
  feature: DmiFeature | string
): DmiFeatureAccess {
  const normalizedPlan = normalizeDmiPlan(plan);

  if (!isDmiFeature(feature)) {
    return {
      status: "unsupported",
      allowed: false,
      feature,
      plan: normalizedPlan,
      reason: "unknown_feature",
    };
  }

  if (featureAccessByPlan[normalizedPlan].has(feature)) {
    return {
      status: "allowed",
      allowed: true,
      feature,
      plan: normalizedPlan,
    };
  }

  return {
    status: "locked",
    allowed: false,
    feature,
    plan: normalizedPlan,
    requiredPlan: "pro",
    reason: "upgrade_required",
  };
}

export function getEntitlementsForPlan(
  plan: DmiPlan | string | null | undefined
): DmiEntitlementSet {
  return Object.fromEntries(
    knownFeatures.map((feature) => [feature, getFeatureAccess(plan, feature)])
  ) as DmiEntitlementSet;
}

export function planLabel(plan: DmiPlan | string | null | undefined) {
  const normalizedPlan = normalizeDmiPlan(plan);

  if (normalizedPlan === "enterprise") return "Enterprise";
  if (normalizedPlan === "pro") return "Pro";

  return "Free";
}
