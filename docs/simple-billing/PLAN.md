# Simple billing rewrite — local planning checkpoint

Source: `release/admin-ui-foundation` at `e71c5ce94cdcd76cd268ad97c5a4660943369a4e`.
Branch: `rewrite/simple-stripe-billing`. No hosted changes authorized.

Exact source-derived file/object/dependency/deletion inventory: [INVENTORY.json](INVENTORY.json).
Counts include physical blank/comment lines and retained migration history; shared modules are separately identified.

## Before

- billing_runtime_files: 107
- billing_runtime_physical_loc: 12525
- billing_scripts_tests_specs_files: 95
- billing_scripts_tests_specs_physical_loc: 20471
- billing_migrations: 28
- billing_migration_physical_loc: 6277
- billing_api_routes: 14
- billing_db_tables_represented: 39
- v1_billing_tables: 24
- v2_tables: 15
- total_dedicated_billing_physical_loc: 39273

## Target

Embedded Checkout → Stripe → one shared subscription sync → account_billing → client-context → retained entitlements.
Checkout return and webhook use that same synchronizer. Customer Portal manages Pro changes; Enterprise remains sales-managed.
Stripe owns invoices, payments and refunds. No queue, worker, Finance projection or activation poller.

## Dependency decisions before deletion

- Entitlement module is actually `src/lib/entitlements/index.ts`; retain it unchanged. Enterprise already maps to Pro features.
- Generic health monitoring currently reads `stripe_webhook_events`. Preserve generic monitoring and remove only that obsolete billing-ledger probe.
- Admin subscription inventory and Finance screens depend on old projections. Replace the Finance projection screen with a Stripe financial-history link; adapt subscription inventory to account_billing without new provider projections.
- Business commercial approval tables are explicitly not Stripe access writers. Preserve onboarding/workspace/proposal functionality; do not include these objects in cleanup.
- Historical migrations remain unchanged. Generate reviewed, exact obsolete-object cleanup list before any future cleanup SQL; never use CASCADE.

## Checkpoint

Inventory and deletion manifest were recorded before runtime changes. The replacement flow and central entitlement read were tested before legacy deletion. Implementation, deletion, disposable database checks and final local validation are now complete. No hosted action, commit or push occurred. Final measurements and a review-ready PR description are in MEASUREMENTS.json and PR-DESCRIPTION.md.

Inventory correction during deletion review: the obsolete Subscriptions CSS module was added to the exact source-SHA inventory and counts before its deletion. Generic admin/health validators now exclude only the intentionally replaced billing screens and retain their unrelated invariants.
