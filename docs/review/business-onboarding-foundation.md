# Business Onboarding foundation — local review

Prospective records only, separate from operational Business Clients. Requested seats, invoice/trial/complimentary terms and ready_to_activate are informational; none confer access or confirm payment.

## Isolation and API

New public.business_onboardings only. No foreign keys, triggers, cross-table writes, emails, Auth creation or Stripe calls. No activation or deletion endpoint. Existing client/card/media/entitlement tables and functions are unchanged.

GET/POST /api/admin/business-onboardings; GET/PATCH /api/admin/business-onboardings/[onboardingId]; GET /api/admin/business-onboardings/summary. Every handler calls the shared Clerk ID allowlist guard independently. Middleware also protects the page/API. Reads and writes use the service-role client. Responses are private/no-store. Browser saves obtain a fresh Clerk token and retain same-origin credentials.

Strict fields; 40KB streamed body limit; text 2000 characters (email 254); dates/URLs/email/enums validated. Actor IDs and timestamps originate on server. POST uses a unique create_request_id: identical same-actor retries return the first record; differing payload/actor or subsequently updated record returns 409. PATCH is a single conditional UPDATE by UUID+revision and increments revision; stale inputs remain on screen until explicit reload. There is no automatic mutation replay.

Server pagination is fixed at 25, ordered updated_at DESC/id DESC; bounded search and status/access filters. Summary exact counts are separate queries and may momentarily differ during concurrent edits; not a transaction snapshot. In Progress counts all records (all allowed statuses remain pre-activation).

## Database safety

Migration creates one table, its checks and indexes, enables RLS with no policies, removes default direct browser grants, grants service_role SELECT/INSERT/UPDATE only. It aborts on unsafe inherited/role-switch browser access or unexpected service DELETE. It does not change any existing object's ACL/policy/function.

Before staging application, capture existing catalog/data fingerprints and confirm staging project uohdkewufeivdpaljnng. Compare live default grants/role membership and table-name collision. Apply only with separate approval. No external database has been modified by this implementation task.

## Workspace

/business-onboarding is registered in Admin authorization, appearance and sidebar separately from Business Clients. Large embedded workspace stays open after save. Dirty navigation links, sign-out, workspace close/switch, browser history and document unload warn before abandonment. Cancelling history navigation restores the current page URL/state without discarding inputs. Mobile stacks fields and list rows without drawers/dialogs. Existing Admin tokens and System/Light/Dark preferences are reused.

## Local validation

validate-business-onboarding.mjs requires --postgres-module pointing at an external PGlite PostgreSQL 17 installation. It reconstructs the captured staging-shaped public schema without customer rows, tests the whole migration and permissions, and tests API behavior with an isolated query adapter. No network database access. Responsive script requires external esbuild/playwright and a local build; all API/auth calls are fixtures. Hosted PostgREST/search and authenticated browser smoke testing remain staging acceptance gates.

## Rollback

Use business-onboarding-verification.sql before/after deployment alongside captured existing fingerprints. Rollback removes only this table with RESTRICT, and intentionally aborts if rows exist. Export/review prospective data and disable onboarding application entrypoints before any separately authorized destructive rollback. Never restore guessed existing grants: this migration did not modify them.
