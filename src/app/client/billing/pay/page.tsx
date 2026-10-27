import BillingPaymentClient from "./PaymentClient";
import { embeddedCheckoutEnabled, embeddedCheckoutEnvironment } from "@/lib/stripe/embedded-checkout-config";

// The server alone supplies the early-loading capability. No secret credential
// crosses this boundary; auth in PaymentClient still precedes third-party load.
export default function BillingPaymentPage() {
  const config = embeddedCheckoutEnabled() ? embeddedCheckoutEnvironment() : null;
  return <BillingPaymentClient earlyPublishableKey={config?.publishableKey ?? null} />;
}
