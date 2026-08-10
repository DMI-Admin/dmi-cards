import { readFileSync } from "node:fs";

const checks = [
  {
    name: "Stripe secret is server-only",
    file: "src/lib/stripe/config.ts",
    includes: ['import "server-only"', "process.env.STRIPE_SECRET_KEY"],
    excludes: ["NEXT_PUBLIC_STRIPE"],
  },
  {
    name: "Webhook rejects invalid signatures",
    file: "src/app/api/stripe/webhook/route.ts",
    includes: [
      "constructStripeWebhookEvent",
      "INVALID_STRIPE_SIGNATURE",
      "{ status: 400 }",
    ],
  },
  {
    name: "Unknown Stripe prices cannot grant paid plans",
    file: "src/lib/stripe/billing-state.ts",
    includes: [
      "dmiPlanForStripePrice",
      'return "free"',
      "STRIPE_PRICE_PRO_MONTHLY",
      "STRIPE_PRICE_PRO_ANNUAL",
    ],
    excludes: ["STRIPE_PRICE_BUSINESS", "STRIPE_PRICE_ENTERPRISE"],
  },
  {
    name: "API paid access remains capped",
    file: "src/lib/api/client-context.ts",
    includes: ['planSource: "temporary_free_cap"', "return defaultClientPlan"],
    excludes: ["clientFeaturePreviewPlans"],
  },
  {
    name: "Stripe webhook writes use server-only admin client",
    file: "src/lib/stripe/webhook.ts",
    includes: [
      'import "server-only"',
      "createSupabaseAdminClient",
      "hasDmiStripeAppNamespace",
      "app_namespace_mismatch",
    ],
  },
  {
    name: "Checkout creates namespaced Stripe sessions",
    file: "src/lib/stripe/checkout.ts",
    includes: [
      'import "server-only"',
      "DMI_STRIPE_APP_METADATA_KEY",
      "DMI_STRIPE_APP_NAMESPACE",
      "subscription_data",
      "dmi_user_id",
    ],
  },
  {
    name: "Checkout API does not accept raw Stripe prices",
    file: "src/app/api/v1/billing/checkout/route.ts",
    includes: [
      "requireApiClient",
      "isCheckoutBillingPlan",
      "isStripeBillingInterval",
      "stripePriceForCheckoutPlan",
      "createStripeCheckoutSession",
    ],
    excludes: ["body.priceId", "stripe_price_id"],
  },
  {
    name: "Checkout rejects public enterprise checkout",
    file: "src/lib/stripe/billing-state.ts",
    includes: ["return plan === \"pro\""],
    excludes: ["enterprise: process.env", "business: process.env"],
  },
];

for (const check of checks) {
  const content = readFileSync(check.file, "utf8");
  const missing = (check.includes || []).filter((text) => !content.includes(text));
  const forbidden = (check.excludes || []).filter((text) => content.includes(text));

  if (missing.length || forbidden.length) {
    console.error(`Stripe billing validation failed: ${check.name}`);
    if (missing.length) console.error(`Missing: ${missing.join(", ")}`);
    if (forbidden.length) console.error(`Forbidden: ${forbidden.join(", ")}`);
    process.exit(1);
  }
}

console.log("Stripe billing foundation validation passed.");
