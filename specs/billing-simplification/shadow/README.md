# Billing V2 access-seed foundation — local review only

No hosted execution, credential provisioning, commit, push or deployment is authorized in this phase. Existing V1 remains authoritative. No flags, routes, provider clients, capture or runner are introduced.

`contract.json` defines the seed-only boundary. The additive fourth migration creates one NOLOGIN seed capability and nine functions in `billing_v2`; it adds no table and never alters the prior three migrations or V1 objects/grants. The five callable seed functions repeat the effective privilege audit, including PUBLIC execution and inherited membership. Any unexpected capability fails closed. The audit permits ordinary SECURITY INVOKER SQL/PLpgSQL helpers without a name allowlist: they retain the caller’s denied write privileges. It rejects effective execution of public billing_/stripe_ entry points, V2 namespace/runtime-owner functions, reachable non-system SECURITY DEFINER functions, and reachable extension/native functions. It also rejects database/schema CREATE and persistent object ownership. Database TEMPORARY is not a persistent-object privilege and is not a seed audit gate; the capability stays NOLOGIN and is used only through reviewed seed RPCs. Existing grants must not be changed automatically.

The existing operations table holds one mutable preparing manifest and immutable page audit records. Each page contains at most 100 frozen access rows. Source checkpoint, counts, row keys, page hashes and manifest digest are verified by PostgreSQL. Final publication re-reads actual typed rows and relationships. Completion is immutable. No `authority.shadow_dataset` gate is published, so even a complete import leaves existing claim blocked. The seed role has no task execution grant.

The operator tool accepts a frozen normalized access snapshot, or captures approved V1 columns through a separately supplied SELECT-only connection in a repeatable-read/read-only transaction. Capture reads persisted Finance item price facts only to establish product/interval; it does not import Finance. Missing or conflicting price facts reject capture; there is no Stripe fallback. V1 billing_accounts has no created_at or binding revision: verified_at is explicitly used as the candidate baseline creation time and binding revision starts at zero. Original source fields are covered by the source digest. Subscription IDs/revisions/last-event identity are preserved. Historical leases and checkout attempts are never imported. Detailed frozen data remains privileged, never diagnostic output.

A transport interruption resumes using the same frozen snapshot/manifest and replays identical page keys; no new generation or reset is invented. Separate imports cannot overwrite an existing dataset. The tool defaults to dry-run and has no connection factory or environment/secret loader. The future operator adapter must attest actual Staging project identity and a read-only source/seed-only destination; labels are not authentication. Hosted provisioning, catalog checks and login capability audits must precede use. No such adapter or credential is provisioned here.

Run `node specs/billing-simplification/shadow/validate.mjs` and `node specs/billing-simplification/shadow/postgres.mjs /absolute/postgres/bin /absolute/pg/module`. All PostgreSQL work uses a disposable local Unix-socket server with TCP disabled. Reapplying the non-idempotent migrations is tested as fail-closed transactional rejection; normal deployment must use an exact checksum/version ledger, not blindly replay SQL.

## Next operator step: frozen SELECT-only source export (not executed)

Run only in the independently verified Staging SQL Editor. Save the result in
restricted operator storage, never chat, diagnostics or the repository: this
export necessarily contains account/customer/subscription identifiers. One
statement gives a consistent MVCC snapshot across all six sources. It creates
no role and calls no billing RPC. This is source evidence, not an import manifest.
The isolated offline adapter feeds these frozen records through
`captureAccessSnapshot`/`prepareAccessSeed` to normalize, hash and dry-run them;
never manufacture `complete`, digests or publication markers by hand.

