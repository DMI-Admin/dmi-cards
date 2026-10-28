// Exact local claim-observability contract; rejects all other migration drift.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const reviewed={"src/lib/stripe/billing-work-claim-diagnostics.ts": "2cb99d1043ac98fd49850258943866be0a5b52a811f146608d1082a9611cf927", "supabase/migrations/20261019000000_billing_entitlement_claim_diagnostics.sql": "f1c23f96074c55f6bf557919d9599e4329cecc1d286e0d605deddda2ad2ec732"};
export const claimDiagnosticReviewedPaths=Object.keys(reviewed);
export const claimDiagnosticMigration='supabase/migrations/20261019000000_billing_entitlement_claim_diagnostics.sql';
export function assertClaimDiagnosticFiles(read=fs.readFileSync){for(const [file,digest] of Object.entries(reviewed))assert.equal(createHash('sha256').update(read(file)).digest('hex'),digest,'Unexpected claim diagnostic drift: '+file);}
export function claimDiagnosticGitDiff(args,options){assertClaimDiagnosticFiles();assertIsolatedV2Migrations();return execFileSync('git',[...args,':(exclude)'+claimDiagnosticMigration,...Object.keys(isolatedV2MigrationPins).map(f=>':(exclude)'+f)],options);}
export const isolatedV2MigrationPins={"supabase/migrations/20261027000100_billing_v2_shadow_schema.sql": "081620bcf9cdd8481c24232805db633bcf50ee3295be66add117535727b9ff73", "supabase/migrations/20261027000200_billing_v2_task_transactions.sql": "281f168c91b95f1dd81478b21aa56459052a1577cb41fd2728c83528072480b6", "supabase/migrations/20261027000300_billing_v2_shadow_operations.sql": "cfe2f314004996bda68988d528b088e9dc6af1f6696303e2bdea381139679970", "supabase/migrations/20261028000100_billing_v2_shadow_foundation.sql": "60dce697f7ecec0e621435b2112e7dd57a86732d450efbd06ca1671bc75f7eee"};
export function assertIsolatedV2Migrations(read=fs.readFileSync){for(const [file,digest]of Object.entries(isolatedV2MigrationPins))assert.equal(createHash('sha256').update(read(file)).digest('hex'),digest,'Unexpected isolated V2 migration drift: '+file);}
export function assertClaimDiagnosticMigrationChanges(paths){assertClaimDiagnosticFiles();assertIsolatedV2Migrations();assert.ok(paths.every(p=>p===claimDiagnosticMigration||Object.hasOwn(isolatedV2MigrationPins,p)),'Unexpected claim diagnostic migration change');}
