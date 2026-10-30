import 'server-only';
import Stripe from 'stripe';
export class BillingConfigurationError extends Error {}
let client:Stripe|null=null;
export function getStripeServerClient(){
 const key=process.env.STRIPE_SECRET_KEY;
 if(!key || !/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(key))throw new BillingConfigurationError();
 return client ||= new Stripe(key);
}
export function constructStripeWebhookEvent({payload,signature}:{payload:string;signature:string|null}){
 if(!process.env.STRIPE_WEBHOOK_SECRET)throw new BillingConfigurationError();
 if(!signature)throw Error('Invalid webhook signature');
 return getStripeServerClient().webhooks.constructEvent(payload,signature,process.env.STRIPE_WEBHOOK_SECRET);
}
