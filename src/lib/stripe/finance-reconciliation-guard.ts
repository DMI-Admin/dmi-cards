import "server-only";
import type {Runtime} from "./finance-contract";
/** Read database authority before any provider work; SQL rechecks at commit. */
export async function requireLegacyFinanceProtocol(r:Runtime):Promise<number> {
 const state=await r.store.command<{mode:unknown;epoch:unknown}>("read_protocol",r.scope,null);
 if(!state||state.mode!=="legacy")throw Error("FINANCE_RECONCILIATION_BLOCKED");
 if(typeof state.epoch!=="number"||!Number.isSafeInteger(state.epoch)||state.epoch<0)throw Error("FINANCE_RECONCILIATION_EPOCH");
 return state.epoch;
}
