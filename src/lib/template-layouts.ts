/** Canonical layout metadata. No database, browser or React dependencies. */
export const templateLayouts = [
  { id: "classic_free", displayName: "Classic", accessLevel: "free", rendererSupported: true, builderAvailable: true, clientEligiblePlans: ["free", "pro", "enterprise"], currentTemplatesOrder: 10 },
  { id: "profile_free", displayName: "Profile", accessLevel: "free", rendererSupported: true, builderAvailable: true, clientEligiblePlans: ["free", "pro", "enterprise"], currentTemplatesOrder: 20 },
  { id: "modern_minimal", displayName: "Modern Minimal", accessLevel: "paid", rendererSupported: true, builderAvailable: true, clientEligiblePlans: ["pro", "enterprise"], currentTemplatesOrder: 30 },
  { id: "executive_paid", displayName: "Executive", accessLevel: "paid", rendererSupported: true, builderAvailable: true, clientEligiblePlans: ["pro", "enterprise"], currentTemplatesOrder: 40 },
  { id: "brand_paid", displayName: "Brand", accessLevel: "paid", rendererSupported: true, builderAvailable: true, clientEligiblePlans: ["pro", "enterprise"], currentTemplatesOrder: 50 },
] as const;

export type LayoutId = (typeof templateLayouts)[number]["id"];
export type LayoutPlan = "free" | "pro" | "enterprise";
type TemplateLayout = { layout_type?: string | null; access_level?: string | null };

export function getTemplateLayout(id: unknown) {
  return templateLayouts.find(layout => layout.id === id);
}

export function builderLayouts(access: string) {
  return templateLayouts.filter(layout => layout.builderAvailable && layout.accessLevel === access);
}

export function canCreateTemplateLayout(template: TemplateLayout) {
  const layout = getTemplateLayout(template.layout_type);
  return Boolean(layout?.builderAvailable && layout.rendererSupported && layout.accessLevel === template.access_level);
}

/** New card/template selection: never admits unknown IDs or rendering aliases. */
export function canSelectTemplateLayout(template: TemplateLayout, plan: LayoutPlan) {
  const layout = getTemplateLayout(template.layout_type);
  return Boolean(layout?.rendererSupported && layout.accessLevel === template.access_level &&
    (layout.clientEligiblePlans as readonly string[]).includes(plan));
}

/** Existing records remain resolvable, without making legacy layouts selectable. */
export function canResolveExistingTemplate(template: TemplateLayout, plan: LayoutPlan) {
  if (getTemplateLayout(template.layout_type)) return canSelectTemplateLayout(template, plan);
  return template.access_level === "free" || (template.access_level === "paid" && plan !== "free");
}

/** Rendering compatibility only. Never use this value in a write payload. */
export function resolveRenderingLayout(id?: string | null, access?: string | null): LayoutId {
  const layout = getTemplateLayout(id);
  if (layout?.rendererSupported && layout.accessLevel === access) return layout.id;
  // Preserve the release renderer's legacy/unknown fallback, including "classic".
  return access === "free" ? "classic_free" : "modern_minimal";
}

export function compareTemplateLayouts(a: TemplateLayout & { name: string; id: string }, b: TemplateLayout & { name: string; id: string }) {
  return (getTemplateLayout(a.layout_type)?.currentTemplatesOrder ?? Infinity) -
    (getTemplateLayout(b.layout_type)?.currentTemplatesOrder ?? Infinity) ||
    a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}
