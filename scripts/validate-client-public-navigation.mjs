import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const environment = { env: {} };
const canonical = { exports: {}, process: environment, URL };
vm.runInNewContext(compile(fs.readFileSync('src/lib/public-url.ts', 'utf8')), canonical);
const context = { exports: {}, process: environment, URL, require: name => {
  assert.equal(name, '@/lib/public-url'); return canonical.exports;
} };
vm.runInNewContext(compile(fs.readFileSync('src/lib/client-public-card-navigation.ts', 'utf8')), context);
const navigate = context.exports.clientPublicCardNavigationUrl;
const card = Object.freeze({ slug: 'test-card', public_url: 'https://app.dmicards.com/u/test-card' });
const snapshot = JSON.stringify(card);
assert.equal(navigate(card.slug), card.public_url, 'SSR uses canonical URL');
for (const origin of ['https://dmi-cards-preview-one.vercel.app', 'https://dmi-cards-preview-two.vercel.app']) {
  context.window = { location: { origin } };
  environment.env.NEXT_PUBLIC_VERCEL_ENV = 'preview';
  assert.equal(navigate(card.slug), `${origin}/u/test-card`);
  assert.equal(navigate('/space name/'), `${origin}/u/space%20name`);
  assert.equal(canonical.exports.buildPublicCardUrl(card.slug), card.public_url, 'QR/Wallet canonical builder unchanged');
}
environment.env.NEXT_PUBLIC_VERCEL_ENV = 'production';
assert.equal(navigate(card.slug), card.public_url, 'production Vercel alias remains canonical');
for (const origin of ['https://app.dmicards.com', 'http://localhost:3102', 'https://fake.vercel.app.example.com']) {
  context.window = { location: { origin } };
  delete environment.env.NEXT_PUBLIC_VERCEL_ENV;
  assert.equal(navigate(card.slug), card.public_url);
}
context.window = { location: { origin: 'https://dmi-cards-preview-three.vercel.app' } };
assert.equal(navigate(card.slug), 'https://dmi-cards-preview-three.vercel.app/u/test-card', 'runtime hostname works without public deployment metadata');
assert.equal(navigate(undefined, card.public_url), 'https://dmi-cards-preview-three.vercel.app/u/test-card', 'legacy mapped cards without separate slug navigate on Preview');
const page = fs.readFileSync('src/app/client/cards/page.tsx', 'utf8');
const ast = ts.createSourceFile('page.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = {};
function visit(node) {
  if (ts.isFunctionDeclaration(node) && ['copyLink', 'viewPublicPage'].includes(node.name?.text)) handlers[node.name.text] = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
let opened, copied;
const ui = { clientPublicCardNavigationUrl: navigate, window: { open: (...args) => { opened = args; } }, navigator: { clipboard: { writeText: async value => { copied = value; } } } };
vm.runInNewContext(compile(Object.values(handlers).join('\n')), ui);
ui.viewPublicPage(card); await ui.copyLink(card);
assert.equal(opened[0], navigate(card.slug));
assert.equal(opened[2], 'noopener,noreferrer');
assert.equal(copied, navigate(card.slug));
assert.ok(page.includes('{clientPublicCardNavigationUrl(card.slug, card.public_url)}'), 'success modal displays matching navigation URL');
assert.ok(page.includes('public_url: buildPublicCardUrl(slug)'), 'card data construction retains canonical URL');
assert.equal(JSON.stringify(card), snapshot, 'navigation never mutates stored card data');
console.log('PASS: Preview/production navigation, runtime origin, actual View/Copy handlers, success modal wiring, unchanged canonical builder and card data.');
