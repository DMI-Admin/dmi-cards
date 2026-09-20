// The existing JSON design-metadata namespace; no table/schema change.
export const cardFontKey = "__dmi_font_family";
export const supportedCardFonts = ["Inter", "Poppins", "Montserrat", "Lato", "Roboto", "Playfair Display", "DM Sans", "Outfit", "Nunito", "Space Mono", "Syne"] as const;
type TypographyTemplate = { allowed_fonts?: string[] | null; default_font?: string | null; font_family?: string | null };
export function permittedCardFonts(template: TypographyTemplate): string[] {
  return [...new Set((template.allowed_fonts || []).filter(font => supportedCardFonts.some(known => known === font)))];
}
export function cardFontOverride(template: TypographyTemplate, fields?: Record<string, unknown> | null): string | undefined {
  const font = fields?.[cardFontKey];
  return typeof font === "string" && permittedCardFonts(template).includes(font) ? font : undefined;
}
