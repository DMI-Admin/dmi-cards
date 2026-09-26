# Read-only Admin Card Management

The `/cards` route is a support inventory. It has no create, edit, publish,
delete, impersonation, or media upload controls. `/api/admin/cards/support`
exports GET only and authorizes Clerk IDs through `requireAdminAccess` before
constructing the service-role client. All responses are private/no-store.

## Data contract

- Reads existing `cards`, `clients`, and `templates` through their foreign keys.
- Uses explicit selected columns and a second response allowlist. No contact
  details, card content, images, custom fields, captured leads, or provider data.
- Fixed 25-row pages, positive pages up to 9999, bounded 80-character search,
  deterministic `updated_at DESC NULLS LAST, id ASC` ordering.
- Search matches stored card/owner names, card/company names, associated client
  names, and public slugs. Search does not search emails or infer identities.
- Database-side relationship search/filtering uses PostgREST's documented
  [empty embeds and null filters](https://docs.postgrest.org/en/v13/references/api/resource_embedding.html#or-filtering-across-embedded-resources).
- Global counters are labelled separately from filtered matching-card counts.
  Counters are independent read queries, not a transactional snapshot.
- Explicit business/enterprise clients classify as Business. Explicit individual
  clients or existing unassociated owner-linked cards classify as Individual,
  matching the established card ownership model. Unowned or unresolved client
  links remain Unknown; company-name text never determines account type.
- The linked client's stored subscription plan is reference metadata only.
  Missing plans remain unavailable; this page does not make entitlement decisions.

Public links use only an existing conservative single-segment slug and require
both the card and its template to satisfy the public resolver's publication OR
rule (`status = published` or `is_published = true`). Links remain on the current
origin, open a new tab with noopener/noreferrer, and never use a saved external
URL. Unavailable links are disabled with a reason. No background public-card
requests are made. Concurrent publication changes can still make a link stale.

## Legacy dependencies

The old Cards implementation is preserved unchanged except for an explanatory
comment at `src/components/admin/legacy/LegacyBusinessCards.tsx`. It is not
imported by any route and cannot be opened through the support workspace.

Its existing dependencies remain: Admin inventory/templates helpers, renderer,
and `admin-card-mutations` helpers/APIs. Existing Clients and Public Pages still
use the shared inventory and mutation paths, so those paths are untouched.
No new write endpoints are introduced. A later removal of the legacy component
must not remove shared APIs without reviewing those remaining callers.

## Validation boundary and next decisions

`validate-admin-card-support.mjs` exercises actual authorization, route and
Supabase HTTP query construction using an intercepted fixture transport. It
also executes the UI read lifecycle, stale-response protection, filtering,
pagination, details and public-link actions. No SQL or remote DB calls occur.

Responsive containment and Admin theme-token usage are checked in source;
visual browser validation remains outstanding because the browser connection
is unavailable in this session. Live relationship/schema compatibility has not
been queried in this local-only phase; schema drift fails closed.

Before Support Edit: decide authorized fields and support roles, owner consent
and attribution, audit records, revision/conflict handling, canonical entitlement
checks, publication safeguards, and media ownership/finalization behavior.
Any write capability needs separately reviewed server validation and endpoints.