```sql
WITH
 a AS MATERIALIZED (
  SELECT stripe_scope,user_id,stripe_customer_id,verified_at,generation::text,updated_at
  FROM public.billing_accounts
  WHERE stripe_scope='acct_1OoTzlG71GpCYtA4:test' AND stripe_customer_id IS NOT NULL
 ),
 p AS MATERIALIZED (
  SELECT stripe_scope,stripe_price_id,entitlement_enabled,checkout_enabled,approved_at
  FROM public.billing_approved_prices WHERE stripe_scope='acct_1OoTzlG71GpCYtA4:test'
 ),
 s AS MATERIALIZED (
  SELECT stripe_scope,user_id,stripe_customer_id,stripe_subscription_id,
   stripe_subscription_status,stripe_price_id,dmi_plan,current_period_start,current_period_end,
   trial_end,ended_at,cancel_at_period_end,latest_invoice_id,terminal,
   revision::text,last_event_created::text,last_event_id,verified_at,created_at,updated_at,sync_snapshot
  FROM public.billing_subscriptions WHERE stripe_scope='acct_1OoTzlG71GpCYtA4:test'
 ),
 o AS MATERIALIZED (
  SELECT stripe_scope,resource_type,stripe_resource_id,application_key,ownership_basis,
   revision::text,state,updated_at
  FROM public.billing_stripe_resource_ownership
  WHERE stripe_scope='acct_1OoTzlG71GpCYtA4:test' AND resource_type='price'
   AND stripe_resource_id IN (SELECT stripe_price_id FROM p)
 ),
 d AS MATERIALIZED (
  SELECT application_key,state FROM public.billing_stripe_applications WHERE application_key='dmi_cards'
 ),
 i AS MATERIALIZED (
  SELECT stripe_price_id,stripe_product_id,recurring_interval,interval_count,verified_at
  FROM public.billing_finance_subscription_items
  WHERE stripe_scope='acct_1OoTzlG71GpCYtA4:test' AND removed_at IS NULL
 ),
 checks AS (
  SELECT
   (SELECT count(*) FROM a WHERE verified_at IS NULL) AS unverified_accounts,
   (SELECT count(*) FROM s WHERE verified_at IS NULL OR revision::bigint<1 OR sync_snapshot IS NULL OR jsonb_typeof(sync_snapshot) IS DISTINCT FROM 'object'
    OR stripe_subscription_status='unknown'
    OR sync_snapshot->>'subscription_id' IS DISTINCT FROM stripe_subscription_id
    OR sync_snapshot->>'customer_id' IS DISTINCT FROM stripe_customer_id
    OR sync_snapshot->>'status' IS DISTINCT FROM stripe_subscription_status
    OR sync_snapshot->>'price_id' IS DISTINCT FROM stripe_price_id
    OR sync_snapshot->>'plan' IS DISTINCT FROM dmi_plan
    OR sync_snapshot->>'terminal' IS DISTINCT FROM terminal::text
    OR sync_snapshot->>'cancel_at_period_end' IS DISTINCT FROM cancel_at_period_end::text
    OR sync_snapshot->>'invoice_id' IS DISTINCT FROM latest_invoice_id
    OR terminal IS DISTINCT FROM (stripe_subscription_status='canceled')
   ) AS unverified_or_missing_snapshot,
   (SELECT count(*) FROM s WHERE NOT EXISTS (
    SELECT 1 FROM a WHERE a.user_id=s.user_id AND a.stripe_customer_id=s.stripe_customer_id
     AND a.verified_at IS NOT NULL)) AS inconsistent_subscription_bindings,
   (SELECT count(*) FROM p WHERE NOT EXISTS (
    SELECT 1 FROM o JOIN d ON d.application_key=o.application_key
    WHERE o.stripe_resource_id=p.stripe_price_id AND o.application_key='dmi_cards'
     AND o.state='active' AND d.state='active' AND o.revision::bigint>=1)) AS missing_active_price_ownership,
   (SELECT count(*) FROM p WHERE
    (SELECT count(DISTINCT jsonb_build_array(stripe_product_id,recurring_interval,interval_count))
     FROM i WHERE i.stripe_price_id=p.stripe_price_id)<>1
    OR NOT EXISTS (SELECT 1 FROM i WHERE i.stripe_price_id=p.stripe_price_id)
    OR EXISTS (SELECT 1 FROM i WHERE i.stripe_price_id=p.stripe_price_id AND
     (i.stripe_product_id IS NULL OR i.verified_at IS NULL OR i.interval_count IS DISTINCT FROM 1
      OR i.recurring_interval IS NULL OR i.recurring_interval NOT IN ('month','year')))
   ) AS missing_or_ambiguous_product_interval
 )
SELECT jsonb_build_object(
 'scope','acct_1OoTzlG71GpCYtA4:test',
 'source_snapshot',pg_current_snapshot()::text,
 'captured_at',statement_timestamp(),
 'checks',(SELECT to_jsonb(checks) FROM checks),
 'billing_accounts',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY user_id),'[]'::jsonb) FROM a),
 'billing_approved_prices',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY stripe_price_id COLLATE "C"),'[]'::jsonb) FROM p),
 'billing_subscriptions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY stripe_subscription_id COLLATE "C"),'[]'::jsonb) FROM s),
 'billing_stripe_resource_ownership',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY stripe_resource_id COLLATE "C"),'[]'::jsonb) FROM o),
 'billing_stripe_applications',(SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) FROM d),
 'price_items',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY stripe_price_id COLLATE "C"),'[]'::jsonb) FROM i)
) AS frozen_access_source;
```

