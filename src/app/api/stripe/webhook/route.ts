import {NextResponse} from "next/server";
import {constructStripeWebhookEvent} from "@/lib/stripe/config";
import {stripeWebhookModeDecision} from "@/lib/stripe/webhook-mode-guard";
import {simpleBilling,relevantEvents,isTransientBillingFailure} from "@/lib/stripe/simple-billing";
export async function POST(request: Request){
 let event;
 try{event=constructStripeWebhookEvent({payload:await request.text(),signature:request.headers.get('stripe-signature')});}
 catch{return NextResponse.json({received:false},{status:400});}
 const skip=(reason: 'untrusted_runtime' | 'stripe_livemode_mismatch' | 'billing_validation_or_ownership')=>{
  console.warn('[DMI billing] webhook skipped',{reason});
  return NextResponse.json({received:true,handled:false,skipped:true,reason});
 };
 const mode=stripeWebhookModeDecision(event.livemode);
 if(mode==='untrusted_runtime')return skip('untrusted_runtime');
 if(mode==='mode_mismatch')return skip('stripe_livemode_mismatch');
 if(!relevantEvents.has(event.type))return NextResponse.json({received:true,handled:false});
 try{return NextResponse.json({received:true,handled:await simpleBilling().webhook(event)});}
 catch(error){
  if(isTransientBillingFailure(error))return NextResponse.json({received:false},{status:503});
  return skip('billing_validation_or_ownership');
 }
}
