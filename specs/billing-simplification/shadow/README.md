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
The separately reviewed operator adapter must feed these frozen records through
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
  SELECT stripe_scope,user_id,stripe_customer_id,stripe_subscription_id,verified,terminal,
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
   (SELECT count(*) FROM s WHERE NOT verified OR sync_snapshot IS NULL) AS unverified_or_missing_snapshot,
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

Require zero check failures, at least one approved price, clean duplicate/ownership
checks, and successful complete local normalization/relationship validation before
seeding. SQL checks are screening, not a replacement for importer validation of
`sync_snapshot`, policy, revisions, timestamps and required fields. A future
SQL Editor export adapter still needs separate implementation/review; the current
source capture API accepts a separately supplied read-only query connection.
No seed or shadow execution is authorized by this query.
