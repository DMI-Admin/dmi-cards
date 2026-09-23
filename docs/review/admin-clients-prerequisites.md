# Admin Clients additive prerequisites — local review only

Target inspected read-only: DMI Cards Staging `uohdkewufeivdpaljnng`, PostgreSQL 17.6.
No migration has been applied to staging or Production.

## Order

1. `20260924090000_add_admin_clients_prerequisites.sql`
2. Existing, unchanged `20260924100000_admin_clients_foundation.sql`

The first migration deliberately fails if columns already exist or the captured
provisioning function differs. It is not a blanket migration for an uninspected target.
The original foundation migration does not need changing after these prerequisites.

## Exact additions

- `clients.job_title`: nullable text, no default.
- `client_users.website`, `address`, `whatsapp`, `linkedin`, `instagram`, `facebook`,
  `youtube`, `booking_link`, `custom_url`: nullable text, no defaults.
- `cards.client_id`: nullable UUID, no default; validated `cards_client_id_fkey`
  references `public.clients(id)` with `ON DELETE RESTRICT` (default ON UPDATE NO ACTION).

Text matches existing contact fields; UUID matches `clients.id` and other identity links.
No new indexes are required for correctness of this small prerequisite. No ownership
backfill, data updates, table/column grants, RLS/policy changes or billing changes occur.
RESTRICT prevents deleting an account while cards explicitly reference it. It neither
cascades card deletion nor silently detaches cards. Future account deletion must resolve
these relationships deliberately, including deletion cascades originating from Auth.
Existing individual cards remain unassociated (`client_id IS NULL`). Future company
cards explicitly supply company UUID and the staff Auth owner UUID independently.

## Provisioning correction

Captured `ensure_client_records_for_profile(uuid)` definition MD5:
`010d4e08fb0a67dd5ee0808a7101c8ee`.
The migration removes only the existing-row `account_type = 'individual'` assignment.
Expected corrected definition MD5: `d38f31f4611e7be8fa8a8931b3af150d`.
New account inserts still default to individual. Existing billing/plan preservation,
function identity/signature, security settings and ACL remain unchanged.
`ensure_current_client_account()` is already corrected in staging and is untouched here.

## Existing rows and edit revisions

Every existing field value and row remains unchanged; each new field reads NULL.
Adding a column changes `to_jsonb(cards)` and therefore the whole-row revision used by
existing snapshot/finalizer RPCs. An editor opened before this DDL may receive a safe
revision conflict and must reload. No Media functions or conflict rules are changed.
Do not present this as preserving pre-DDL revision hashes. Reload editor sessions after
application; never bypass stale-revision checks. No existing media references are altered.

## Rollback

`admin-clients-prerequisites-rollback.sql` is review-only and transactionally guarded.
It restores the captured provisioning definition/ACL and removes only the added columns
(and their dependent FK). It refuses to proceed if any added column contains a value,
if the later foundation RPCs are installed, or if the provisioning definition drifted.
Roll back the foundation first if already applied. Never use CASCADE or discard field
data to force rollback. Restoring the original function also restores its old reset bug.

## Local verification

`validate-admin-clients-prerequisites.mjs` reconstructs all 161 captured public columns,
with their actual defaults/nullability, constraints, indexes, RLS, policies, ACLs,
functions and triggers from `scripts/fixtures/admin-clients-staging-schema.json`.
No customer rows, credentials or Auth data are stored in that fixture. Auth itself is a
minimal local test adapter; tests use synthetic users/cards/accounts only.
Engine: isolated PGlite PostgreSQL 17.5; live inspected schema: PostgreSQL 17.6.

Tests cover pristine missing-column shape, both migrations reaching COMMIT, new NULLs,
old row/media value preservation, all unaffected function and security fingerprints,
FK validity/unknown-parent rejection/delete restriction, exact provisioning rollback,
rollback data/dependency guards, drift rollback, new/repeated provisioning and existing
paid/business/enterprise preservation. The foundation suite now uses this same captured
schema before applying prerequisite + foundation, rather than the former richer fixture.
