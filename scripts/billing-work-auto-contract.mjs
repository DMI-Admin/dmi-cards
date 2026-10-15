// Exact reviewed automatic foundation bytes; no migration or general import exceptions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const reviewed={
  "src/lib/stripe/webhook-mode-guard.ts": "d67f63c7f85c183fb44a979103c25b69da521748c1a1b4021009d298c9d64f7f",
  "src/app/api/internal/billing-work-auto/route.ts": "68945d9d0a948a2f21b54a3384a8283d1b393b6a077ae3e92d47d0fd974cbcdb",
  "src/app/api/stripe/webhook/route.ts": "3d55d30d76d8fcc79fab5875e1f1824fe38be22200fdce9a25a4c6b6cafd5889",
  "src/lib/stripe/billing-work-auto-config.ts": "f1bb439ddbddc7aaa60df62fdaefd2a8bcaec6917396bc135188055feffc73ac",
  "src/lib/stripe/billing-work-auto-execution.ts": "7a9a91d717663def2aa001fbc9855e0d1ddab6d69af9f397714768ca409cd565",
  "src/lib/stripe/billing-work-auto-kick.ts": "8b1f2b36c71a85df46d320593c70b773256a27cb23a96cbf3c8da47ed8c54f1c",
  "src/lib/stripe/billing-work-auto-request.ts": "268b65a5aed599af053d0cc6d74e3fd5c271868e1132dd52dcad4f936768a40e",
  "src/lib/stripe/billing-work-auto-runner.ts": "fe4533550877110a29de1a256ec90d169be76b0920e21fa87fe605111c0ad7e1",
  "src/lib/stripe/billing-work-handoff.ts": "fcc5a8b566ce0b5ca96681cbc553584586d28d5215975524253ff5665059abbb",
  "src/middleware.ts": "c5a24b13f0877ba8e38d90e722869b86bf63ed5ddb4341d5589569d8c9026b0e",
  "src/lib/stripe/billing-latency-diagnostics.ts": "e41d1964da1d1c978d6ca42855928a9e0fc845c4f52d269472a0aca458692e7a"
};
export const automaticWorkerReviewedPaths=Object.keys(reviewed);
export function assertAutomaticWorkerFiles(){for(const [file,digest] of Object.entries(reviewed))assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),digest,'Unexpected automatic worker drift: '+file);}
export function stripAutomaticWebhook(source){
 assertAutomaticWorkerFiles();
 return source.replace('import {stripeWebhookModeDecision} from "@/lib/stripe/webhook-mode-guard";\n','').replace(/    const modeDecision = stripeWebhookModeDecision\(event.livemode\);[\s\S]*?(?=    const handoffConfig)/,'').replace('import {after} from "next/server";\n','').replace('import {registerAutomaticBillingKick} from "@/lib/stripe/billing-work-auto-kick";\n','').replace('export const maxDuration = 90;\n','')
 .replace('let confirmedAdmissions = 0;\n      const handoff = await handoffBillingWork(event as unknown as VerifiedWorkEvent, handoffConfig, createSupabaseAdminClient, count => { confirmedAdmissions = count; });\n      registerAutomaticBillingKick(after, confirmedAdmissions, invocationStartedAt);','const handoff = await handoffBillingWork(event as unknown as VerifiedWorkEvent, handoffConfig, createSupabaseAdminClient);');
}
