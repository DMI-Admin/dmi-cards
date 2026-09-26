import { canCreateTemplateLayout } from "@/lib/template-layouts";

type Fields = Record<string, unknown>;
export const templateUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): value is Fields {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Apply only changes to the hydrated UI; do not write its inferred defaults. */
export function templateEditPatch(draft: Fields, baseline: Fields, stored: Fields): Fields {
  const patch: Fields = {};
  for (const [key, value] of Object.entries(draft)) {
    if (JSON.stringify(value) === JSON.stringify(baseline[key])) continue;
    if (record(value) && record(baseline[key])) {
      patch[key] = { ...(record(stored[key]) ? stored[key] : {}),
        ...templateEditPatch(value, baseline[key], record(stored[key]) ? stored[key] : {}) };
    } else patch[key] = value;
  }
  return patch;
}

/** Sparse writes only. Existing layout conversion has no ordinary-edit action. */
export function validateAdminTemplateWrite(input: unknown, existing?: Fields): Fields {
  if (!record(input)) throw new Error("Invalid template payload.");
  const payload = { ...input };
  if (existing) {
    if (payload.id !== undefined && payload.id !== existing.id) throw new Error("Template ID does not match the edit target.");
    if ("layout_type" in payload && payload.layout_type !== existing.layout_type) {
      throw new Error("Layout changes require an explicit migration; ordinary edits cannot convert templates.");
    }
    if ("access_level" in payload && payload.access_level !== existing.access_level) {
      throw new Error("Access changes require an explicit supported action.");
    }
    // Do not persist a rendering fallback, even when the stored layout is null.
    delete payload.layout_type;
    delete payload.access_level;
  } else if (!canCreateTemplateLayout(payload)) {
    throw new Error("Choose a supported layout with its registered access level.");
  }
  if ("supports_gradient" in payload) {
    if (!existing || payload.supports_gradient !== existing.supports_gradient) {
      throw new Error("Independent gradient permission is unavailable until schema support is implemented.");
    }
    delete payload.supports_gradient;
  }
  if (!existing || "name" in payload) {
    if (typeof payload.name !== "string" || !payload.name.trim()) throw new Error("Template name is required.");
  }
  if ("slug" in payload && payload.slug !== null && typeof payload.slug !== "string") throw new Error("Invalid template slug.");
  for (const key of ["id", "created_at", "updated_at", "usage_count"]) delete payload[key];
  return payload;
}
