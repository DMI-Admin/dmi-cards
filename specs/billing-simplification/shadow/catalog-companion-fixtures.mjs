// Synthetic operator capture only. No real provider identifiers or network.
import {exportFixture,checksum} from './export-fixtures.mjs';
import {load} from '../local/load.mjs';
const {seedDigest}=load('src/lib/billing-v2/tooling/staging-seed.ts');
export function sealCompanion(value){const body=Object.fromEntries(Object.entries(value).filter(([k])=>k!=='checksum'));const c={...body,checksum:seedDigest(body)};const text=JSON.stringify(c);return {text,sha256:checksum(text)};}
export function companionFixture(){
 const value=exportFixture(),e=value[0].frozen_access_source;const annual={...e.billing_approved_prices[0],stripe_price_id:'price_annualfixture'};e.billing_approved_prices.push(annual);e.billing_stripe_resource_ownership.push({...e.billing_stripe_resource_ownership[0],stripe_resource_id:annual.stripe_price_id,revision:'5'});e.checks.missing_or_ambiguous_product_interval=1;
 const exportText=JSON.stringify(value),exportSha=checksum(exportText),retrieved=new Date().toISOString();
 const c={version:1,source_type:'stripe_test_price_retrieve',source_version:1,frozen_export_sha256:exportSha,stripe_scope:e.scope,application_key:'dmi_cards',application_ownership_revision:'5',price_ownership_revision:'5',application_state_digest:seedDigest(e.billing_stripe_applications[0]),price_id:annual.stripe_price_id,product_id:'prod_annualfixture',billing_interval:'annual',retrieved_at:retrieved,request:{method:'GET',account_id:e.scope.split(':')[0],price_id:annual.stripe_price_id,request_id:'req_fixture'},provider_response:{object:'price',id:annual.stripe_price_id,product:'prod_annualfixture',livemode:false,active:true,recurring:{interval:'year',interval_count:1}}};
 return {value,c,exportText,exportSha,file:sealCompanion(c),validationTime:retrieved};
}
