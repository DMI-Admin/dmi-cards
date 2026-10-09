import "server-only";
import {safeId, validPartition, type Partition, type RelationshipResource} from "./finance-customer-relationships";
import type {Bundle, Graph} from "./finance-contract";

type Row = Record<string, unknown>;
export type StoredOwnership = Partial<Record<RelationshipResource, readonly Row[]>>;
export type OwnershipResult = {valid:true} | {valid:false;code:"FINANCE_OWNERSHIP_INVALID" | "FINANCE_OWNERSHIP_MISSING" | "FINANCE_OWNERSHIP_CONFLICT" | "FINANCE_OWNERSHIP_DUPLICATE"};
const resources = ["subscriptions","items","invoices","payments","refunds","allocations","attempts","activity"] as const;
const prefixes = {subscriptions:"sub",items:"si",invoices:"in",payments:"ch",refunds:"re",allocations:"inpay"};
const identityFields = ["stripe_customer_id","stripe_subscription_id","stripe_invoice_id","stripe_charge_id","stripe_payment_intent_id","object_type","object_id"];
class OwnershipFailure extends Error {
 constructor(readonly code: Extract<OwnershipResult,{valid:false}>["code"]) {super("FINANCE_OWNERSHIP_REJECTED");}
}
function reject(code: Extract<OwnershipResult,{valid:false}>["code"]): never {throw new OwnershipFailure(code);}
function record(value: unknown): Row {
 if (!value || typeof value !== "object" || Array.isArray(value)) reject("FINANCE_OWNERSHIP_INVALID");
 return value as Row;
}
function reference(value: unknown, prefix: string): string {
 if (!safeId(value,prefix)) reject("FINANCE_OWNERSHIP_INVALID");
 return value;
}
function objectId(value: unknown): unknown {
 return value && typeof value === "object" ? record(value).id : value;
}
/** Additional ownership check only; never replaces existing monetary/revision/attribution checks.
 * Stored rows must be independently read by a trusted caller. No I/O or logging here.
 */
