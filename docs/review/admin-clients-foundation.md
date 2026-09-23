# Admin Clients foundation — local review only

Baseline: release/client-card-media 27f2a5d; main d3c102c has the same source tree.
No unfinished original-workspace code was copied.

## Protected operations

Existing Clerk ID-only authorization gates every route before service-role access.
Browser Clients/Staff mutations now use API routes. Arbitrary identity, billing and
stored-count fields are rejected. Cross-origin requests with an Origin header are denied.
Client contact updates remain single-row operations. Staff creation/update lock the
parent account; status changes update the parent and all memberships atomically.
Deleting a linked staff membership is refused; only unlinked contacts can be deleted.
No Auth users, Stripe subscriptions or entitlements are created by these actions.

## Counts

The protected summary verifies linked UUIDs via Auth Admin getUserById, deduplicates
identities across account/membership rows, and never returns Auth payloads.
Individual counts use cards.user_id; company counts use cards.client_id.
Staff preview matching requires both the verified user UUID and explicit company ID.
Conflicting user_id/profile_id links fail closed rather than using email/name.
The deprecated clients.cards_active field is neither read nor editable in this UI.
Billing labels remain legacy display data; Stripe is unchanged and authoritative.

## Database dependency

Apply the reviewed `20260924090000_add_admin_clients_prerequisites.sql` first; see
`admin-clients-prerequisites.md`. Then
20260924100000_admin_clients_foundation.sql must be reviewed and applied before
these new mutation APIs can operate. It has NOT been applied to any external database.
It adds four service-role-only functions for atomic status/import and serialized staff
writes, and replaces the two existing provisioning definitions solely to remove the
five assignments that reset existing account/profile type/plan/billing fields.
New users still default to individual/free. Existing provisioning grants are preserved.
No tables, columns, RLS policies, Cards/media functions or billing webhooks change.

Before rollout inspect actual deployed provisioning definitions and capture their
pg_get_functiondef/ACLs; local source cannot establish manual Production differences.
Rollback requires disabling these new application paths first, then restoring captured
provisioning definitions and dropping the four newly added RPCs. Do not blindly restore
the old reset behavior after users have started relying on preserved company accounts.

## Import behavior

Maximum 50 companies / 200 staff per request. All rows validate before the RPC.
The entire import is one transaction: a row failure rolls everything back.
Stable per-operation UUIDs permit an unchanged retry after a lost response, protected
by a transaction advisory lock. Existing IDs with differing content cause rollback;
imports never overwrite existing accounts. Keep the same mounted import review to retry.
Reloading/restarting or altering the import is a new operation; cross-file deduplication
and persistent import jobs are deferred. Missing company-contact email now blocks an
import instead of inventing an email address. No invitations are sent.

## Explicit behavior changes / limitations

Creation preserves the selected initial account status. Imported staff inherit suspension.
Plan/billing/status fields are read-only in account detail editing; status uses its
atomic action. Staff can be individually suspended, but cannot be reactivated while
the parent account is suspended. Company reactivation retains the prior behavior of
reactivating all its staff. Linked staff deletion requires future deprovisioning.
Account type changes and existing contact-to-account reconciliation remain legacy
behavior; this is not a company invitation/activation or billing redesign.
The summary uses paginated reads and bounded Auth concurrency, not a database-wide
snapshot. Large inventories may need a dedicated aggregate read later.
This removes browser writes in application code; it does not audit/revoke live Clients/
Staff table ACLs. The existing Client API suspension-enforcement gap identified in the
audit is not changed by this Admin-only phase. UI suspension is not token revocation.

## Validation

node scripts/validate-admin-clients-foundation.mjs
node scripts/validate-admin-clients-foundation.mjs --postgres-module=/absolute/path/to/@electric-sql/pglite/dist/index.js

The optional SQL suite uses a fresh in-memory PostgreSQL engine with the captured staging public schema, synthetic rows,
a minimal Auth test adapter and no network/credentials. It tests COMMIT, provisioning preservation, RPC permissions,
atomic rollback, retry conflicts and suspended-parent staff handling.
