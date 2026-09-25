# Business entitlement foundation — local review

Migration: `20260925120000_business_entitlement_foundation.sql`. No external execution is authorized by implementation.

## Model and meaning

One immutable workspace UUID per exact onboarding UUID; one authoritative current entitlement per workspace. `client_id` is nullable/unique/restrictive and constrained NULL in Phase 2. No name/email matching. Future operational provisioning needs a separately reviewed change permitting explicit client UUID linkage.

Commercial activation does not create a Business Client, portal, membership, Auth user, card, subscription or consumed seat. `ready_to_activate` is commercial preparation only. Existing Individual/Stripe/Free/Pro/card-slot paths remain untouched.

All three sources require finite UTC validity. Saved proposal dates convert to 00:00 UTC; end is exclusive. Resolver evaluates database statement time: starts_at <= now < ends_at. Suspended/revoked take precedence; scheduled/expired/absent yield zero effective allowance. No cron required. Display is a fetched snapshot; Refresh status obtains fresh database evaluation. Future authorization must call the server resolver, never trust a previously rendered status.

Invoice confirmation is a human payment attestation: payment date, invoice reference, annual/quarterly frequency and reason required. It grants the full contract term, not the payment quarter. Later non-payment requires explicit suspension. Trials and complimentary access use the same finite commercial approval foundation.

## Transactions and security

Protected Admin Clerk ID allowlist on every endpoint, server-derived actor, fresh mutation token, same-origin checks, strict fields, 16kB request limit and private/no-store. No direct browser database writes.

Command locks onboarding -> workspace -> entitlement. Expected revisions, operation UUID and full payload/actor equality provide replay safety. A retry returns the immutable original receipt before stale-revision checks. Different payload conflicts; competing commands serialize. Audit insert, current entitlement, workspace and onboarding revisions commit together or all roll back. Proposal update trigger blocks commercial field edits once activated under the same onboarding lock.

RLS enabled, no policies, anon/authenticated no table/column/RPC access. service_role has SELECT only on new tables, EXECUTE only on resolver/command. Destructive direct service writes denied. Event UPDATE/DELETE additionally blocked by trigger. Migration asserts effective browser inherited/member-role privileges and service-only table access; fixed function search paths. Database owner remains a trusted administration boundary.

Explicit amend (seats/expiry/contract reference), suspend/reactivate and terminal revoke each require reason and revisions and append history. No stacking, source conversion, renewal/regrant after revocation or prior-entitlement fallback. No seat usage yet.

## UI

Onboarding proposal is distinct from Business Entitlement and read-only commercial history. Confirmation captures the reviewed revisions, so refreshing cannot silently authorize stale input. Unchanged expiry is not rewritten/truncated by amendment. Duplicate-submit lock and explicit retry reuse operation UUID; no automatic mutation replay. Parent refresh follows durable success. Failed commands preserve form input.

## Validation and rollout

`validate-business-entitlements.mjs` accepts an external PGlite module or dedicated loopback-only PostgreSQL port/pg module. It creates its own staging-shaped fixture, never connects to Supabase. Real independent connection tests cover activation contention and receipt replay. Browser regressions use mocked auth/API and actual UI only.

Before later staging apply: verify absence of new objects, capture existing row/catalog fingerprints and role memberships, compare prerequisite onboarding schema, run verification SQL before/after, and verify no operational data changed. No application smoke-test mutation until separately approved.

Rollback SQL is transactional, takes the same table order and refuses when any workspace/current entitlement/event exists. It uses no CASCADE and restores the original proposal path only when empty. After commercial activation, use forward repair preserving audit receipts. No existing table grants/policies are changed by this migration.

Deferred: operational company provisioning, memberships/invites/imports, issuance/seat consumption, portal/public/Wallet lifecycle enforcement, Business Stripe, self-service signup and Individual complimentary Pro. Existing company card-slot/bulk-issuance limitations are not changed or enabled by this phase.

## Completed local evidence

2026-09-25: migration/verification/empty rollback/refusal-after-history tested in PGlite and isolated PostgreSQL 17.6. Two pre-established native PostgreSQL connections demonstrate row-lock wait, exact-operation replay and stale competing-command rejection. Temporary PostgreSQL servers stopped afterward. No Supabase connection used.

All 16 contract/security suites passed: Business Onboarding/entitlements, Admin auth/appearance, Clients foundation/prerequisites/pages, Admin card mutations, secure-write transition, canonical Individual entitlement, Stripe billing, Cards hardening, media cleanup/integration/finalization, Client card contract. Lint, TypeScript, production build and diff checks passed. Existing Next.js middleware-to-proxy deprecation warning remains.

Chromium and WebKit fixture browser tests passed the onboarding matrix plus invoice/trial/complimentary confirmation, cancellation, missing token, failed-command UUID retry, duplicate prevention, stale confirmation and seat-only amendment without expiry rewrite. Layouts cover 320–1920px, light/dark/system modes; fixture commercial panels use no real customer records or external services.

Staging apply and authenticated Preview testing remain separate approval gates. No deployment, commit, environment change or external database mutation is part of this evidence.
