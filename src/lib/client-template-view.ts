import { editableMediaValue } from "@/lib/client-media-intent";
import { cardSectionLabel } from "@/lib/card-section-label";
import { cardFontKey, cardFontOverride, permittedCardFonts } from "@/lib/card-typography";
import type { SharedTemplate } from "@/lib/templates";
import { cardActionDefinitions, effectiveAllowedActions, effectiveCardActionConfig, type TemplateAllowedActionItem } from "@/lib/card-actions";
import { customFieldStorageKey, templateColourPalette, templateTextColourPalette, type SharedClientCard, type ClientCardPlan, type CardFieldOrder } from "@/lib/services/card-payload";

export function clientTemplateView(template: SharedTemplate, plan: ClientCardPlan) {
  const config = (template.field_config || {}) as { allowed_fields?: string[]; sections?: Record<string, string[]>; default_visibility?: Record<string, boolean>; section_order?: string[]; section_labels?: Record<string, string> };
  const allowed = new Set((template.allowed_fields || []).filter(f => !config.allowed_fields || config.allowed_fields.includes(f)));
  const defaults = config.default_visibility || {};
  const raw = config.sections || template.custom_fields || {};
  const sectionOrder = [...new Set([...(config.section_order || []), ...Object.keys(raw)])];
  const sections = sectionOrder.flatMap(key => {
    if (defaults[`section:${key}`] === false || (template as unknown as Record<string, unknown>)[`show_${key}_section`] === false) return [];
    const fields = (raw[key] || []).filter(f => allowed.has(f) && defaults[f] !== false);
    return fields.length ? [{ key, label: cardSectionLabel(key, config.section_labels?.[key]), fields }] : [];
  });
  const actions = effectiveAllowedActions(template).actions.filter(a => a.enabled) as TemplateAllowedActionItem[];
  const content = new Set(sections.flatMap(s => s.fields.map(customFieldStorageKey)));
  const values = new Set([...content, "title", "first_name", "last_name", "full_name"]);
  for (const action of actions) {
    const field = cardActionDefinitions.find(d => d.type === action.type)?.fieldKey;
    if (field) values.add(field);
    if (action.custom_action && action.destination_field) values.add(action.destination_field);
  }
  return {
    access: template.access_level, layout: template.layout_type, sections, content, values, actions, defaults,
    media: {
      profile_image_url: template.profile_image_allowed === true,
      company_logo_url: template.logo_allowed === true,
      company_banner_url: template.banner_allowed === true,
    },
    customColour: plan !== "free" && template.custom_colour_allowed === true,
    customTextColour: plan !== "free" && template.custom_text_colour_allowed === true,
    gradient: plan !== "free" && (template.supports_gradient ?? template.gradient_enabled) === true,
    font: template.default_font || template.font_family || "Inter",
    fonts: permittedCardFonts(template),
    typographyEditable: plan === "pro" && permittedCardFonts(template).length > 1,
    palette: [...new Set([...templateColourPalette(template), template.primary_color || "#AC00FF"])],
  };
}

