import { cardFontKey, cardFontOverride, permittedCardFonts } from "@/lib/card-typography";
import "server-only";
import { ApiRouteError } from "@/lib/api/responses";
import type { SharedTemplate } from "@/lib/templates";
import { cardActionDefinitions, effectiveAllowedActions, normalizeCardActionConfig, type TemplateAllowedActionItem } from "@/lib/card-actions";
import { normalizeLeadCaptureSettings, customFieldStorageKey, templateColourPalette, templateTextColourPalette } from "@/lib/services/card-payload";

const textFields = ["job_title", "company_name", "email", "phone", "website", "address", "whatsapp", "linkedin", "instagram", "facebook", "youtube", "booking_link", "custom_url"];
const identity = ["title", "first_name", "last_name", "full_name"];
const media = { profile_image_url: "profile_image_allowed", company_logo_url: "logo_allowed", company_banner_url: "banner_allowed" } as const;
const transport = new Set(["id", "card_name", "template_id", "template_name", "status", "public_url", "last_updated", "card_slot", "created_at", "updated_at", "slug", "user_id", "profile_id", "client_id", "is_published", "selected_colour", "selected_text_colour", "selected_background_mode", "selected_gradient_start", "selected_gradient_end", "custom_fields", "field_order", "field_visibility", "hidden_fields", "lead_capture_settings", "action_config"]);
function reject(message: string): never { throw new ApiRouteError(400, "INVALID_REQUEST", message); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return reject("Expected a card configuration object.");
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > 12000) {
    // Temporary local diagnostic: never include submitted content in errors/logs.
    if (process.env.NODE_ENV === "development") {
      const reason = typeof value === "string" ? "too_long" : "non_string";
      const length = typeof value === "string" ? value.length : "not_applicable";
      const label = field.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 160);
      return reject(`BOUNDED_TEXT_INVALID field=${label} reason=${reason} length=${length}`);
    }
    return reject("Card fields must be bounded text.");
  }
  return value.trim();
}
function colour(value: unknown, field: string): string {
  const raw = text(value, field);
  if (!/^#[0-9a-f]{6}$/i.test(raw)) return reject("Use a valid six-digit hex colour.");
  return raw.toUpperCase();
}

// Produces a fresh, bounded DB payload. Never spreads browser fields into a write.
export function validateClientCard(input: unknown, template: SharedTemplate, plan: "free" | "pro") {
  const card = object(input);
  if (JSON.stringify(card).length > 262144) reject("Card configuration is too large.");
  if (!text(card.id, "id") || !text(card.card_name, "card_name")) reject("Card ID and card name are required.");
  if (!["published", "unpublished", "draft"].includes(String(card.status))) reject("Invalid card publication state.");
  const config = object(template.field_config || {});
  const sections = object(config.sections || template.custom_fields || {});
  const defaults = object(config.default_visibility || {});
  const allowed = new Set((template.allowed_fields || []).filter(field =>
    !Array.isArray(config.allowed_fields) || config.allowed_fields.includes(field)));
  const sectionFields = new Map<string, Set<string>>();
  const content = new Set<string>();
  for (const [section, fields] of Object.entries(sections)) {
    const enabled = defaults[`section:${section}`] !== false &&
      (template as unknown as Record<string, unknown>)[`show_${section}_section`] !== false;
    const permitted = new Set<string>(enabled && Array.isArray(fields)
      ? fields.filter((f): f is string => typeof f === "string" && allowed.has(f) && defaults[f] !== false) : []);
    sectionFields.set(section, permitted);
    permitted.forEach(f => content.add(customFieldStorageKey(f)));
  }
  const permissions = effectiveAllowedActions(template).actions.filter(a => a.enabled) as TemplateAllowedActionItem[];
  const actionDestinations = new Set<string>();
  permissions.forEach(a => {
    const field = cardActionDefinitions.find(d => d.type === a.type)?.fieldKey;
    if (field) actionDestinations.add(field);
    if (a.custom_action && a.destination_field) actionDestinations.add(a.destination_field);
  });
  const valueAllowed = new Set([...content, ...identity, ...actionDestinations]);
  const customInput = object(card.custom_fields || {});
  const values: Record<string, string> = {};
  const custom: Record<string, string> = {};
  for (const [field, value] of Object.entries(card)) {
    if (transport.has(field) || field in media) continue;
    if (!valueAllowed.has(field)) { if (value != null && value !== "") reject(`Field ${field} is not allowed by this template.`); continue; }
    values[field] = text(value, field);
  }
  for (const [field, value] of Object.entries(customInput)) {
    if (field.startsWith("__dmi_")) continue; // Rebuilt from validated design below.
    const key = customFieldStorageKey(field);
    if (key in media) continue; // Validated by the media contract below.
    if (!valueAllowed.has(key)) { if (value != null && value !== "") reject(`Custom field ${field} is not allowed.`); continue; }
    custom[key] = text(value, `custom_fields.${field}`);
  }
  for (const key of valueAllowed) if (values[key]) custom[key] = values[key];
  for (const [key, capability] of Object.entries(media)) {
    const value = text(card[key] ?? customInput[key], card[key] != null ? key : `custom_fields.${key}`);
    if (value && (template as unknown as Record<string, unknown>)[capability] !== true) reject(`${key} is unsupported by this template.`);
    values[key] = value;
    if (key === "company_banner_url" && value) custom[key] = value;
  }

  const palette = templateColourPalette(template);
  const selected = colour(card.selected_colour || palette[0] || template.primary_color || "#AC00FF", "selected_colour");
  const textPalette = templateTextColourPalette(template, selected);
  const selectedText = colour(card.selected_text_colour || textPalette[0], "selected_text_colour");
  const free = plan === "free";
  if ((free || template.custom_colour_allowed !== true) && ![...palette, template.primary_color || "#AC00FF"].map(c => c.toUpperCase()).includes(selected)) reject("Card colour is outside the template palette.");
  if ((free || template.custom_text_colour_allowed !== true) && !textPalette.map(c => c.toUpperCase()).includes(selectedText)) reject("Text colour is outside the template palette.");
  const mode = card.selected_background_mode || customInput.__dmi_background_mode || "solid";
  if (mode !== "solid" && mode !== "gradient") reject("Invalid background mode.");
  if (mode === "gradient" && (free || (template.supports_gradient ?? template.gradient_enabled) !== true)) reject("Gradients are not allowed.");
  custom.__dmi_background_mode = mode;
  for (const [field, key] of [["selected_gradient_start", "__dmi_gradient_start"], ["selected_gradient_end", "__dmi_gradient_end"]]) {
    const value = card[field] || customInput[key];
    if (!value) continue;
    const normalized = colour(value, card[field] ? field : `custom_fields.${key}`);
    // Solid-mode editor drafts retain inert gradient defaults after a palette
    // change. Strip them on Free; a gradient background itself is rejected above.
    if (!free) custom[key] = normalized;
  }
  if (Object.hasOwn(customInput, cardFontKey)) {
    const font = cardFontOverride(template, customInput);
    if (free || permittedCardFonts(template).length < 2 || !font) reject("Typography overrides require Pro and an Admin-permitted font.");
    custom[cardFontKey] = font;
  }
  for (const key of Object.keys(customInput)) if (key.startsWith("__dmi_") && !["__dmi_background_mode", "__dmi_gradient_start", "__dmi_gradient_end", cardFontKey].includes(key)) reject("Unsupported design metadata.");

  const order: Record<string, string[]> = {};
  for (const [section, fields] of Object.entries(object(card.field_order || {}))) {
    if (!Array.isArray(fields) || fields.some(f => typeof f !== "string")) reject("Invalid field order.");
    const permitted = sectionFields.get(section);
    if (!permitted && fields.length) reject(`Section ${section} is not allowed.`);
    order[section] = [];
    for (const field of fields as string[]) {
      if (!permitted?.has(field)) {
        if (values[customFieldStorageKey(field)] || custom[customFieldStorageKey(field)]) reject(`Field ${field} cannot be placed in section ${section}.`);
        continue; // Drop empty legacy editor scaffold, never persist it.
      }
      if (!order[section].includes(field)) order[section].push(field);
    }
  }
  if (!card.field_order) sectionFields.forEach((fields, section) => { order[section] = [...fields]; });
  const visibility: Record<string, boolean> = {};
  const visibleKeys = new Set([...content, ...identity, ...Object.keys(media)]);
  for (const [field, visible] of Object.entries(object(card.field_visibility || {}))) {
    if (typeof visible !== "boolean") reject("Invalid field visibility.");
    const key = customFieldStorageKey(field);
    const isSection = field.startsWith("section:");
    const permitted = isSection ? (sectionFields.get(field.slice(8))?.size || 0) > 0 : visibleKeys.has(key);
    if (!permitted) { if (visible) reject(`Visibility for ${field} is not allowed.`); continue; }
    visibility[isSection ? field : key] = visible;
  }
  if (card.hidden_fields != null && !Array.isArray(card.hidden_fields)) reject("Invalid hidden fields.");
  for (const field of (card.hidden_fields || []) as unknown[]) {
    if (typeof field !== "string") reject("Invalid hidden field.");
    const key = customFieldStorageKey(field as string);
    if (visibleKeys.has(key)) visibility[key] = false;
  }
  const rawActions = card.action_config == null ? null : object(card.action_config);
  if (rawActions && !Array.isArray(rawActions.actions)) reject("Invalid action configuration.");
  const configured = rawActions?.actions as unknown[] | undefined;
  for (const value of configured || []) {
    const action = object(value);
    if (!permissions.some(p => p.type === action.type && (!p.custom_action || p.id === action.id))) reject(`Action ${String(action.type)} is not permitted.`);
  }
  const actions = normalizeCardActionConfig(rawActions || { actions: permissions.map((a, i) => ({ id: a.id || a.type, type: a.type, visible: a.default_visible ?? true, order: i, label: a.default_label })) });
  if (configured && actions?.actions.length !== configured.length) reject("Malformed or duplicate actions.");
  const fullName = values.full_name || [values.title, values.first_name, values.last_name].filter(Boolean).join(" ");
  if (!fullName) reject("Full name is required.");
  return {
    template_id: template.id, card_name: text(card.card_name, "card_name"), full_name: fullName,
    title: values.title || "", first_name: values.first_name || "", last_name: values.last_name || "",
    ...Object.fromEntries(textFields.map(f => [f, values[f] || custom[f] || ""])),
    profile_image_url: values.profile_image_url || "", company_logo_url: values.company_logo_url || "",
    selected_colour: selected, selected_text_colour: selectedText,
    field_order: order, field_visibility: visibility,
    hidden_fields: Object.keys(visibility).filter(k => !visibility[k]),
    custom_fields: custom, action_config: actions, lead_capture_settings: normalizeLeadCaptureSettings(card.lead_capture_settings),
    status: card.status === "published" ? "published" : "draft", is_published: card.status === "published",
  };
}
