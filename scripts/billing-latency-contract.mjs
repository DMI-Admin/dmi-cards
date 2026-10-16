import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
// Only these exact reviewed activation latency changes; no authority exemption.
const reviewed={
  "src/app/api/v1/billing/activation/route.ts": "ded02cd5985c595347e76428c588f91ac4bd9bc3426868f6675ecfaf8401f10f",
  "src/lib/billing-activation-poller.ts": "0c2942424923cbef55f8c5afe316008f2a9a37a4e7fa681f51d4bd69d3b8a1eb",
  "src/app/client/billing/activating/page.tsx": "7011f9de59309d04a8fc6d5c1cdc5cc04d9985e1a03b7fd0f902375a936b453d"
};
export const billingLatencyReviewedPaths=Object.keys(reviewed);
export function assertBillingLatencyFiles(read=fs.readFileSync){
 for(const [file,digest] of Object.entries(reviewed))assert.equal(createHash('sha256').update(read(file,'utf8')).digest('hex'),digest,'Unexpected activation latency change: '+file);
}
