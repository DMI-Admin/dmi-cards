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
      "STRIPE_PRICE_INDIVIDUAL_PRO",
    ],
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
    includes: ['import "server-only"', "createSupabaseAdminClient"],
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
