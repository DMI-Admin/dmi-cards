import "server-only";
import type {AcquisitionTiming, LeaseRetryPolicy} from "./lease-acquisition-timing";
import type {Observer} from "./webhook-observer";
import type Stripe from "stripe";
import { hasDmiStripeAppNamespace } from "@/lib/stripe/app-namespace";
import { billingRuntime, BillingFailure, command, invoiceSubscription, objectId, synchronizeSubscription, type BillingRuntime } from "@/lib/stripe/reliability";

const subscriptionEvents = new Set(["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"]);
const invoiceEvents = new Set(["invoice.payment_failed", "invoice.payment_succeeded", "invoice.paid"]);
export async function handleStripeWebhookEvent(event: Stripe.Event, runtime?: BillingRuntime, observer?: Observer, acquisitionTiming?: AcquisitionTiming, leaseRetry?: LeaseRetryPolicy) {
  const initialize = async () => runtime || await billingRuntime();
  const resolved = observer ? await observer.run("runtime", initialize) : await initialize();
  const r = {...resolved, ...(observer ? {observer} : {}), ...(acquisitionTiming ? {acquisitionTiming} : {}), ...(leaseRetry ? {leaseRetry} : {})};
  if (event.livemode !== r.live) throw new BillingFailure("SCOPE_CONFLICT", 409);
  const claim = await command<{ duplicate?: boolean; token: string }>(r, "event_claim", null, null, { id: event.id, type: event.type, created: event.created, subject: (event.data.object as { id?: string }).id });
  if (claim.duplicate) return { handled: true, skipped: true, reason: "duplicate_event" };
  const knownSubscription = async (id: string) => {
    const { data, error } = await r.db.from("billing_subscriptions").select("stripe_subscription_id").eq("stripe_subscription_id", id).maybeSingle();
    if (error) throw new BillingFailure("MIRROR_UNAVAILABLE");
    if (data) throw new BillingFailure("SCOPE_CONFLICT", 409);
  };
  const ignored = async (reason: string) => {
    await command(r, "event_finish", null, claim.token, { id: event.id, outcome: reason });
    return { handled: false, skipped: true, reason };
  };
  try {
    let id = "", deleted: Stripe.Subscription | undefined, userId: string | undefined;
    if (subscriptionEvents.has(event.type)) {
      const sub = event.data.object as Stripe.Subscription;
      if (!hasDmiStripeAppNamespace(sub.metadata)) { await knownSubscription(sub.id); return await ignored("app_namespace_mismatch"); }
      id = sub.id;
      if (event.type === "customer.subscription.deleted") deleted = sub;
    } else if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (!hasDmiStripeAppNamespace(session.metadata)) return await ignored("app_namespace_mismatch");
      id = objectId(session.subscription); userId = session.client_reference_id || session.metadata?.dmi_user_id;
      if (!id || !userId || (session.metadata?.dmi_user_id && session.metadata.dmi_user_id !== userId)) throw new BillingFailure("MALFORMED_CHECKOUT");
    } else if (invoiceEvents.has(event.type)) {
      id = invoiceSubscription(event.data.object as Stripe.Invoice) || "";
      if (!id) return await ignored("standalone_invoice");
      const sub = await r.stripe.subscriptions.retrieve(id);
      if (!hasDmiStripeAppNamespace(sub.metadata)) { await knownSubscription(sub.id); return await ignored("app_namespace_mismatch"); }
    } else return await ignored("unhandled_event_type");
    const synchronize = () => synchronizeSubscription(r, id, { userId, deleted, event: { id: event.id, created: event.created, token: claim.token } });
    const result = observer ? await observer.run("subscription_sync", synchronize) : await synchronize();
    return { handled: true, skipped: result.outcome.endsWith("ignored"), reason: result.outcome };
  } catch (error) {
    const reason = error instanceof BillingFailure ? error.reason : "RETRYABLE_FAILURE";
    await command(r, "event_fail", null, claim.token, { id: event.id, outcome: "retryable_failure", error: reason }).catch(() => undefined);
    throw new BillingFailure(reason);
  }
}