function validateRows(partition: Partition, rows: StoredOwnership, stored: StoredOwnership): OwnershipResult {
 try {
  if (!validPartition(partition)) reject("FINANCE_OWNERSHIP_INVALID");
  const maps = new Map<RelationshipResource,Map<string,Row>>();
  const current = new Map<RelationshipResource,Map<string,Row>>();
  function key(kind: RelationshipResource,row: Row): string {
   const value = kind === "attempts" ? row.attempt_key : kind === "activity" ? row.activity_key : row.stripe_object_id;
   if (kind === "attempts") {
    if (typeof value !== "string" || value !== `charge:${reference(row.stripe_charge_id,"ch")}`) reject("FINANCE_OWNERSHIP_INVALID");
   } else if (kind === "activity") {
    if (typeof value !== "string" || value.length > 400 || !/^[A-Za-z0-9_:.-]+$/.test(value)) reject("FINANCE_OWNERSHIP_INVALID");
   } else reference(value,prefixes[kind]);
   return value as string;
  }
  for (const kind of resources) {
   const combined = new Map<string,Row>(), incoming = new Map<string,Row>();
   for (const [source,target] of [[stored,combined],[rows,incoming]] as const) {
    const entries = source[kind] ?? [];
    if (!Array.isArray(entries) || entries.length > 200) reject("FINANCE_OWNERSHIP_INVALID");
    for (const value of entries) {
     const row = record(value);
     if (row.stripe_scope !== partition.scope) reject("FINANCE_OWNERSHIP_CONFLICT");
     const id = key(kind,row);
     if (target.has(id)) reject("FINANCE_OWNERSHIP_DUPLICATE");
     target.set(id,row);
    }
   }
   for (const [id,row] of incoming) {
    const previous = combined.get(id);
    if (previous) for (const field of identityFields) {
     if (previous[field] != null && previous[field] !== row[field]) reject("FINANCE_OWNERSHIP_CONFLICT");
    }
    combined.set(id,row);
   }
   maps.set(kind,combined);current.set(kind,incoming);
  }
  const visiting = new Set<string>(), approved = new Set<string>();
  function lookup(kind: RelationshipResource,id: unknown): Row {
   if (typeof id !== "string") reject("FINANCE_OWNERSHIP_INVALID");
   const row = maps.get(kind)?.get(id);
   if (!row) reject("FINANCE_OWNERSHIP_MISSING");
   check(kind,row);return row;
  }
  function check(kind: RelationshipResource,row: Row): void {
   const tag = kind+":"+key(kind,row);
   if (approved.has(tag)) return;
   if (visiting.has(tag)) reject("FINANCE_OWNERSHIP_INVALID");
   visiting.add(tag);
   if (["subscriptions","invoices","payments","attempts","activity"].includes(kind)) {
    reference(row.stripe_customer_id,"cus");
    if (row.stripe_customer_id !== partition.customer) reject("FINANCE_OWNERSHIP_CONFLICT");
   }
   if (kind === "items") lookup("subscriptions",reference(row.stripe_subscription_id,"sub"));
   if (kind === "invoices" && row.stripe_subscription_id != null) lookup("subscriptions",reference(row.stripe_subscription_id,"sub"));
   if (kind === "payments" && row.stripe_payment_intent_id != null) reference(row.stripe_payment_intent_id,"pi");
   if (kind === "refunds") {
    const payment = lookup("payments",reference(row.stripe_charge_id,"ch"));
    if (row.stripe_payment_intent_id != null && reference(row.stripe_payment_intent_id,"pi") !== payment.stripe_payment_intent_id) reject("FINANCE_OWNERSHIP_CONFLICT");
   }
   if (kind === "allocations") {
    lookup("invoices",reference(row.stripe_invoice_id,"in"));
    if (row.stripe_charge_id != null) {
     const payment = lookup("payments",reference(row.stripe_charge_id,"ch"));
     if (row.stripe_payment_intent_id != null && reference(row.stripe_payment_intent_id,"pi") !== payment.stripe_payment_intent_id) reject("FINANCE_OWNERSHIP_CONFLICT");
    } else if (row.stripe_payment_intent_id != null) {
     const pi = reference(row.stripe_payment_intent_id,"pi");
     const payments = [...maps.get("payments")!.values()].filter(p=>p.stripe_payment_intent_id === pi);
     if (payments.length !== 1) reject("FINANCE_OWNERSHIP_MISSING");
     check("payments",payments[0]);
    } else reject("FINANCE_OWNERSHIP_MISSING");
   }
   if (kind === "attempts") {
    const payment = lookup("payments",reference(row.stripe_charge_id,"ch"));
    if (row.stripe_payment_intent_id != null && row.stripe_payment_intent_id !== payment.stripe_payment_intent_id) reject("FINANCE_OWNERSHIP_CONFLICT");
    if (row.stripe_invoice_id != null) lookup("invoices",reference(row.stripe_invoice_id,"in"));
   }
   if (kind === "activity") {
    const sourceKind = row.object_type === "attempt" ? "attempts" : row.object_type;
    if (!["subscriptions","invoices","refunds","attempts"].includes(String(sourceKind))) reject("FINANCE_OWNERSHIP_INVALID");
    const source = lookup(sourceKind as RelationshipResource,row.object_id);
    if (row.stripe_subscription_id != null) {
     lookup("subscriptions",reference(row.stripe_subscription_id,"sub"));
     if (sourceKind === "subscriptions" && row.stripe_subscription_id !== source.stripe_object_id) reject("FINANCE_OWNERSHIP_CONFLICT");
     if (source.stripe_subscription_id != null && source.stripe_subscription_id !== row.stripe_subscription_id) reject("FINANCE_OWNERSHIP_CONFLICT");
    }
   }
   visiting.delete(tag);approved.add(tag);
  }
  for (const kind of resources) for (const row of current.get(kind)!.values()) check(kind,row);
  return {valid:true};
 } catch (error) {return {valid:false,code:error instanceof OwnershipFailure ? error.code : "FINANCE_OWNERSHIP_INVALID"};}
}
export function validateFinanceBundleOwnership(partition: Partition,bundle: Bundle,stored: StoredOwnership = {}): OwnershipResult {
 try {
  const rows: StoredOwnership = {};
  for (const kind of resources) {
   const entries = bundle[kind];
   if (!Array.isArray(entries) || entries.length > 200) reject("FINANCE_OWNERSHIP_INVALID");
   rows[kind] = entries.map(entry=>record(record(entry).row));
  }
  return validateRows(partition,rows,stored);
 } catch {return {valid:false,code:"FINANCE_OWNERSHIP_INVALID"};}
}
export function validateFinanceGraphOwnership(partition: Partition,graph: Graph,stored: StoredOwnership = {}): OwnershipResult {
 try {
  if (!validPartition(partition) || graph.complete !== true) reject("FINANCE_OWNERSHIP_INVALID");
  const rows: Record<RelationshipResource,Row[]> = {subscriptions:[],items:[],invoices:[],payments:[],refunds:[],allocations:[],attempts:[],activity:[]};
  const kinds = {subscriptions:"subscriptions",invoices:"invoices",charges:"payments",refunds:"refunds",allocations:"allocations"} as const;
  for (const name of ["customers",...Object.keys(kinds)] as ("customers" | keyof typeof kinds)[]) {
   const entries = graph[name];
   if (!Array.isArray(entries) || entries.length > 200) reject("FINANCE_OWNERSHIP_INVALID");
   const seen = new Set<string>();
   for (const value of entries) {
    const raw = record(value);
    if (raw.livemode !== partition.scope.endsWith(":live")) reject("FINANCE_OWNERSHIP_CONFLICT");
    if (typeof raw.id !== "string" || seen.has(raw.id)) reject("FINANCE_OWNERSHIP_DUPLICATE");
    seen.add(raw.id);
    if (name === "customers") {
     reference(raw.id,"cus");
     if (raw.id !== partition.customer || raw.deleted === true) reject("FINANCE_OWNERSHIP_CONFLICT");
     continue;
    }
    const kind = kinds[name as keyof typeof kinds];
    const row: Row = {stripe_scope:partition.scope,stripe_object_id:raw.id};
    if (["subscriptions","invoices","charges"].includes(name)) row.stripe_customer_id = objectId(raw.customer);
    if (name === "subscriptions") {
     const items = record(raw.items);
     if (!Array.isArray(items.data) || items.data.length > 200 || items.has_more !== false) reject("FINANCE_OWNERSHIP_INVALID");
     for (const item of items.data) {
      const data = record(item);
      if (data.subscription != null && objectId(data.subscription) !== raw.id) reject("FINANCE_OWNERSHIP_CONFLICT");
      if (data.livemode != null && data.livemode !== raw.livemode) reject("FINANCE_OWNERSHIP_CONFLICT");
      rows.items.push({stripe_scope:partition.scope,stripe_object_id:data.id,stripe_subscription_id:raw.id});
     }
    }
    if (name === "invoices") {
     const legacy = objectId(raw.subscription);
     const parent = raw.parent == null ? undefined : record(raw.parent);
     const details = parent?.subscription_details == null ? undefined : record(parent.subscription_details);
     const modern = objectId(details?.subscription);
     if (legacy != null && modern != null && legacy !== modern) reject("FINANCE_OWNERSHIP_CONFLICT");
     row.stripe_subscription_id = modern ?? legacy ?? null;
    }
    if (name === "charges" || name === "refunds") row.stripe_payment_intent_id = objectId(raw.payment_intent) ?? null;
    if (name === "refunds") row.stripe_charge_id = objectId(raw.charge);
    if (name === "allocations") {
     row.stripe_invoice_id = objectId(raw.invoice);
     const payment = record(raw.payment);
     if (payment.type === "charge") row.stripe_charge_id = objectId(payment.charge);
     else if (payment.type === "payment_intent") row.stripe_payment_intent_id = objectId(payment.payment_intent);
     else reject("FINANCE_OWNERSHIP_MISSING");
    }
    rows[kind].push(row);
   }
  }
  if (graph.customers.length !== 1) reject("FINANCE_OWNERSHIP_MISSING");
  return validateRows(partition,rows,stored);
 } catch (error) {return {valid:false,code:error instanceof OwnershipFailure ? error.code : "FINANCE_OWNERSHIP_INVALID"};}
}