const metadata = new Set(["media_edits", "edit_revision", "id", "card_name", "template_id", "template_name", "status", "public_url", "last_updated", "card_slot", "created_at", "updated_at", "slug", "lead_capture_settings"]);
export function reconcileClientCard(card: SharedClientCard, template: SharedTemplate, plan: ClientCardPlan) {
  if (plan === "enterprise") return { card, changes: [] as string[] };
  const view = clientTemplateView(template, plan);
  const changes = new Set<string>();
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(card)) {
    if (metadata.has(key) || view.values.has(key)) next[key] = value;
    else if (!["custom_fields", "field_order", "field_visibility", "hidden_fields", "action_config", "selected_colour", "selected_text_colour", "selected_background_mode", "selected_gradient_start", "selected_gradient_end", ...Object.keys(view.media)].includes(key) && value != null && value !== "") changes.add(key);
  }
  const custom: Record<string, string> = {};
  for (const [key, value] of Object.entries(card.custom_fields || {})) {
    if (key === cardFontKey) continue;
    if (view.values.has(customFieldStorageKey(key))) custom[customFieldStorageKey(key)] = typeof value === "string" ? value : "";
    else if (!["__dmi_background_mode", "__dmi_gradient_start", "__dmi_gradient_end"].includes(key) && !(key in view.media) && value) changes.add(key);
  }
  for (const [key, allowed] of Object.entries(view.media)) {
    const value = editableMediaValue(card, key as keyof typeof view.media);
    next[key] = allowed ? value : "";
    if (!allowed && value) changes.add(key);
  }
  const pickColour = (value: string | null | undefined, palette: string[], customAllowed: boolean, label: string) => {
    const valid = value && /^#[0-9a-f]{6}$/i.test(value) && (customAllowed || palette.some(c => c.toLowerCase() === value.toLowerCase()));
    if (value && !valid) changes.add(label);
    return valid ? value : palette[0];
  };
  next.selected_colour = pickColour(card.selected_colour, view.palette, view.customColour, "card colour");
  next.selected_text_colour = pickColour(card.selected_text_colour, templateTextColourPalette(template, next.selected_colour as string), view.customTextColour, "text colour");
  next.selected_background_mode = view.gradient ? card.selected_background_mode || (template.gradient_enabled ? "gradient" : "solid") : "solid";
  if (!view.gradient && card.selected_background_mode === "gradient") changes.add("gradient");
  if (view.gradient) {
    next.selected_gradient_start = card.selected_gradient_start || template.primary_color || next.selected_colour;
    next.selected_gradient_end = card.selected_gradient_end || template.secondary_color || next.selected_colour;
  }
  const order: Record<string, string[]> = {};
  for (const section of view.sections) {
    const saved = (card.field_order as Record<string, string[]> | undefined)?.[section.key] || [];
    order[section.key] = [...new Set([...saved.filter(f => section.fields.includes(f)), ...section.fields])];
  }
  next.field_order = order;
  const visible = new Set([...view.content, "title", "first_name", "last_name", "full_name", ...Object.entries(view.media).filter(([, yes]) => yes).map(([key]) => key)]);
  const visibility: Record<string, boolean> = {};
  for (const section of view.sections) visibility[`section:${section.key}`] = card.field_visibility?.[`section:${section.key}`] ?? true;
  for (const field of visible) {
    const saved = Object.entries(card.field_visibility || {}).find(([key]) => customFieldStorageKey(key) === field)?.[1];
    const hidden = card.hidden_fields?.some(key => customFieldStorageKey(key) === field);
    const mediaDefault = field === "profile_image_url" ? template.profile_image_default_enabled : field === "company_logo_url" ? template.logo_default_enabled : field === "company_banner_url" ? template.banner_default_enabled : undefined;
    visibility[field] = hidden ? false : saved ?? mediaDefault ?? view.defaults[field] ?? true;
  }
  next.field_visibility = visibility;
  next.hidden_fields = Object.keys(visibility).filter(k => !visibility[k]);
  const configured = effectiveCardActionConfig(card, template);
  const actions = configured.actions.filter(a => view.actions.some(p => p.type === a.type && (!p.custom_action || p.id === a.id)));
  if (actions.length !== configured.actions.length) changes.add("unapproved actions");
  next.action_config = { version: 1, actions: actions.map((a, order) => ({ ...a, order })) };
  const savedFont = card.custom_fields?.[cardFontKey];
  const font = cardFontOverride(template, card.custom_fields);
  if (savedFont) {
    if (view.typographyEditable && font) custom[cardFontKey] = font;
    else changes.add("typography override");
  }
  next.custom_fields = custom;
  return { card: next as unknown as SharedClientCard, changes: [...changes] };
}

export function clientFieldOrder(template: SharedTemplate, plan: ClientCardPlan, saved?: CardFieldOrder | null): CardFieldOrder {
  const view = clientTemplateView(template, plan);
  return Object.fromEntries(view.sections.map(s => [s.key, [...new Set([...(saved?.[s.key as keyof CardFieldOrder] || []).filter(f => s.fields.includes(f)), ...s.fields])]])) as CardFieldOrder;
}
