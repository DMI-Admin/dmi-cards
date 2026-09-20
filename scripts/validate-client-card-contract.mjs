import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const diagnosticEnvironment = { NODE_ENV: "development" };
function load(path, deps) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { process: { env: diagnosticEnvironment }, exports, require(name) { if (["@/lib/card-typography", "@/lib/card-section-label", "@/lib/client-media-intent", "@/lib/card-media"].includes(name)) return load(name.replace("@/", "src/") + ".ts", {}); assert.ok(name in deps, name); return deps[name]; } });
  return exports;
}
class ApiRouteError extends Error { constructor(status, code, message) { super(message); this.status = status; } }
const actions = load('src/lib/card-actions.ts', {});
const payload = load('src/lib/services/card-payload.ts', {
  '@/components/CardRenderer': { displayName: c => c.full_name },
  '@/lib/card-actions': actions,
  '@/lib/public-url': { buildPublicCardUrl: s => '/u/' + s },
  '@/lib/templates': { normalizeColourPalette: x => Array.isArray(x) ? x : [] },
});
const { validateClientCard: validate } = load('src/lib/client-card-contract.ts', {
  'server-only': {}, '@/lib/api/responses': { ApiRouteError },
  '@/lib/card-actions': actions, '@/lib/services/card-payload': payload,
});
const template = {
  id: 'template', name: 'Test template', access_level: 'free', layout_type: 'profile_free',
  primary_color: '#FFFFFF', free_colour_palette: ['#FFFFFF', '#000000'],
  text_colours: ['#111111', '#EEEEEE'], profile_image_allowed: true,
  logo_allowed: false, banner_allowed: false,
  allowed_fields: ['full_name', 'email'],
  field_config: { allowed_fields: ['full_name', 'email'], sections: { personal: ['full_name'], contact: ['email'] } },
  allowed_actions: { actions: [{ id: 'save_contact', type: 'save_contact', enabled: true, default_visible: true }] },
};
const card = { id: 'card-new', card_name: 'Mine', full_name: 'Tester', status: 'published',
  selected_colour: '#FFFFFF', selected_text_colour: '#111111', email: 'tester@example.invalid',
  action_config: { actions: [{ id: 'save_contact', type: 'save_contact', visible: true, order: 0 }] } };
assert.equal(payload.canSelectTemplate(template, 'free'), true);
assert.equal(payload.canSelectTemplate({ ...template, access_level: 'paid', layout_type: 'brand_paid' }, 'free'), false);
const valid = validate(card, template, 'free');
const alternate = validate({ ...card, selected_colour: '#000000', selected_text_colour: '#EEEEEE', selected_gradient_start: '#FFFFFF' }, template, 'free');
assert.equal(alternate.selected_colour, '#000000');
assert.equal(alternate.custom_fields.__dmi_gradient_start, undefined);
assert.equal(valid.email, card.email);
assert.equal(valid.action_config.actions[0].type, 'save_contact');
assert.equal(validate({ ...card, profile_image_url: 'https://example.invalid/profile' }, template, 'free').profile_image_url, 'https://example.invalid/profile');
for (const patch of [
  { company_logo_url: 'logo' }, { company_banner_url: 'banner' },
  { selected_background_mode: 'gradient' }, { selected_colour: '#123456' },
  { selected_text_colour: '#123456' }, { font_family: 'Comic Sans' },
  { company_name: 'Forbidden' }, { custom_fields: { secret: 'Injected' } },
  { field_visibility: { secret: true } }, { field_order: { injected: ['email'] } },
  { action_config: { actions: [{ id: 'website', type: 'website', visible: true }] } },
]) assert.throws(() => validate({ ...card, ...patch }, template, 'free'), ApiRouteError);
assert.throws(() => validate({ ...card, profile_image_url: 'photo' }, { ...template, profile_image_allowed: false }, 'free'));
const pro = validate({ ...card, selected_colour: '#123456', selected_text_colour: '#ABCDEF', selected_background_mode: 'gradient', selected_gradient_end: '#654321' },
  { ...template, custom_colour_allowed: true, custom_text_colour_allowed: true, gradient_enabled: true }, 'pro');
