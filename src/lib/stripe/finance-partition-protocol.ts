import "server-only";

/** UNUSED specification. Authority/drain evidence must eventually be enforced in SQL.
 * No clock, token generation, I/O, locks or logs: all evidence is invocation input.
 */
export type ProtocolMode = "legacy" | "draining_to_customer" | "customer" | "draining_to_legacy";
export type ProtocolState = {mode: ProtocolMode; epoch: number};
export type Partition = {scope: string; customer: string};
export type Writer = "legacy" | "customer";
export type LeaseKind = "legacy_scope" | "customer" | "coordinator";
export type Claim = {writer: Writer; kind: LeaseKind; scope: string; customer?: string; epoch: number};
export type Lease = Claim & {token: string; revision: string; expiresAt: number};
export type DrainEvidence = {exclusiveAuthority: boolean; activeLegacyLeases: number;
 incompatibleLegacyWork: number; activeCustomerLeases: number; incompatibleCustomerWork: number};
export type ProtocolFailureCode = "PROTOCOL_INVALID" | "PROTOCOL_AUTHORITY_REQUIRED" | "PROTOCOL_DRAIN_REQUIRED" |
 "PROTOCOL_EPOCH_STALE" | "PROTOCOL_CLAIM_BLOCKED" | "PROTOCOL_FENCE" | "PROTOCOL_PARTITION_MISMATCH" |
 "PROTOCOL_RECEIPT_CONFLICT" | "PROTOCOL_RECEIPT_TERMINAL" | "PROTOCOL_WORK_CONFLICT";
export class ProtocolFailure extends Error {
 constructor(readonly code: ProtocolFailureCode) {super(code);}
}
function fail(code: ProtocolFailureCode): never {throw new ProtocolFailure(code);}
function count(value: number): boolean {return Number.isSafeInteger(value) && value >= 0;}
function text(value: unknown): value is string {return typeof value === "string" && /^[A-Za-z0-9_:.-]{1,128}$/.test(value);}
function scope(value: string): boolean {return typeof value === "string" && /^acct_[A-Za-z0-9]+:(test|live)$/.test(value) && value.length <= 255;}
function customer(value: unknown): value is string {return typeof value === "string" && /^cus_[A-Za-z0-9]{1,240}$/.test(value);}
function revision(value: string): boolean {return typeof value === "string" && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= BigInt("9223372036854775807");}
function stateValid(state: ProtocolState): void {
 if (!["legacy","draining_to_customer","customer","draining_to_legacy"].includes(state.mode) || !count(state.epoch)) fail("PROTOCOL_INVALID");
}
function epoch(state: ProtocolState, expected: number): void {
 stateValid(state);
 if (!count(expected) || expected !== state.epoch) fail("PROTOCOL_EPOCH_STALE");
}
function claimShape(claim: Claim): void {
 if (!["legacy","customer"].includes(claim.writer) || !["legacy_scope","customer","coordinator"].includes(claim.kind) || !scope(claim.scope)) fail("PROTOCOL_INVALID");
 if (claim.kind === "customer") {
  if (claim.writer !== "customer" || !customer(claim.customer)) fail("PROTOCOL_INVALID");
 } else if (claim.customer !== undefined || (claim.kind === "legacy_scope" && claim.writer !== "legacy")) fail("PROTOCOL_INVALID");
}
export function transitionProtocol(state: ProtocolState, expectedEpoch: number, target: ProtocolMode, evidence: DrainEvidence): ProtocolState {
 epoch(state,expectedEpoch);
 if (evidence.exclusiveAuthority !== true) fail("PROTOCOL_AUTHORITY_REQUIRED");
 if (![evidence.activeLegacyLeases,evidence.incompatibleLegacyWork,evidence.activeCustomerLeases,evidence.incompatibleCustomerWork].every(count)) fail("PROTOCOL_INVALID");
 const start = (state.mode === "legacy" && target === "draining_to_customer") || (state.mode === "customer" && target === "draining_to_legacy");
 if (start) return {mode:target,epoch:state.epoch}; // Same epoch permits existing fenced work to drain.
 const activateCustomer = state.mode === "draining_to_customer" && target === "customer";
 const activateLegacy = state.mode === "draining_to_legacy" && target === "legacy";
 if (!activateCustomer && !activateLegacy) fail("PROTOCOL_INVALID");
 if (activateCustomer ? evidence.activeLegacyLeases > 0 || evidence.incompatibleLegacyWork > 0 :
  evidence.activeCustomerLeases > 0 || evidence.incompatibleCustomerWork > 0) fail("PROTOCOL_DRAIN_REQUIRED");
 if (!count(state.epoch+1)) fail("PROTOCOL_INVALID");
 return {mode:target,epoch:state.epoch+1};
}
export function assertClaimEligible(state: ProtocolState, claim: Claim): void {
 epoch(state,claim.epoch);claimShape(claim);
 if (state.mode !== claim.writer) fail("PROTOCOL_CLAIM_BLOCKED");
}
export type Fence = Claim & {token: string; expectedRevision: string};
export function assertFence(state: ProtocolState, lease: Lease, request: Fence, now: number): void {
 epoch(state,request.epoch);epoch(state,lease.epoch);claimShape(lease);claimShape(request);
 const permitsCompletion = state.mode === lease.writer ||
  (lease.writer === "legacy" && state.mode === "draining_to_customer") ||
  (lease.writer === "customer" && state.mode === "draining_to_legacy");
 if (!permitsCompletion) fail("PROTOCOL_CLAIM_BLOCKED");
 if (lease.writer !== request.writer || lease.kind !== request.kind || lease.scope !== request.scope || lease.customer !== request.customer) fail("PROTOCOL_PARTITION_MISMATCH");
 if (!text(lease.token) || !text(request.token) || lease.token !== request.token ||
  !revision(lease.revision) || !revision(request.expectedRevision) || lease.revision !== request.expectedRevision ||
  !Number.isFinite(now) || now < 0 || !Number.isFinite(lease.expiresAt) || now >= lease.expiresAt) fail("PROTOCOL_FENCE");
}
/** Pure additional ownership boundary; a future SQL writer must prove every supplied owner. */
export function assertPartitionOwners(partition: Partition, owners: readonly Partition[]): void {
 if (!scope(partition.scope) || !customer(partition.customer) || !Array.isArray(owners) || owners.length > 1600) fail("PROTOCOL_INVALID");
 for (const owner of owners) if (owner.scope !== partition.scope || owner.customer !== partition.customer) fail("PROTOCOL_PARTITION_MISMATCH");
}
export type Receipt = {scope: string; consumer: "finance_v1"; event: string; customer?: string;
 status: "received" | "processing" | "failed" | "processed" | "ignored"; token?: string; expiresAt?: number};
