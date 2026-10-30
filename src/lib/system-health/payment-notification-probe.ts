import 'server-only';
import type {MonitorObservation} from './monitoring-core';
// Generic health monitoring remains. No local webhook ledger is retained.
export async function checkPaymentNotifications():Promise<MonitorObservation>{
 return {status:'unknown',severity:'info',verified:false,reasonCode:'no_safe_operational_probe',safeSummary:'Inspect webhook delivery health in Stripe. DMI Cards has no local event ledger.'};
}
