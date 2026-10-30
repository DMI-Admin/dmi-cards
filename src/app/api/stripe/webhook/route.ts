import {NextResponse} from "next/server";
import {constructStripeWebhookEvent} from "@/lib/stripe/config";
import {stripeWebhookModeDecision} from "@/lib/stripe/webhook-mode-guard";
import {simpleBilling,relevantEvents} from "@/lib/stripe/simple-billing";
export async function POST(request: Request){
 let event;
 try{event=constructStripeWebhookEvent({payload:await request.text(),signature:request.headers.get('stripe-signature')});}
 catch{return NextResponse.json({received:false},{status:400});}
 const mode=stripeWebhookModeDecision(event.livemode);
 if(mode==='untrusted_runtime')return NextResponse.json({received:false},{status:503});
 if(mode==='mode_mismatch')return NextResponse.json({received:true,handled:false,skipped:true,reason:'stripe_livemode_mismatch'});
 if(!relevantEvents.has(event.type))return NextResponse.json({received:true,handled:false});
 try{await simpleBilling().webhook(event);return NextResponse.json({received:true,handled:true});}
 catch{return NextResponse.json({received:false},{status:503});}
}
