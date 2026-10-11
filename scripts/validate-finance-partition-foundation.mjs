import assert from "node:assert/strict";
import fs from "node:fs";
import {execFileSync} from "node:child_process";
const migration="supabase/migrations/20261009180000_finance_partition_foundation.sql";
const text=fs.readFileSync(migration,"utf8");
const strip=s=>s.replace(/--[^\n]*/g,"").trim();
function validate(source){
 const sql=strip(source);
 const code=sql.replace(/'(?:''|[^'])*'/g,"''");
 const need=(part)=>assert.ok(sql.includes(part),`Missing fixed migration guard: ${part}`);
 assert.ok(sql.startsWith("BEGIN;"));assert.ok(sql.endsWith("COMMIT;"));
 need("SET LOCAL lock_timeout = '5s';");need("SET LOCAL statement_timeout = '60s';");
 for(const delimiter of ["ownership","guard","rpc","security"])
  assert.equal((sql.match(new RegExp("\\$"+delimiter+"\\$","g"))||[]).length,2);
 assert.doesNotMatch(code,/\b(DROP|TRUNCATE|DELETE|EXECUTE IMMEDIATE|CREATE OR REPLACE|OWNER TO)\b/i);
 assert.doesNotMatch(code,/\bEXECUTE\b(?!\s+(?:ON|FUNCTION))/i);
 need("expected_owner IS DISTINCT FROM (CURRENT_USER::pg_catalog.regrole)::oid");
 need("c.relowner IS DISTINCT FROM expected_owner");
 need("pg_catalog.to_regprocedure('public.billing_finance_command(text,text,uuid,jsonb)')");
 need("stripe_scope text PRIMARY KEY CHECK (stripe_scope ~ '^acct_[A-Za-z0-9]+:(test|live)$' AND char_length(stripe_scope) <= 255)");
 need("mode text NOT NULL DEFAULT 'legacy' CHECK (mode IN ('legacy','draining_to_customer','customer','draining_to_legacy'))");
 need("epoch bigint NOT NULL DEFAULT 0 CHECK (epoch BETWEEN 0 AND 9007199254740991)");
 need("CONSTRAINT billing_finance_protocol_foundation_legacy CHECK (mode = 'legacy' AND epoch = 0)");
 need("updated_at timestamptz NOT NULL DEFAULT now()");
 need("ALTER TABLE public.billing_finance_protocol_control ENABLE ROW LEVEL SECURITY;");
 need("REVOKE ALL ON TABLE public.billing_finance_protocol_control FROM PUBLIC,anon,authenticated,service_role;");
 need("GRANT SELECT ON TABLE public.billing_finance_protocol_control TO service_role;");
 need("ALTER TABLE public.billing_finance_event_deliveries ADD COLUMN partition_customer_id text;");
 need("CHECK (partition_customer_id IS NULL OR partition_customer_id ~ '^cus_[A-Za-z0-9]{1,240}$')");
 assert.doesNotMatch(sql,/ADD COLUMN partition_customer_id text\s+(?:NOT NULL|DEFAULT)/i);
 assert.doesNotMatch(sql,/\bUPDATE\s+public\.billing_finance_event_deliveries/i);
 assert.doesNotMatch(sql,/\b(?:ALTER|CREATE)\s+(?:OR REPLACE\s+)?FUNCTION\s+public\.billing_finance_command\b/i);
 assert.doesNotMatch(sql,/\b(?:ALTER|UPDATE|INSERT INTO)\s+public\.billing_finance_sync_runs\b/i);
 assert.doesNotMatch(sql,/CREATE (?:UNIQUE )?INDEX/i);
 need("IF TG_OP = 'INSERT' THEN");need("IF NEW.partition_customer_id IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_PARTITION_BINDING_DISABLED'; END IF;");
 need("IF NEW.partition_customer_id IS DISTINCT FROM OLD.partition_customer_id THEN");
 need("IF OLD.partition_customer_id IS NOT NULL THEN RAISE EXCEPTION 'FINANCE_PARTITION_BINDING_IMMUTABLE'; END IF;");
 need("IF OLD.state IN ('processed','ignored') THEN RAISE EXCEPTION 'FINANCE_PARTITION_BINDING_TERMINAL'; END IF;");
 need("BEFORE INSERT OR UPDATE OF partition_customer_id ON public.billing_finance_event_deliveries");
 const rpc=sql.split("AS $rpc$")[1].split("END $rpc$;")[0];assert.ok(rpc);
 need("p_action NOT IN ('read_protocol','claim_customer','release_customer')");
 assert.deepEqual([...rpc.matchAll(/p_action = '([a-z_]+)'/g)].map(m=>m[1]),["read_protocol","claim_customer"]);
 need("RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public");
 need("p_input - ARRAY['expected_epoch']::text[] <> '{}'::jsonb");
 need("jsonb_typeof(p_input->'expected_epoch') IS DISTINCT FROM 'number'");
 need("expected_epoch > 9007199254740991");
 need("control.epoch IS DISTINCT FROM expected_epoch");
 need("IF control.mode <> 'customer' THEN RAISE EXCEPTION 'FINANCE_PARTITION_DISABLED'; END IF;");
 need("IF control.mode NOT IN ('customer','draining_to_legacy') THEN RAISE EXCEPTION 'FINANCE_PARTITION_DISABLED'; END IF;");
 need("VALUES (p_scope,'customer',p_customer) ON CONFLICT DO NOTHING;");
 need("resource_type = 'customer' AND resource_key = p_customer");
 need("revision = revision + 1");need("interval '120 seconds'");need("lease.revision::text");
 need("resource_key = p_customer AND lease_token = p_token");
 assert.ok(rpc.indexOf("IF control.mode <> 'customer'")<rpc.indexOf("INSERT INTO public.billing_finance_sync_state"));
 assert.ok(rpc.indexOf("IF control.mode NOT IN")<rpc.lastIndexOf("UPDATE public.billing_finance_sync_state"));
 need("FOR SHARE;");need("FOR UPDATE;");need("stamp := clock_timestamp();");
 assert.ok(rpc.indexOf("stamp := clock_timestamp();")>rpc.indexOf("FOR UPDATE;"));
 need("INSERT INTO public.billing_finance_protocol_control(stripe_scope) VALUES (p_scope) ON CONFLICT DO NOTHING;");
 assert.doesNotMatch(rpc,/UPDATE\s+public\.billing_finance_protocol_control|INSERT INTO[^;]+SELECT/i);
 const inserts=[...rpc.matchAll(/INSERT INTO public\.([a-z_]+)/g)].map(m=>m[1]);
 assert.deepEqual(inserts,["billing_finance_protocol_control","billing_finance_sync_state"]);
 const updates=[...rpc.matchAll(/UPDATE public\.([a-z_]+)/g)].map(m=>m[1]);
 assert.deepEqual(updates,["billing_finance_sync_state","billing_finance_sync_state"]);
 need("REVOKE ALL ON FUNCTION public.billing_finance_partition_command(text,text,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;");
 need("GRANT EXECUTE ON FUNCTION public.billing_finance_partition_command(text,text,text,uuid,jsonb) TO service_role;");
 need("REVOKE ALL ON FUNCTION public.billing_finance_receipt_partition_guard() FROM PUBLIC,anon,authenticated,service_role;");
 need("pg_catalog.has_function_privilege(browser_role");need("pg_catalog.has_any_column_privilege(browser_role");
 need("pg_catalog.has_table_privilege('service_role'");
 assert.doesNotMatch(sql,/CREATE POLICY|GRANT\s+(?:ALL|INSERT|UPDATE|DELETE)/i);
}
validate(text);
// Mutation checks: removal/broadening of key guards must make this validator fail.
for(const [before,after] of [
 ["CHECK (mode = 'legacy' AND epoch = 0)","CHECK (epoch >= 0)"],
 ["IF control.mode <> 'customer'", "IF false"],
 ["resource_key = p_customer AND lease_token = p_token","resource_key = p_customer"],
 ["IF OLD.partition_customer_id IS NOT NULL", "IF false"],
 ["IF OLD.state IN ('processed','ignored')","IF false"],
 ["ADD COLUMN partition_customer_id text;","ADD COLUMN partition_customer_id text NOT NULL;"],
 ["'read_protocol','claim_customer','release_customer'","'read_protocol','claim_customer','release_customer','commit'"],
 ["TO service_role;","TO authenticated;"],
 ["interval '120 seconds'","interval '10 seconds'"],
 ["SET LOCAL lock_timeout = '5s';", ""],
 ["control.epoch IS DISTINCT FROM expected_epoch", "false"],
]){assert.ok(text.includes(before));assert.throws(()=>validate(text.replace(before,after)));}
const migrations=fs.readdirSync("supabase/migrations").filter(n=>n.endsWith(".sql"));
assert.deepEqual(migrations.filter(n=>n.startsWith("20261009180000_")),[migration.split("/").at(-1)]);
for(const name of ["billing_finance_protocol_control","billing_finance_partition_command","billing_finance_receipt_partition_guard","billing_finance_protocol_foundation_legacy","billing_finance_receipt_partition_customer_check","partition_customer_id"])
 for(const other of migrations)if(!migration.endsWith(other)){
  const later=fs.readFileSync("supabase/migrations/"+other,"utf8");
  if(!["20261009200000_finance_legacy_protocol_gate.sql","20261009210000_finance_customer_commit_foundation.sql","20261009220000_finance_reconciliation_protocol_guard.sql","20261009230000_finance_protocol_transitions.sql","20261010010000_finance_foreign_receipt_completion.sql","20261010030000_finance_invoice_proof_commit.sql","20261010050000_billing_consumer_worker_fencing.sql","20261011000000_finance_dmi_charge_integration.sql"].includes(other))assert.ok(!later.includes(name),"Object name collision");
  const declarations=[...later.matchAll(/\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|FUNCTION|TRIGGER)|ADD\s+(?:COLUMN|CONSTRAINT))\s+(?:public\.)?([a-z_]+)/gi)].map(m=>m[1]);
  const approvedReplacement=other==="20261009210000_finance_customer_commit_foundation.sql" && ["billing_finance_partition_command","billing_finance_receipt_partition_guard"].includes(name);
  if(!approvedReplacement)assert.ok(!declarations.includes(name),"Object declaration collision");
 }