assert.equal(pro.custom_fields.__dmi_gradient_end, '#654321');
// Transactional writer/receipt/revision tests now live in validate-card-media-integration.mjs.
// This suite retains the complete pure template contract and original allowance invariants.
assert.throws(() => validate({ ...card, id: 'existing', selected_colour: '#123456' }, template, 'free'));
// Logical concurrency model. SQL is inspected below; no database is invoked.
let tail = Promise.resolve(), count = 0;
function create(limit) {
  const work = tail.then(() => { if (count >= limit) throw Error('limit'); return ++count; });
  tail = work.catch(() => {});
  return work;
}
const concurrent = await Promise.allSettled([create(1), create(1)]);
assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 1);
assert.equal(count, 1);
await create(3); await create(3); await assert.rejects(create(3));
const sql = fs.readFileSync('supabase/migrations/20260917210000_add_atomic_client_card_creation.sql', 'utf8');
assert.match(sql, /security invoker/i);
assert.match(sql, /from public, anon, authenticated/);
assert.match(sql, /to service_role/);
assert.match(sql, /p_card_allowance not in \(1, 3\)/);
assert.ok(sql.indexOf('pg_advisory_xact_lock') < sql.indexOf('select count(*)'));
assert.ok(sql.indexOf('select count(*)') < sql.indexOf('insert into public.cards'));
assert.match(sql, /hashtextextended\('public.cards.card_slot:' \|\| p_owner_user_id::text, 0\)/);
assert.doesNotMatch(sql.match(/insert into public.cards \(([^)]+)\)/)[1], /card_slot|profile_id/);
assert.doesNotMatch(sql, /revoke .*on table/i);
console.log('PASS: Free/Pro contract, concurrency model and migration invariants (no SQL executed).');


// Client capability projection must produce a payload accepted by the real server validator.
const viewHelpers = load('src/lib/client-template-view.ts', {
  '@/lib/card-actions': actions, '@/lib/services/card-payload': payload,
});
const { reconcileClientCard: reconcile, clientTemplateView: capabilities } = viewHelpers;
const stale = { ...card, company_logo_url: 'stale-logo', company_name: 'old company',
  custom_fields: { forbidden: 'old value' },
  selected_background_mode: 'gradient', selected_colour: '#123456',
  field_order: { contact: ['email', 'company_name'], secret: ['forbidden'] },
  action_config: { actions: [...card.action_config.actions, { id: 'website', type: 'website', visible: true, order: 1 }] },
};
const original = JSON.stringify(stale);
const reconciled = reconcile(stale, template, 'free');
assert.equal(JSON.stringify(stale), original, 'Opening/projection must not mutate original card data');
assert.ok(reconciled.changes.includes('unapproved actions'));
assert.ok(reconciled.changes.includes('company_logo_url'));
assert.equal(reconciled.card.email, card.email);
assert.equal(reconciled.card.company_name, undefined);
assert.equal(reconciled.card.selected_background_mode, 'solid');
assert.equal(reconciled.card.action_config.actions.length, 1);
validate(reconciled.card, template, 'free');
for (const layout_type of ['classic_free', 'profile_free']) {
  const t = { ...template, layout_type, profile_image_default_enabled: true };
  const visible = reconcile({ ...card, profile_image_url: 'photo' }, t, 'free').card;
  assert.equal(visible.field_visibility.profile_image_url, true);
  const hidden = reconcile({ ...visible, field_visibility: { ...visible.field_visibility, profile_image_url: false } }, t, 'free').card;
  assert.equal(hidden.field_visibility.profile_image_url, false);
  assert.equal(hidden.profile_image_url, 'photo', 'Toggle preserves valid media');
  validate(hidden, t, 'free');
}
const customTemplate = { ...template, logo_allowed: true, banner_allowed: true,
  allowed_fields: ['email', 'custom:expertise:specialty'],
  field_config: { allowed_fields: ['email', 'custom:expertise:specialty'],
    sections: { contact: ['email'], expertise: ['custom:expertise:specialty'], disabled: ['email'] },
    section_order: ['expertise', 'contact', 'disabled'], section_labels: { expertise: 'Expertise' },
    default_visibility: { 'section:disabled': false } },
};
const customCard = reconcile({ ...card, company_logo_url: 'logo', company_banner_url: 'banner',
  custom_fields: { specialty: 'Consulting' }, field_visibility: { 'section:expertise': false } }, customTemplate, 'free').card;