function receiptActive(receipt: Receipt, token: string, now: number): void {
 if (!scope(receipt.scope) || receipt.consumer !== "finance_v1" || !/^evt_[A-Za-z0-9]{1,240}$/.test(receipt.event) ||
  !["received","processing","failed","processed","ignored"].includes(receipt.status) ||
  (receipt.customer !== undefined && !customer(receipt.customer))) fail("PROTOCOL_INVALID");
 if (["processed","ignored"].includes(receipt.status)) fail("PROTOCOL_RECEIPT_TERMINAL");
 if (receipt.status !== "processing" || !text(token) || token !== receipt.token || !Number.isFinite(now) || now < 0 ||
  !Number.isFinite(receipt.expiresAt) || now >= receipt.expiresAt!) fail("PROTOCOL_FENCE");
}
export function bindReceipt(receipt: Receipt, token: string, partition: Partition, now: number): Receipt {
 receiptActive(receipt,token,now);assertPartitionOwners(partition,[]);
 if (receipt.scope !== partition.scope || (receipt.customer !== undefined && receipt.customer !== partition.customer)) fail("PROTOCOL_RECEIPT_CONFLICT");
 return {...receipt,customer:partition.customer};
}
export function completeReceipt(state: ProtocolState, receipt: Receipt, receiptToken: string, lease: Lease, fence: Fence,
 event: string, now: number): Receipt {
 assertFence(state,lease,fence,now);receiptActive(receipt,receiptToken,now);
 if (lease.kind === "coordinator") fail("PROTOCOL_RECEIPT_CONFLICT");
 if (event !== receipt.event || lease.scope !== receipt.scope ||
  (lease.kind === "customer" && receipt.customer !== lease.customer)) fail("PROTOCOL_RECEIPT_CONFLICT");
 return {...receipt,status:"processed",token:undefined,expiresAt:undefined};
}
export function completeIgnoredReceipt(state: ProtocolState, expectedEpoch: number, receipt: Receipt, token: string,
 action: "unsupported_event" | "foreign_application", financialWrites: number, now: number): Receipt {
 epoch(state,expectedEpoch);receiptActive(receipt,token,now);
 if (!["unsupported_event","foreign_application"].includes(action) || financialWrites !== 0) fail("PROTOCOL_RECEIPT_CONFLICT");
 return {...receipt,status:"ignored",token:undefined,expiresAt:undefined};
}
export type ReconciliationUnit = {run: string; page: string; unit: string; partition: Partition; epoch: number;
 status: "pending" | "processing" | "completed" | "retryable"; token?: string; revision?: string};
export function beginReconciliationUnit(state: ProtocolState, unit: ReconciliationUnit, lease: Lease, fence: Fence, now: number): ReconciliationUnit {
 if (![unit.run,unit.page,unit.unit].every(text) || !["pending","retryable"].includes(unit.status)) fail("PROTOCOL_WORK_CONFLICT");
 epoch(state,unit.epoch);assertClaimEligible(state,lease);assertFence(state,lease,fence,now);
 if (lease.kind !== "customer") fail("PROTOCOL_WORK_CONFLICT");
 assertPartitionOwners(unit.partition,[{scope:lease.scope,customer:lease.customer!}]);
 return {...unit,status:"processing",token:lease.token,revision:lease.revision};
}
export function finishReconciliationUnit(state: ProtocolState, unit: ReconciliationUnit, lease: Lease, fence: Fence,
 outcome: "completed" | "retryable", now: number): ReconciliationUnit {
 if (![unit.run,unit.page,unit.unit].every(text)) fail("PROTOCOL_WORK_CONFLICT");
 epoch(state,unit.epoch);assertFence(state,lease,fence,now);
 if (lease.kind !== "customer" || unit.status !== "processing" || unit.token !== lease.token || unit.revision !== lease.revision ||
  !["completed","retryable"].includes(outcome)) fail("PROTOCOL_WORK_CONFLICT");
 assertPartitionOwners(unit.partition,[{scope:lease.scope,customer:lease.customer!}]);
 return {...unit,status:outcome,token:undefined,revision:undefined};
}