Require zero non-catalog check failures and zero unresolved catalog rows, at least one approved price, clean duplicate/ownership
checks, and successful complete local normalization/relationship validation before
seeding. SQL checks are screening, not a replacement for importer validation of
`sync_snapshot`, policy, revisions, timestamps and required fields. The offline adapter validates this exact one-row export; the source capture API
continues to accept a separately supplied read-only query connection.
No seed or shadow execution is authorized by this query.

## Offline frozen-export validation

No hosted connection or credential is accepted. No migration or seed capability
is changed. The file must be outside the repository, and its independently
recorded capture-time SHA-256 is mandatory. Preserve the original JSON bytes,
including the one-row `frozen_access_source` wrapper; do not edit or reformat it.
A JSON object cell or a JSON-string cell within that wrapper is supported.

```sh
node specs/billing-simplification/shadow/frozen-export.mjs
node specs/billing-simplification/shadow/validate-export.mjs /absolute/private/export.json CAPTURE_TIME_SHA256 /absolute/postgres/bin /absolute/pg/module
```

The first command uses synthetic fixtures only. The second reads the original
file without writing it, checks its raw checksum, validates closed field sets,
all six sources, screening results, scope, identities, uniqueness, binding and
canonical snapshot policy, active catalog ownership/revisions and persisted
product/interval facts. It reuses `captureAccessSnapshot` through an in-memory,
read-only source adapter, then calls `prepareAccessSeed`. Repeated identical
bytes produce identical normalized/source/page/manifest digests. A checksum
establishes integrity relative to the operator's recorded value, not project
identity or completeness of the original database query: the independent
Staging SQL Editor target and exact SELECT remain operator prerequisites.

Only disposable Unix-socket PostgreSQL with TCP disabled is used afterward.
`importAccessSeed(..., dryRun=true)` must issue zero queries. A subsequent
transactional local import exercises the unchanged typed seed RPCs/constraints,
checks no tasks/authority were published, and rolls back; the temporary cluster
is removed. This is not a Staging seed. The CLI prints counts/checksums/fixed
status only, suppresses database error details and rechecks original file bytes.
It never saves normalized sensitive records or accepts a database URL.

Fixture validation does not prove a real Staging export passed. Without an
operator-provided export and recorded checksum, installation/seed readiness
remains unverified. No hosted operation is authorized by these commands.

## V1 subscription verification contract

V1 has no `billing_subscriptions.verified` column. The export retains physical
`verified_at`, positive `revision`, `sync_snapshot`, `terminal` and the matching
status/plan/price/period/cancellation/invoice columns. The fenced V1 commit writes
these together. Timestamp presence alone is insufficient for import: every
snapshot field must agree with its physical mirror (timestamp instants are
compared), ownership must match a verified account, and current approved-price
checks still apply. Unknown/uninitialized or inconsistent rows reject; they are
not silently filtered out. `terminal` is persisted and must agree with the
snapshot and canceled-state policy. `verified_at` may advance on an unchanged
commit while `updated_at` stays unchanged, so the importer preserves the actual
verification timestamp without requiring it to equal the update timestamp.
The SQL screening is preliminary; the offline adapter enforces the complete
canonical evidence contract. Existing V1 runtime/migrations remain untouched.