assert.equal(capabilities(customTemplate, 'free').sections[0].label, 'Expertise');
assert.equal(customCard.custom_fields.specialty, 'Consulting');
assert.equal(customCard.field_visibility['section:expertise'], false);
assert.ok(!('disabled' in customCard.field_order));
validate(customCard, customTemplate, 'free');
const paidTemplate = { ...template, access_level: 'paid', layout_type: 'brand_paid',
  custom_colour_allowed: true, custom_text_colour_allowed: true, gradient_enabled: true };
const paid = reconcile({ ...card, selected_colour: '#123456', selected_text_colour: '#ABCDEF', selected_background_mode: 'gradient', selected_gradient_end: '#654321' }, paidTemplate, 'pro');
assert.equal(paid.card.selected_colour, '#123456');
validate(paid.card, paidTemplate, 'pro');
assert.equal(capabilities(paidTemplate, 'free').gradient, false);
assert.equal(capabilities(paidTemplate, 'pro').gradient, true);
assert.equal(capabilities(template, 'pro').customColour, false);
assert.equal(capabilities(template, 'free').typographyEditable, false);
assert.equal(reconcile(stale, template, 'enterprise').card, stale);
console.log('PASS: Client Classic/Profile/Pro capability mapping, custom sections, media toggles, stale-state projection without mutation, normalized payloads accepted by server, Enterprise unchanged.');

const normalizedTemplates = load('src/lib/templates.ts', {
  '@/lib/supabase': { supabase: {} }, '@/lib/card-actions': actions,
});
for (const layout_type of ['executive_paid', 'brand_paid']) {
  const solidWithCapability = normalizedTemplates.normalizeTemplate({ ...paidTemplate, layout_type, gradient_enabled: false, supports_gradient: true });
  assert.equal(capabilities(solidWithCapability, 'pro').gradient, true);
  validate({ ...card, selected_background_mode: 'gradient' }, solidWithCapability, 'pro');
  assert.equal(capabilities(solidWithCapability, 'free').gradient, false);
  const denied = normalizedTemplates.normalizeTemplate({ ...paidTemplate, layout_type, gradient_enabled: true, supports_gradient: false });
  assert.equal(capabilities(denied, 'pro').gradient, false);
  assert.throws(() => validate({ ...card, selected_background_mode: 'gradient' }, denied, 'pro'));
}
for (const key of ['profile_image_url', 'company_logo_url', 'company_banner_url']) {
  const t = { ...customTemplate, profile_image_default_enabled: true, logo_default_enabled: true, banner_default_enabled: true };
  let current = reconcile({ ...card, [key]: 'first-image' }, t, 'free').card;
  assert.equal(current[key], 'first-image');
  current = reconcile({ ...current, [key]: 'replacement' }, t, 'free').card;
  const stored = validate(current, t, 'free');
  const reopened = payload.mapSupabaseCard({ ...stored, id: 'saved', slug: 'saved' }, [t], 'free', t);
  assert.equal(reopened[key], 'replacement');
  const removed = reconcile({ ...current, custom_fields: { [key]: 'old-image' }, [key]: '', media_edits: { [key]: 'remove' } }, t, 'free').card;
  assert.equal(removed[key], '');
  const { media_edits: removalIntent, ...removedPayload } = removed;
  assert.equal(removalIntent[key], 'remove');
  const savedRemoval = validate({ ...removedPayload, custom_fields: { [key]: 'old-image' } }, t, 'free');
  assert.ok(!savedRemoval.custom_fields[key]);
  if (key !== 'company_banner_url') assert.equal(savedRemoval[key], '');
}
const hiddenAction = reconcile({ ...card, action_config: { actions: [{ ...card.action_config.actions[0], visible: false }] } }, template, 'free').card;
assert.equal(hiddenAction.action_config.actions[0].visible, false);
assert.throws(() => validate({ ...card, custom_fields: { __dmi_font: 'Inter' } }, template, 'free'));
const jsx = (type, props) => ({ type, props });
const renderer = load('src/components/CardRenderer.tsx', {
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
  'lucide-react': new Proxy({}, { get: (_, k) => k }),
  'react-icons/fa': new Proxy({}, { get: (_, k) => k }),
  '@/lib/card-actions': actions,
  '@/lib/card-action-routing': { resolveCardActionHref: () => null, resolveCardFieldHref: () => null, vCardDataHref: () => '', vCardFilename: () => '' },
  '@/components/CardMediaImage': { default: props => ({ type: 'img', props }) },
  '@/lib/media-slots': load('src/lib/media-slots.ts', {}),
});
function flatten(node) {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (!node || typeof node !== 'object') return [node];
  if (typeof node.type === 'function') return flatten(node.type(node.props));
  return [node, ...flatten(node.props?.children)];
}
for (const layout_type of ['classic_free', 'profile_free', 'modern_minimal', 'executive_paid', 'brand_paid']) {
  const paid = !layout_type.endsWith('_free');
  const t = { ...template, layout_type, access_level: paid ? 'paid' : 'free',
    requires_profile_image: true, profile_image_allowed: true,
    logo_allowed: paid, requires_logo: paid, banner_allowed: paid && layout_type !== 'executive_paid', requires_banner: paid && layout_type !== 'executive_paid' };
  for (const visible of [true, false]) {
    const data = { ...card, action_config: { actions: [] }, field_visibility: { profile_image_url: visible, company_logo_url: visible, company_banner_url: visible } };
    const nodes = flatten(renderer.default({ template: t, cardData: data, mode: 'preview', showMediaPlaceholders: true }));
    assert.equal(nodes.some(n => n?.type === 'UserRound'), visible, layout_type + ' profile placeholder');
    assert.equal(nodes.includes('Logo'), visible && paid, layout_type + ' logo placeholder');
    assert.equal(nodes.includes('Banner'), visible && Boolean(t.banner_allowed), layout_type + ' banner placeholder');
  }
}
console.log('PASS: gradient capability/default separation; all media save/reopen/replace/remove paths; hidden actions unchanged; shared renderer placeholders honor visibility in all five layouts.');

