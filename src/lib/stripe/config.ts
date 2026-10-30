import 'server-only';
import Stripe from 'stripe';
let client:Stripe|null=null;
export function getStripeServerClient(){
 const key=process.env.STRIPE_SECRET_KEY;
 if(!key)throw Error('Stripe is not configured');
 return client ||= new Stripe(key);
}
export function constructStripeWebhookEvent({payload,signature}:{payload:string;signature:string|null}){
 if(!signature || !process.env.STRIPE_WEBHOOK_SECRET)throw Error('Invalid webhook signature');
 return getStripeServerClient().webhooks.constructEvent(payload,signature,process.env.STRIPE_WEBHOOK_SECRET);
}
