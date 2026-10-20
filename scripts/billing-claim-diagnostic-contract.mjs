// Exact local claim-observability contract; rejects all other migration drift.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const reviewed={"src/lib/stripe/billing-work-claim-diagnostics.ts": "2cb99d1043ac98fd49850258943866be0a5b52a811f146608d1082a9611cf927", "supabase/migrations/20261019000000_billing_entitlement_claim_diagnostics.sql": "f1c23f96074c55f6bf557919d9599e4329cecc1d286e0d605deddda2ad2ec732"};
export const claimDiagnosticReviewedPaths=Object.keys(reviewed);
export const claimDiagnosticMigration='supabase/migrations/20261019000000_billing_entitlement_claim_diagnostics.sql';
export function assertClaimDiagnosticFiles(read=fs.readFileSync){for(const [file,digest] of Object.entries(reviewed))assert.equal(createHash('sha256').update(read(file)).digest('hex'),digest,'Unexpected claim diagnostic drift: '+file);}
export function claimDiagnosticGitDiff(args,options){assertClaimDiagnosticFiles();return execFileSync('git',[...args,':(exclude)'+claimDiagnosticMigration],options);}
export function assertClaimDiagnosticMigrationChanges(paths){assertClaimDiagnosticFiles();assert.ok(paths.every(p=>p===claimDiagnosticMigration),'Unexpected claim diagnostic migration change');}