// Exercise the actual Admin hydration/save expressions: default mode must not
// become the capability again when an existing paid template is saved as Solid.
const builderSource = fs.readFileSync('src/app/templates/page.tsx', 'utf8');
const builderAst = ts.createSourceFile('builder.tsx', builderSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const permissionExpressions = [];
let hydratePermission;
function visitBuilder(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(builderAst) === 'supports_gradient') {
    permissionExpressions.push(node.initializer.getText(builderAst));
  }
  if (ts.isCallExpression(node) && node.expression.getText(builderAst) === 'setSupportsGradient' && node.arguments[0]?.getText(builderAst).includes('template.supports_gradient')) {
    hydratePermission = node.arguments[0].getText(builderAst);
  }
  ts.forEachChild(node, visitBuilder);
}
visitBuilder(builderAst);
assert.equal(permissionExpressions.length, 2, 'save and preview carry independent permission');
assert.ok(hydratePermission, 'existing permission is hydrated');
for (const allowed of [true, false]) {
  const supportsGradient = vm.runInNewContext(hydratePermission, { normalizedAccessLevel: 'paid', template: { supports_gradient: allowed, gradient_enabled: !allowed } });
  assert.equal(supportsGradient, allowed);
  for (const gradientEnabled of [true, false]) {
    for (const expression of permissionExpressions) {
      assert.equal(vm.runInNewContext(expression, { accessLevel: 'paid', supportsGradient, gradientEnabled }), allowed);
      assert.equal(vm.runInNewContext(expression, { accessLevel: 'free', supportsGradient, gradientEnabled }), false);
    }
  }
}
assert.match(builderSource, /setGradientEnabled\(event.target.value === "gradient"\)/, 'baseline Solid/Gradient selector changes default only');
console.log('PASS: Admin hydration preserves permission/denial; Solid/Gradient default changes cannot overwrite it; Free permission stays false.');
const payloadFunction = builderAst.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'buildTemplatePayload');
const payloadHelpers = Object.fromEntries(['sanitizeTextColourPalette', 'sanitizeFreeColourPalette', 'sanitizeTemplateFonts', 'sanitizeDefaultFont', 'templateAllowedActionsIncludes', 'sanitizeAllowedFields', 'sanitizeTemplateAllowedActions', 'sanitizeCustomFields', 'readTemplateContentSections'].map(name => [name, value => value]));
const makeAdminPayload = vm.runInNewContext(ts.transpileModule(payloadFunction.getText(builderAst) + '\nbuildTemplatePayload;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, payloadHelpers);
for (const supports_gradient of [true, false]) {
  const saved = makeAdminPayload({ name: 'Brand', access_level: 'paid', supports_gradient, gradient_enabled: false });
  assert.equal(saved.supports_gradient, supports_gradient, 'save serializer carries independent permission');
  assert.equal(saved.gradient_enabled, false, 'solid remains default');
}
console.log('PASS: actual Admin payload serializer preserves gradient permission separately from Solid default.');

const sectionDisplay = load('src/lib/card-section-label.ts', {});
for (const [key, label] of Object.entries({ personal: 'Personal Details', company: 'Company Details', contact: 'Contact' })) {
  assert.equal(sectionDisplay.cardSectionLabel(key), label);
  assert.equal(sectionDisplay.cardSectionLabel(key, key), label);
  assert.equal(sectionDisplay.cardSectionLabel(key, 'Our Team'), 'Our Team');
}
for (const layout_type of ['classic_free','profile_free','modern_minimal','executive_paid','brand_paid']) {
  const free = layout_type.endsWith('_free');
  const fontTemplate = { ...template, id: 'font-template', layout_type, access_level: free ? 'free' : 'paid', allowed_fonts: ['Inter','Poppins'], default_font: 'Inter' };
  const input = { ...card, template_id: fontTemplate.id, custom_fields: { __dmi_font_family: 'Poppins' } };
  assert.throws(() => validate(input, fontTemplate, 'free'));
  assert.throws(() => validate({ ...input, custom_fields: { __dmi_font_family: 'Arial; color:red' } }, fontTemplate, 'pro'));
  const saved = validate(input, fontTemplate, 'pro');
  const reopened = payload.mapSupabaseCard({ ...saved, id: 'font-card', slug: 'font-card' }, [fontTemplate], 'pro', fontTemplate);
  assert.equal(reopened.custom_fields.__dmi_font_family, 'Poppins');
  assert.equal(reconcile(reopened, fontTemplate, 'pro').card.custom_fields.__dmi_font_family, 'Poppins');
  assert.equal(reconcile(reopened, fontTemplate, 'free').card.custom_fields.__dmi_font_family, undefined);
  const rendered = flatten(renderer.default({ template: fontTemplate, cardData: reopened, mode: 'public' }));
  assert.ok(rendered.some(node => node?.props?.style?.fontFamily?.includes('--font-poppins')), layout_type + ' renders persisted font');
}
console.log('PASS: canonical section display labels; bounded Pro typography save/reopen/render across all five layouts; Free/injected font denied; stale font cleaned on explicit save.');

// Temporary local bounded-text diagnostics. No API/database request is made.
const overlong = "x".repeat(12001);
assert.throws(() => validate({ ...card, full_name: overlong }, template, "free"),
  e => e.message === "BOUNDED_TEXT_INVALID field=full_name reason=too_long length=12001");
assert.throws(() => validate({ ...card, email: { private: "never print me" } }, template, "free"),
  e => e.message === "BOUNDED_TEXT_INVALID field=email reason=non_string length=not_applicable");
diagnosticEnvironment.NODE_ENV = "production";
assert.throws(() => validate({ ...card, full_name: overlong }, template, "free"),
  e => e.message === "Card fields must be bounded text.");
diagnosticEnvironment.NODE_ENV = "development";
// Optional local reproduction using an actual image, without logging its bytes.
if (process.argv[2]) {
  const image = fs.readFileSync(process.argv[2]);
  const dataUrl = "data:image/png;base64," + image.toString("base64");
  assert.ok(dataUrl.length > 12000 && dataUrl.length < 100000);
  const mediaTemplate = { ...template, access_level: "paid", layout_type: "brand_paid",
    profile_image_allowed: true, logo_allowed: true, banner_allowed: true,
    allowed_fonts: ["Inter", "Poppins"], default_font: "Inter" };
  for (const field of ["company_banner_url", "profile_image_url", "company_logo_url"]) {
    const submitted = JSON.parse(JSON.stringify({ ...card, [field]: dataUrl,
      field_visibility: { "section:personal": true },
      custom_fields: { __dmi_font_family: "Poppins" } }));
    assert.throws(() => validate(submitted, mediaTemplate, "pro"), e => {
      const expected = `BOUNDED_TEXT_INVALID field=${field} reason=too_long length=${dataUrl.length}`;
      assert.equal(e.message, expected);
      console.log(e.message);
      return true;
    });
  }
}
console.log("PASS: local diagnostics identify field/reason/length only; production error and text bound unchanged.");