for(const file of execFileSync("git",["ls-files","--cached","--others","--exclude-standard","src"],{encoding:"utf8"}).trim().split("\n"))
 if(!["src/lib/stripe/finance-store.ts","src/lib/stripe/billing-work-runtime.ts"].includes(file))assert.doesNotMatch(fs.readFileSync(file,"utf8"),/billing_finance_partition_command/);
assert.equal(execFileSync("git",["diff","HEAD","--","src",":(exclude)src/lib/stripe/finance-customer-webhook.ts",":(exclude)src/lib/stripe/webhook-observer.ts",":(exclude)src/lib/stripe/finance-contract.ts",":(exclude)src/lib/stripe/lease-acquisition-timing.ts",":(exclude)src/lib/stripe/finance-sync.ts",":(exclude)src/lib/stripe/finance-webhook.ts",":(exclude)src/lib/stripe/finance-store.ts",":(exclude)src/lib/stripe/webhook-consumers.ts",":(exclude)src/lib/stripe/finance-routing-evidence.ts",":(exclude)src/lib/stripe/finance-customer-routing.ts",":(exclude)src/lib/stripe/finance-customer-relationship-adapter.ts",":(exclude)src/lib/stripe/finance-sync.ts",":(exclude)src/lib/stripe/finance-reconciliation.ts","supabase/migrations/20260930120000_finance_v1_foundation.sql","supabase/migrations/20260930130000_finance_v1_writer.sql","supabase/migrations/20261003120000_finance_tax_evidence.sql",':(exclude)src/app/api/stripe/webhook/route.ts',':(exclude)src/middleware.ts',':(exclude)src/lib/stripe/billing-work-recovery.ts',':(exclude)src/lib/stripe/billing-work-runtime.ts',':(exclude)src/lib/stripe/billing-work-store.ts',':(exclude)src/lib/stripe/billing-work-worker.ts'],{encoding:"utf8"}),"");
console.log("PASS: inactive legacy-only foundation, additive receipt guard, closed gated RPC, token/epoch fencing, ownership/ACL checks, naming, mutation checks, unchanged live Finance/reconciliation (static/offline; SQL not executed).");
