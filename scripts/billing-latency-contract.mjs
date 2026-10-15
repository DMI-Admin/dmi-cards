import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
// Only these exact reviewed activation latency changes; no authority exemption.
const reviewed={
  "src/app/api/v1/billing/activation/route.ts": "ded02cd5985c595347e76428c588f91ac4bd9bc3426868f6675ecfaf8401f10f",
  "src/lib/billing-activation-poller.ts": "3d565a5e06a832c9a8a6cb1b6bbf36feac577b2ae884ce32b578a97f4f5f2123"
};
export const billingLatencyReviewedPaths=Object.keys(reviewed);
export function assertBillingLatencyFiles(read=fs.readFileSync){
 for(const [file,digest] of Object.entries(reviewed))assert.equal(createHash('sha256').update(read(file,'utf8')).digest('hex'),digest,'Unexpected activation latency change: '+file);
}
