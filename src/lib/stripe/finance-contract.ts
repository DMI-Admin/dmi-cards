import "server-only";
import type {LeaseRetryPolicy} from "./lease-acquisition-timing";
import type {Observer} from "./webhook-observer";
import type { FinanceActivity, FinanceInvoice, FinanceItem, FinancePayment, FinanceRefund, FinanceSubscription, InvoicePayment, PaymentAttempt } from "./finance-types";

export const FINANCE_WEBHOOK_VERSION = "2023-10-16";
export const FINANCE_CONSUMER = "finance_v1";
export const FINANCE_API_VERSION = "2026-07-29.dahlia";
export const resources = {
  subscriptions:"billing_finance_subscriptions",items:"billing_finance_subscription_items",invoices:"billing_invoices",
  payments:"billing_payments",allocations:"billing_invoice_payments",attempts:"billing_payment_attempts",refunds:"billing_refunds",activity:"billing_finance_activity",
} as const;
export type Rows = { subscriptions:FinanceSubscription;items:FinanceItem;invoices:FinanceInvoice;payments:FinancePayment;allocations:InvoicePayment;attempts:PaymentAttempt;refunds:FinanceRefund;activity:FinanceActivity };
export type Resource = keyof Rows;
export type Envelope<T> = {row:T;expected_revision:string};
export type Bundle = {[K in Resource]:Envelope<Rows[K]>[]};
export type StoredRow = Record<string,unknown> & {revision?:string;stripe_scope:string};
export type Root = {kind:"subscription"|"invoice"|"allocation"|"charge"|"refund";id:string};
export type Raw = Record<string,unknown>;
export type Graph = {subscriptions:Raw[];customers:Raw[];invoices:Raw[];charges:Raw[];allocations:Raw[];refunds:Raw[];complete:boolean};
export type EventEvidence = {id:string;type:string;created:number;livemode:boolean;api_version:string;account?:string;data:{object:Raw;previous_attributes?:Raw}};
export type ScanResource = "recent_invoices"|"open_invoices"|"recent_failures"|"pending_refunds"|"active_subscriptions";
export type Scan = {resource:ScanResource;start:string;end:string;after?:string};
export interface FinanceSource {
  /** Must be read from Stripe accounts/balance, never browser input. */
  identity():Promise<{scope:string;apiVersion:string}>;
  graph(root:Root):Promise<Graph>;
  scan(input:Scan):Promise<{roots:Root[];next:string|null;complete:boolean}>;
}
export interface FinanceStore {
  command<T>(action:string,scope:string,token:string|null,input?:object):Promise<T>;
  read(resource:Resource,scope:string,id:string):Promise<StoredRow|null>;
  items(scope:string,subscription:string):Promise<StoredRow[]>;
  binding(scope:string,customer:string):Promise<{user_id:string;verified_at:string|null}|null>;
  run(scope:string,id:string):Promise<Raw|null>;
}
export type Runtime = {leaseRetry?:LeaseRetryPolicy;observer?:Observer;source:FinanceSource;store:FinanceStore;scope:string;apiVersion:string;now:()=>string};
export function emptyBundle():Bundle {return {subscriptions:[],items:[],invoices:[],payments:[],allocations:[],attempts:[],refunds:[],activity:[]};}
export function objectId(value:unknown):string {return typeof value==="string"?value:value&&typeof value==="object"&&"id" in value?String(value.id):"";}
export function record(value:unknown):Raw {if(!value||typeof value!=="object"||Array.isArray(value))throw Error("FINANCE_SHAPE");return value as Raw;}
