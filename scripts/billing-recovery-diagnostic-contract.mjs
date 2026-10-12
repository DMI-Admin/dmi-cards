// Exact reviewed recovery diagnostic changes only. Any other runtime drift fails.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const reviewed={
 'src/app/api/internal/billing-work/route.ts': 'fb89dd0a7debd692f5f31dda5980b6a7b7a20ab8f3abfeb87c424b537b2e8fff',
 'src/lib/stripe/billing-work-runtime.ts': 'b83032dce9a92f26fdb7ebeb5d2cd74007dc824f494c30e2626d94d2ea05a4d1',
 'src/lib/stripe/billing-work-worker.ts': 'ef565180d6946c9772239190a2a413c730ec080f89ee90c30f6ab3b48a8ad4c0',
 'src/lib/stripe/reliability.ts': 'be37bed6b5a379ba1ca70b6ed335f1fc79577ea88274f07691e58e93c1922c9c',
 'src/lib/stripe/webhook.ts': '143fbeb7f69cadb10fb312c0df30b13ee195c85723557fcf5def8b4801816f8c',
 'src/lib/stripe/billing-recovery-entitlement-diagnostics.ts': 'bb95c4157e91384147560d03f4223a8c3639c05e7b7b5d57f8f9add77041f026',
};
export function assertRecoveryDiagnosticFiles(){
 for(const [file,digest] of Object.entries(reviewed))assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),digest,'Unexpected recovery diagnostic runtime drift: '+file);
}
export function recoveryDiagnosticGitDiff(args,options){
 assertRecoveryDiagnosticFiles();
 const command=args.includes('--')?args:[...args,'--'];
 return execFileSync('git',[...command,...Object.keys(reviewed).map(file=>':(exclude)'+file)],options);
}
export function assertUnchangedExceptRecoveryDiagnostics(file){
 if(Object.hasOwn(reviewed,file)){assertRecoveryDiagnosticFiles();return;}
 assert.equal(fs.readFileSync(file,'utf8'),execFileSync('git',['show','HEAD:'+file],{encoding:'utf8'}));
}
export function stripRecoveryDiagnosticRoute(source){
 return source.replace('import {createRecoveryEntitlementDiagnostics} from "@/lib/stripe/billing-recovery-entitlement-diagnostics";\n','')
 .replace('  const baseWorker=proofs?{...config.worker,proofs}:config.worker;\n  const entitlementDiagnostics=createRecoveryEntitlementDiagnostics(process.env);\n  const worker=entitlementDiagnostics?{...baseWorker,entitlementDiagnostics}:baseWorker;','  const worker=proofs?{...config.worker,proofs}:config.worker;');
}
