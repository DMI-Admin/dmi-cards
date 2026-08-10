import "server-only";

export const DMI_STRIPE_APP_NAMESPACE = "dmi_cards_v2";
export const DMI_STRIPE_APP_METADATA_KEY = "dmi_app";

export function hasDmiStripeAppNamespace(metadata: {
  [key: string]: string | undefined;
} | null | undefined) {
  return metadata?.[DMI_STRIPE_APP_METADATA_KEY] === DMI_STRIPE_APP_NAMESPACE;
}
