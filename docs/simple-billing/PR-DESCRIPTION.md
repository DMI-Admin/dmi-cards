# Replace legacy billing with a small Stripe integration

Checkout and webhook processing currently depend on V1/V2 worker, routing, receipt and Finance machinery. This branch replaces both systems with Embedded Checkout, Stripe Customer Portal, one shared current-Subscription synchronizer and one `account_billing` mirror. Checkout completion authenticates the user, verifies Session ownership, commits current Stripe state and then opens Billing. It never polls or calls a worker.

Source: `release/admin-ui-foundation` at `e71c5ce94cdcd76cd268ad97c5a4660943369a4e`. Review branch: `rewrite/simple-stripe-billing`. No commits, pushes or hosted PR have been created. The release ref remains unchanged.

## Scope and authority

`client-context.ts` centrally reads the new mirror and retains the existing entitlement result shape and unchanged entitlement map. Active/trialing/past_due retain paid access; canceled/unpaid and other statuses fail closed. Enterprise is sales-managed and synchronizes Stripe quantity; no self-service Enterprise purchase or Portal switching. Signed webhooks retain pre-database deployment/mode isolation and always retrieve current Stripe state. Unknown prices or ownership conflicts fail closed.

Stripe remains source of truth for invoices/payments/refunds. Financial history is accessed in Stripe, not mirrored locally.

Exact pre-change dependencies and deletion decisions: [INVENTORY.json](INVENTORY.json). Exact deleted files and final metrics: [MEASUREMENTS.json](MEASUREMENTS.json). Deleted 188 files, including all of `src/lib/billing-v2/`, `specs/billing-simplification/`, legacy worker/auto/recovery/reconciliation routes, Finance projections, billing diagnostics and activation polling. The partially retained Stripe/scripts/API directories use exact-file deletion lists. Generic monitoring, cards, business onboarding and commercial approval records remain.

## Measurements

| Measure | Before | After |
|---|---:|---:|
| Runtime files | 107 | 18 |
| Runtime physical LOC | 12,525 | 401 |
| Dedicated tests/spec files | 95 | 3 |
| Dedicated tests/spec physical LOC | 20,471 | 150 |
| Billing API routes | 14 | 6 |
| Historical + additive migrations | 28 | 29 |
| Dedicated source/test/migration LOC | 39,273 | 6,850 |

Runtime LOC reduction: 96.8%. Physical counts include blank/comment lines; shared auth/entitlement/monitoring modules are separately inventoried, not counted as dedicated billing before or after. The central entitlement regression remains a shared validator. New dedicated tests total 3 files; the additional central entitlement validator is not included in either dedicated baseline. Runtime remains below the requested ~1,000-line stop threshold.

Target billing tables: 39 → 1. All 28 historical billing migrations remain byte-for-byte unchanged; their legacy tables are still represented in history. One additive migration creates `account_billing` (29 total historical/additive billing migrations). The RESTRICT-only cleanup proposal is outside automatic migrations and is not applied. It is tested against the complete historical chain, including an abort on a non-billing dependency. No hosted cleanup compatibility is asserted.

## Validation

- Replacement flow/security/ordering: 47/47; central entitlement read: 14/14.
- Disposable PostgreSQL one-table/RLS/permissions: 12/12; complete historical-chain cleanup: 2/2.
- Available offline application validator scripts: 42/42 (includes the two flow/entitlement scripts above).
- TypeScript, changed-file ESLint, whitespace/diff/EOF and production build pass. Build used a disposable source copy, credential-free placeholders and a copy-only Turbopack root adjustment; repository Next configuration is unchanged.
- Six unrelated input/tool-dependent utilities are not counted as passes: the two responsive browser validators (external esbuild/Playwright), two business PostgreSQL/PGlite validators, Wallet credential validation and an actual PKPass artifact check. Their required tooling/inputs were unavailable; existing protected source is unchanged.
- No real Stripe call, checkout, webhook replay, hosted SQL, deployment, environment change, QStash call, worker invocation or Production action occurred.

## Later rollout decisions

This is a local review checkpoint, not deployment approval. A separately authorized rollout must review the additive table migration, exact legacy cleanup, trusted Stripe metadata/price mappings, Pro-only Stripe Portal configuration and retirement of the existing external legacy QStash schedule. No test-account backfill is performed. Generic webhook health is explicitly unverified without an event ledger. No paying-customer migration is required per the task premise.

## Human acceptance checklist (not run)

- [ ] Subscribe Pro monthly.
- [ ] Subscribe Pro annual.
- [ ] Checkout return shows Pro immediately.
- [ ] Switch monthly ↔ annual in Portal.
- [ ] Change payment method.
- [ ] Cancel at period end.
- [ ] Confirm Pro remains until period end.
- [ ] Canceled subscription becomes Free.
- [ ] Failed payment / past_due retains Pro.
- [ ] Unpaid becomes Free.
- [ ] Enterprise manual subscription syncs.
- [ ] Enterprise seat quantity syncs.
