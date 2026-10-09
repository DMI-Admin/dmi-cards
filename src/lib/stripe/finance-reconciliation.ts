import "server-only";
import {randomUUID} from "node:crypto";
import {withFinanceLease,prepareFinanceSync} from "./finance-sync";
import {emptyBundle,type Runtime,type ScanResource,type Resource} from "./finance-contract";

import {requireLegacyFinanceProtocol} from "./finance-reconciliation-guard";

const kinds:ScanResource[]=["recent_invoices","open_invoices","recent_failures","pending_refunds","active_subscriptions"];
export function recentFinanceWindow(now:string,days=35) {
 if(!Number.isInteger(days)||days<1||days>400||!Number.isFinite(Date.parse(now)))throw Error("FINANCE_WINDOW");
 return {start:new Date(Date.parse(now)-days*86400000).toISOString(),end:new Date(now).toISOString()};
}
export async function startFinanceRun(r:Runtime,input:{mode:"backfill"|"reconcile";resource:ScanResource;start:string;end:string;actor:string;id?:string}) {
 if(!kinds.includes(input.resource)||!["backfill","reconcile"].includes(input.mode)||!input.actor||!Number.isFinite(Date.parse(input.start))||!Number.isFinite(Date.parse(input.end))||Date.parse(input.start)>=Date.parse(input.end))throw Error("FINANCE_RUN_INPUT");
 const epoch=await requireLegacyFinanceProtocol(r);
 return withFinanceLease(r,lease=>r.store.command<{id:string}>("run_start",r.scope,lease.token,{...input,id:input.id||randomUUID(),expected_protocol_epoch:epoch}));
}
/** One resumable batch only. No scheduler, route, or authenticated call is installed. */
export async function resumeFinanceRun(r:Runtime,id:string) {
 const epoch=await requireLegacyFinanceProtocol(r);
 return withFinanceLease(r,async lease=>{
  const run=await r.store.run(r.scope,id);if(!run)throw Error("FINANCE_RUN_MISSING");
  if(run.protocol_epoch!==epoch)throw Error("FINANCE_RECONCILIATION_EPOCH");
  if(run.status==="failed")throw Error("FINANCE_RECONCILIATION_RUN_BLOCKED");
  if(run.status!=="completed"&&run.status!=="running"&&run.status!=="partial")throw Error("FINANCE_RECONCILIATION_RUN_BLOCKED");
  if(run.status==="completed")return {done:true,complete:run.coverage_quality==="complete"};
  const identity=await r.source.identity();if(identity.scope!==r.scope||identity.apiVersion!==r.apiVersion)throw Error("FINANCE_RUNTIME_CHANGED");
  const cursor=run.cursor as {after?:string};
  const page=await r.source.scan({resource:run.resource_type as ScanResource,start:String(run.window_start),end:String(run.window_end),after:cursor.after});
  if(page.roots.length>20||(page.next&&page.next===cursor.after))throw Error("FINANCE_BATCH_BOUND");
  const bundle=emptyBundle();let complete=page.complete;
  for(const root of page.roots){
   try{
    const prepared=await prepareFinanceSync(r,root,undefined,run.mode==="backfill"?"backfill":"reconciliation");complete&&=prepared.complete;
    for(const key of Object.keys(bundle) as Resource[]){
     // Overlapping roots refresh the same object once within this transaction.
     const byId=new Map(bundle[key].map(x=>{const row=x.row as unknown as Record<string,unknown>;return [String(row.stripe_object_id??row.attempt_key??row.activity_key),x];}));
     for(const item of prepared.bundle[key]){const row=item.row as unknown as Record<string,unknown>;byId.set(String(row.stripe_object_id??row.attempt_key??row.activity_key),item);}
     (bundle[key] as unknown[])= [...byId.values()];
    }
   }catch(error){if(error instanceof Error&&error.message==="FINANCE_FOREIGN_APPLICATION")continue;throw error;}
  }
  const done=page.next===null;
  await r.store.command("commit",r.scope,lease.token,{expected_scope_revision:lease.revision,expected_protocol_epoch:epoch,...bundle,run:{id,expected_cursor:cursor,cursor:page.next?{after:page.next}:{},processed:page.roots.length,done,complete}});
  return {done,complete:done&&complete&&Number(run.error_count)===0};
 });
}
