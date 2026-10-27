import {V2StoreFailure} from "../domain/types";
import type {Persistence,Fence,Category,CommitResult,SubscriptionDecision,FinanceDecision,RecordValue} from "../domain/types";
export interface LocalConnection {query(sql:string,values?:unknown[]):Promise<{rows:Record<string,unknown>[]}>}
/** An already restricted disposable connection, never a Supabase/environment client. */
export class V2Store implements Persistence {
 constructor(private readonly db:LocalConnection){}
 private async call(name:string,values:unknown[]):Promise<CommitResult>{const allowed=["bind_customer","acquire_authority","complete_subscription","complete_finance","wait_retry","wait_dependency","mark_attention","claim","admit","touch","release","read_result","diagnose"];if(!allowed.includes(name))throw Error("V2_RPC_NOT_ALLOWED");const args=values.map((_,i)=>"$"+(i+1)).join(",");try{const result=await this.db.query("SELECT billing_v2."+name+"("+args+") AS result",values);return result.rows[0].result as CommitResult;}catch(error){const e=error as {code?:string;message?:string};if(e.message==="V2_FENCED")throw new V2StoreFailure("store_unavailable",false,true);if(!e.code||!/^[0-9A-Z]{5}$/.test(e.code))throw new V2StoreFailure("store_unavailable",true);const code=e.message||"";throw new V2StoreFailure(code==="V2_OWNERSHIP"?"ownership_conflict":/^V2_(PROOF|ALLOCATION|CHARGE|PRICE|SUBSCRIPTION|ACTIVITY)/.test(code)?"dependency_unresolved":e.code.startsWith("23")?"invalid_evidence":"store_unavailable");}}
 completeSubscription(fence:Fence,decision:Extract<SubscriptionDecision,{kind:"commit"|"no_change"}>){return this.call("complete_subscription",[fence,decision.expectedRevision,decision]);}
 completeFinance(fence:Fence,decision:Extract<FinanceDecision,{kind:"commit"}>){return this.call("complete_finance",[fence,{},decision]);}
 defer(fence:Fence,category:Category,dependency?:{kind:string;reference:string}){return dependency?this.call("wait_dependency",[fence,dependency,"0"]):this.call(["ownership_conflict","unknown_price","invalid_evidence"].includes(category)?"mark_attention":"wait_retry",[fence,category,...(["ownership_conflict","unknown_price","invalid_evidence"].includes(category)?[]:[null])]);}
 admit(scope:string,sourceKind:string,sourceId:string,evidence:RecordValue){return this.call("admit",[scope,sourceKind,sourceId,evidence]);}
 claim(scope:string,kind:"access"|"finance"){return this.call("claim",[scope,kind]);}
 bindCustomer(fence:Fence,principal:string,customer:string,expectedRevision:string,verification:RecordValue){return this.call("bind_customer",[fence,"individual",principal,customer,expectedRevision,verification]);}
 acquireAuthority(scope:string,domain:"access"|"finance",account:string,task:string,token:string,generation:string){return this.call("acquire_authority",[scope,domain,account,"task",task,token,generation]);}
 touch(fence:Fence){return this.call("touch",[fence]);}
 release(fence:Fence,reason:string){return this.call("release",[fence,reason]);}
 readResult(scope:string,taskId:string){return this.call("read_result",[scope,taskId]);}
 diagnose(scope:string,kind:"access"|"finance"){return this.call("diagnose",[scope,kind]);}
}
