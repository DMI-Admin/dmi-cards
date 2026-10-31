export type BillingInterval = "monthly" | "annual";

export const proPricing: Record<
  BillingInterval,
  {
    price: string;
    period: string;
    cta: string;
  }
> = {
  monthly: {
    price: "£5.99",
    period: "per month",
    cta: "Continue with Pro — £5.99/month",
  },
  annual: {
    price: "£59.99",
    period: "per year",
    cta: "Continue with Pro — £59.99/year",
  },
};
