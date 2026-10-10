import Stripe from "stripe";
// LOCAL ONLY. Never imported by application code. No network or file writes.
// Projection intentionally excludes identifiers, metadata contents and provider errors.
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const kind=x=>x===null?'null':Array.isArray(x)?'array':typeof x;
const shape=x=>({present:x!==undefined,type:kind(x)});
const obj=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const numeric=x=>({...shape(x),...(typeof x==='number'&&Number.isFinite(x)?{value:x}:typeof x==='string'&&/^-?\d{1,26}(\.\d{1,12})?$/.test(x)?{value:x}:{})});
const choice=(x,values)=>({...shape(x),...(values.includes(x)?{value:x}:{})});
const ident=(x,prefix)=>({...shape(x),valid_id:typeof x==='string'&&new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(x)});
const array=x=>({...shape(x),...(Array.isArray(x)?{length:x.length}:{})});
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
export function projectSubscription(input,context,verifiedUser){
 const s=obj(input),items=obj(s.items),c=obj(context),e=obj(c.event);
 return {
  subscription:{id:ident(s.id,'sub'),customer:shape(s.customer),status:choice(s.status,['active','trialing','past_due','unpaid','incomplete','incomplete_expired','canceled','paused']),livemode:choice(s.livemode,[true,false]),created:numeric(s.created),cancel_at_period_end:choice(s.cancel_at_period_end,[true,false]),discounts:array(s.discounts),metadata:shape(s.metadata),cancel_at:numeric(s.cancel_at),canceled_at:numeric(s.canceled_at),ended_at:numeric(s.ended_at),trial_end:numeric(s.trial_end),pause_collection:shape(s.pause_collection)},
  items:{...shape(s.items),has_more:choice(items.has_more,[true,false]),data:array(items.data),entries:Array.isArray(items.data)?items.data.slice(0,200).map(raw=>{
   const it=obj(raw),p=obj(it.price),r=obj(p.recurring);
   return {id:ident(it.id,'si'),created:numeric(it.created),quantity:numeric(it.quantity),current_period_start:numeric(it.current_period_start),current_period_end:numeric(it.current_period_end),discounts:array(it.discounts),price:{...shape(it.price),id:ident(p.id,'price'),product_shape:p.product===null?'null':typeof p.product==='string'?'string':p.product&&typeof p.product==='object'&&!Array.isArray(p.product)?'object':'other',currency:choice(p.currency,['gbp','usd','eur']),billing_scheme:choice(p.billing_scheme,['per_unit','tiered']),unit_amount:numeric(p.unit_amount),unit_amount_decimal:numeric(p.unit_amount_decimal),tax_behavior:choice(p.tax_behavior,['exclusive','inclusive','unspecified']),transform_quantity:shape(p.transform_quantity),recurring:{...shape(p.recurring),interval:choice(r.interval,['day','week','month','year']),interval_count:numeric(r.interval_count),usage_type:choice(r.usage_type,['licensed','metered'])}}};
  }):[]},
  context:{scope:{...shape(c.scope),valid_scope:typeof c.scope==='string'&&/^acct_[A-Za-z0-9]+:(test|live)$/.test(c.scope),mode:typeof c.scope==='string'&&c.scope.endsWith(':test')?'test':typeof c.scope==='string'&&c.scope.endsWith(':live')?'live':'unknown'},verified_at:{...shape(c.verifiedAt),valid_timestamp:Number.isFinite(Date.parse(c.verifiedAt))},api_version:choice(c.apiVersion,['2026-07-29.dahlia','2023-10-16']),event:{...shape(c.event),id:ident(e.id,'evt'),created:numeric(e.created),type:choice(e.type,['customer.subscription.updated','customer.subscription.created','customer.subscription.deleted']),subject_id:ident(e.subjectId,'sub')},verified_user:{valid_uuid:uuid(verifiedUser)}}
 };
}
export function diagnoseSubscription(input,context,verifiedUser){
 const stack=[];let failure=null;
 function trace(site,helper,work){stack.push({site,helper});try{return work();}catch(error){if(!failure)failure={helper:helper==='fail'?(stack.at(-2)?.helper||'normalizeSubscription'):helper,fieldPath:stack.map(x=>x.site),errorCode:error instanceof Error&&['FINANCE_MALFORMED_STRIPE_DATA','FINANCE_INVALID_DECIMAL','FINANCE_SCOPE_MISMATCH','FINANCE_FOREIGN_APPLICATION'].includes(error.message)?error.message:'UNCLASSIFIED'};throw error;}finally{stack.pop();}}
 const helpers=new Set(['fail','object','text','optionalText','bool','id','optionalId','list','minor','count','iso','time','currency','validContext','provenance','nullableAmount','discounts','decimal','rational','roundMinor']);
 // Static source call-site enums only; never include argument values in diagnostics.
 const transform=ctx=>sf=>{
  const visit=node=>{
   const updated=ts.visitEachChild(node,visit,ctx);
   if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&helpers.has(node.expression.text)){
    const site=node.getText(sf),helper=node.expression.text;
    return ts.factory.createCallExpression(ts.factory.createIdentifier('__trace'),undefined,[ts.factory.createStringLiteral(site),ts.factory.createStringLiteral(helper),ts.factory.createArrowFunction(undefined,undefined,[],undefined,ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),updated)]);
   }
   return updated;
  };return ts.visitNode(sf,visit);
 };
 function load(file,deps={},instrument=false){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},transformers:instrument?{before:[transform]}:undefined}).outputText,{exports,Error,Date,Intl,BigInt,__trace:trace,require:name=>{if(name==='server-only')return {};if(name==='stripe')return {default:Stripe};if(!Object.hasOwn(deps,name))throw Error('UNEXPECTED_LOCAL_IMPORT');return deps[name];}});return exports;}
 const metrics=load('src/lib/stripe/finance-metrics.ts');
 // Explicit committed dependency; no dynamic local-import resolution or stubs.
 const tax=load('src/lib/stripe/finance-tax.ts');
 const normalizer=load('src/lib/stripe/finance-normalize.ts',{'./finance-metrics':metrics,'./finance-tax':tax},true);
 try { const result=normalizer.normalizeSubscription(input,context,verifiedUser);return {status:'passed',valuationStatus:result.subscription.valuation_status,valuationReason:result.subscription.valuation_reason}; }
 catch {return {status:'failed',...(failure||{helper:'normalizeSubscription',fieldPath:['normalizeSubscription'],errorCode:'UNCLASSIFIED'})};}
}
