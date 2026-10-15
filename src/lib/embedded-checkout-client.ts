export type CheckoutInterval = "monthly" | "annual";
export type PaymentCheckout =
  | { kind: "disabled" }
  | { kind: "embedded"; sessionId: string; interval: CheckoutInterval; clientSecret: string; publishableKey: string; startupDiagnostics?: boolean }
  | { kind: "hosted"; sessionId: string; interval: CheckoutInterval; url: string }
  | { kind: "complete" | "processing" | "expired"; sessionId: string; interval: CheckoutInterval };

export function paymentPageInput(search: string): { sessionId: string } | { interval: CheckoutInterval } {
  const params = new URLSearchParams(search);
  if ([...params.keys()].some(key => !["session_id", "interval"].includes(key)) ||
      params.getAll("session_id").length > 1 || params.getAll("interval").length > 1 ||
      (params.has("session_id") && params.has("interval"))) throw new Error("Invalid checkout link.");
  if (params.has("session_id")) {
    const sessionId = params.get("session_id")!;
    if (!/^cs_(?:test_|live_)?[A-Za-z0-9]{1,240}$/.test(sessionId)) throw new Error("Invalid checkout link.");
    return { sessionId };
  }
  const interval = params.get("interval") || "monthly";
  if (interval !== "monthly" && interval !== "annual") throw new Error("Invalid checkout link.");
  return { interval };
}

export function activationReturnUrl(sessionId: string) {
  if (!/^cs_(?:test_|live_)?[A-Za-z0-9]{1,240}$/.test(sessionId)) throw new Error("Invalid checkout.");
  return `/client/billing/activating?session_id=${encodeURIComponent(sessionId)}`;
}

export function paymentCheckout(value: unknown): PaymentCheckout {
  if (!value || typeof value !== "object") throw new Error("Checkout unavailable.");
  const v = value as Record<string, unknown>;
  if (v.kind === "disabled") return { kind: "disabled" };
  if (typeof v.sessionId !== "string" || !/^cs_(?:test_|live_)?[A-Za-z0-9]{1,240}$/.test(v.sessionId) ||
      (v.interval !== "monthly" && v.interval !== "annual")) throw new Error("Checkout unavailable.");
  const base: { sessionId: string; interval: CheckoutInterval } = { sessionId: v.sessionId, interval: v.interval };
  if (v.kind === "embedded" && typeof v.clientSecret === "string" && v.clientSecret.startsWith(v.sessionId + "_secret_") &&
      typeof v.publishableKey === "string" && /^pk_test_[A-Za-z0-9]+$/.test(v.publishableKey)) {
    return { ...base, kind: "embedded", clientSecret: v.clientSecret, publishableKey: v.publishableKey, startupDiagnostics: v.startupDiagnostics === true };
  }
  if (v.kind === "hosted" && typeof v.url === "string") {
    const url = new URL(v.url);
    if (url.protocol === "https:" && !url.username && !url.password) return { ...base, kind: "hosted", url: url.href };
  }
  if (v.kind === "complete" || v.kind === "processing" || v.kind === "expired") return { ...base, kind: v.kind };
  throw new Error("Checkout unavailable.");
}