## Immutable catalog-evidence companion (version 1)

A companion supplements missing catalog facts only. The original six datasets,
raw file, checksum and SQL screening remain unchanged: a missing Finance fact
still reports one original screening failure even when separately resolved.
Invalid or ambiguous persisted facts cannot be repaired by a companion. Matching
persisted facts need no companion; a supplied matching companion is recorded as
confirmation. Any disagreement or duplicate price companion rejects.

The closed schema is `catalog-companion.schema.json`; the offline resolver also
enforces relationships, canonical checksum and time validity. Evidence is limited
to a trusted TEST Price GET observation for the exact account, approved price,
product and export. Both ownership revision fields refer to the existing price
ownership row: its revision versions the application-to-price binding. There is
no global application revision in V1. `application_state_digest` separately binds
the frozen application record; no revision is invented. Retrieval must occur at
or after export capture, not in the future, and within 24 hours of validation.
A stale artifact stays immutable; fresh capture needs separate provider approval.

Store the private companion outside the repository with owner-only permissions.
Never paste its contents into chat or place identifiers in general logs. Preserve
trusted account-context, GET request ID, retrieval UTC timestamp and the minimal
Price response fields in the schema. Copy facts only from an approved retained
provider response or a separately authorized operator capture. Do not reconstruct
missing facts from interval names or a prior summary. The earlier lookup did not
retain enough private facts to assemble a real companion safely.

Construct the schema body without `checksum`, then set `checksum` to the existing
`seedDigest(body)` from `staging-seed.ts` (canonical sorted JSON SHA-256). Store the
completed JSON once; independently record SHA-256 of its exact UTF-8 file bytes.
These are distinct hashes. Checksums detect tampering against recorded values;
they do not authenticate Stripe or prove an operator's claim. Trusted capture is
required. Do not use synthetic fixture facts with a real export.

```sh
node specs/billing-simplification/shadow/catalog-companion.mjs /absolute/postgres/bin /absolute/pg/module
node specs/billing-simplification/shadow/validate-export.mjs /absolute/private/export.json EXPORT_SHA256 /absolute/postgres/bin /absolute/pg/module /absolute/private/companion.json COMPANION_FILE_SHA256
```

Validation reports only original screening counts, persisted/resolved/unresolved
counts, logical recurrence counts and companion digests. All unresolved catalog
rows must be resolved before normalization and `prepareAccessSeed`. Provenance
participates in the seed source digest. Pure dry-run issues zero database queries;
only the separate disposable PostgreSQL exercise imports and rolls back locally.
No hosted migration, seed, provider call or shadow activation is authorized.

### Operator sealing step (offline; after trusted capture only)

Prepare a private JSON body containing every schema field except `checksum`, using
retained provider facts and the frozen ownership revisions. The application state
digest is `seedDigest(frozen_access_source.billing_stripe_applications[0])`.
The following template seals an already prepared body; it never calls a provider
and must not be run until the required capture exists. Both paths must be outside
the repository. It refuses to overwrite an existing companion and prints only its
raw file checksum. Preserve the original capture separately.

```sh
node --input-type=module - /absolute/private/captured-body.json /absolute/private/catalog-companion.json <<'JS'
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {load} from './specs/billing-simplification/local/load.mjs';
const {seedDigest}=load('src/lib/billing-v2/tooling/staging-seed.ts');
const body=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(Object.hasOwn(body,'checksum'))throw Error('BODY_ALREADY_SEALED');
const text=JSON.stringify({...body,checksum:seedDigest(body)})+'\n';
fs.writeFileSync(process.argv[3],text,{flag:'wx',mode:0o600});
console.log(createHash('sha256').update(text).digest('hex'));
JS
```

Record that checksum independently, then use `validate-export.mjs` above. Sealing
alone is not validation or provider authentication. No installation/seed decision
can be made until the real export and real companion pass together.
