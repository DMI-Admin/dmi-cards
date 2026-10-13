import {assertAutomaticWorkerFiles,automaticWorkerReviewedPaths} from './billing-work-auto-contract.mjs';
// Exact reviewed recovery diagnostic changes only. Any other runtime drift fails.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const reviewed={
 'src/lib/stripe/billing-work-recovery.ts': '5717dd428dd378f88d9184d77dcaa24fc378048d9894829bfe9b4004eddddb53',
 'src/app/api/internal/billing-work/route.ts': '9706e8d65db0591d6ce56397925e5df0267d77b36fd09c6aebac47e32dbbcbfd',
 'src/lib/stripe/billing-work-runtime.ts': '83defcf91c2eddb15d1dafab72862b3527e0f7c6b3fab163028c8a865b9fb0bf',
 'src/lib/stripe/billing-work-worker.ts': 'ef565180d6946c9772239190a2a413c730ec080f89ee90c30f6ab3b48a8ad4c0',
 'src/lib/stripe/reliability.ts': 'be37bed6b5a379ba1ca70b6ed335f1fc79577ea88274f07691e58e93c1922c9c',
 'src/lib/stripe/webhook.ts': '143fbeb7f69cadb10fb312c0df30b13ee195c85723557fcf5def8b4801816f8c',
 'src/lib/stripe/billing-recovery-entitlement-diagnostics.ts': 'b6120676cf0114e50e61070ac023245965b0651eaf61a9c2306136d61aa8e516',
};
export function assertRecoveryDiagnosticFiles(){
 for(const [file,digest] of Object.entries(reviewed))assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),digest,'Unexpected recovery diagnostic runtime drift: '+file);
}
export function recoveryDiagnosticGitDiff(args,options){
 assertRecoveryDiagnosticFiles();
 assertAutomaticWorkerFiles();
 const command=args.includes('--')?args:[...args,'--'];
 return execFileSync('git',[...command,...[...Object.keys(reviewed),...automaticWorkerReviewedPaths].map(file=>':(exclude)'+file)],options);
}
export function assertUnchangedExceptRecoveryDiagnostics(file){
 if(automaticWorkerReviewedPaths.includes(file)){assertAutomaticWorkerFiles();return;}
 if(Object.hasOwn(reviewed,file)){assertRecoveryDiagnosticFiles();return;}
 assert.equal(fs.readFileSync(file,'utf8'),execFileSync('git',['show','HEAD:'+file],{encoding:'utf8'}));
}
export function stripRecoveryDiagnosticRoute(source){
 return source.replace(' },()=>entitlementOnlyDiagnosticEnabled(process.env));',' });').replace('import {createRecoveryEntitlementDiagnostics,entitlementOnlyDiagnosticEnabled} from "@/lib/stripe/billing-recovery-entitlement-diagnostics";\n','')
 .replace('  const baseWorker=proofs?{...config.worker,proofs}:config.worker;\n  const entitlementDiagnostics=createRecoveryEntitlementDiagnostics(process.env);\n  const worker=entitlementDiagnostics?{...baseWorker,entitlementDiagnostics}:baseWorker;','  const worker=proofs?{...config.worker,proofs}:config.worker;');
}

export function stripRecoverySelector(source){
 assertRecoveryDiagnosticFiles();
 return source.replace(' const url=new URL(request.url),parameters=[...url.searchParams.entries()];\n const entitlementOnly=parameters.length===1&&parameters[0][0]==="consumer"&&parameters[0][1]==="entitlement";\n if(url.search&&!entitlementOnly)return Response.json({error:"Parameters are not supported"},{status:400,headers});\n if(!await hasEmptyBody(request))return Response.json({error:"Parameters are not supported"},{status:400,headers});\n if(url.search){\n  let allowed=false;\n  try{allowed=entitlementOnly&&allowEntitlementOnly();}catch{/* Diagnostic permission fails closed. */}\n  if(!allowed)return Response.json({error:"Parameters are not supported"},{status:400,headers});\n }\n',' if(new URL(request.url).search||!await hasEmptyBody(request))return Response.json({error:"Parameters are not supported"},{status:400,headers});\n')
 .replace(',allowEntitlementOnly:()=>boolean=()=>false','')
 .replace(' const consumers:readonly WorkConsumer[]=entitlementOnly?["entitlement"]:["finance","entitlement"];\n const settled=await Promise.allSettled(consumers.map',' const settled=await Promise.allSettled((["finance","entitlement"] as const).map')
 .replace('executions:consumers.length,counts','executions:2,counts');
}
