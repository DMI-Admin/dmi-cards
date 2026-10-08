// Offline route/presentation regression checks. No application API calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const base = '3c9b7e78107ecc2db445cad8cfbf79171998aa74';
const baseline = file => execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8' });
const Shell = ({ children }) => React.createElement('div', { 'data-shared-shell': true }, children);
const Appearance = () => React.createElement('select', { 'aria-label': 'Unchanged appearance control' });
const styles = { default: new Proxy({}, { get: (_, key) => String(key) }) };
const cache = new Map();
function load(file) {
 if (cache.has(file)) return cache.get(file);
 const record = { exports: {} };
 const source = fs.readFileSync(file, 'utf8');
 vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
  exports: record.exports, module: record,
  require(name) {
   if (name === 'react/jsx-runtime') return jsxRuntime;
   if (name === '@/components/admin/AdminShell') return { default: Shell };
   if (name === '@/components/admin/AdminAppearance') return { default: Appearance };
   if (name.endsWith('.css')) return styles;
   assert.ok(name.startsWith('@/components/'), `Unexpected dependency: ${name}`);
   return load(path.join('src', name.slice(2)) + '.tsx');
  },
  fetch: () => { throw Error('Network forbidden'); },
 });
 cache.set(file, record.exports);
 return record.exports;
}
function nodes(tree) {
 if (!tree || typeof tree !== 'object') return [];
 if (Array.isArray(tree)) return tree.flatMap(nodes);
 return [tree, ...nodes(tree.props?.children)];
}
const pages = [
 ['src/components/AdminDashboard.tsx', 'Dashboard', 'Welcome back to DMI Cards Admin Panel.'],
 ['src/app/analytics/page.tsx', 'Analytics', 'Admin analytics placeholder.'],
 ['src/app/uploads/page.tsx', 'Uploads', 'Admin uploads placeholder page.'],
 ['src/app/support/page.tsx', 'Support', 'Admin support placeholder page.'],
 ['src/app/audit-logs/page.tsx', 'Audit Logs', 'Audit logs placeholder page.'],
 ['src/app/security/page.tsx', 'Security', 'Manage platform security and permissions.'],
 ['src/app/settings/page.tsx', 'Settings', 'Admin settings placeholder page.'],
];
const ui = load('src/components/admin/AdminUI.tsx');
for (const [file, title, subtitle] of pages) {
 const source = fs.readFileSync(file, 'utf8');
 const tree = load(file).default();
 assert.equal(tree.type, Shell, `${title} uses the existing responsive shell`);
 const all = nodes(tree);
 const heading = all.filter(n => n.type === ui.AdminPageHeader);
 assert.equal(heading.length, 1);
 assert.equal(heading[0].props.title, title);
 assert.equal(heading[0].props.subtitle, subtitle);
 const html = renderToStaticMarkup(tree);
 assert.equal((html.match(/<h1>/g) || []).length, 1);
 assert.doesNotMatch(source, /<main|<Sidebar|text-white|bg-\[#|!important|fetch\(|process\.env|supabase|stripe|useEffect/);
 assert.doesNotMatch(html, /<form|<input|<button|href=/); // Placeholder pages gain no actions or data sources.
}
const dashboard = nodes(load('src/components/AdminDashboard.tsx').default());
const kpis = dashboard.filter(n => n.type === ui.AdminKpiCard);
assert.deepEqual(kpis.map(n => [n.props.label, n.props.value]), [['Total Clients','128'],['Active Cards','421'],['Monthly Revenue','£8,420'],['QR Scans','14.2K']]);
const dashboardSource = fs.readFileSync('src/components/AdminDashboard.tsx','utf8');
assert.match(dashboardSource, /Static example figures; not live metrics\./);
for (const phrase of ['DMI Cards Admin','Platform Overview','Analytics Charts Coming Soon']) assert.ok(dashboardSource.includes(phrase) && baseline('src/components/AdminDashboard.tsx').includes(phrase));
const security = fs.readFileSync('src/app/security/page.tsx','utf8');
assert.match(security, /Security tools coming soon/);
assert.doesNotMatch(security, /AdminStatusBadge|verified|operational|Working|All good/);
const settings = nodes(load('src/app/settings/page.tsx').default());
assert.equal(settings.filter(n => n.type === Appearance).length, 1);
for (const file of ['src/components/admin/AdminAppearance.tsx','src/lib/admin-appearance.ts','src/app/client/settings/page.tsx','src/app/dashboard/page.tsx','src/app/admin/dashboard/page.tsx','src/middleware.ts','src/app/layout.tsx']) assert.equal(fs.readFileSync(file,'utf8'),baseline(file), `${file} behaviour unchanged`);
assert.match(baseline('src/app/dashboard/page.tsx'), /redirect\("\/admin\/dashboard"\)/);
const css = fs.readFileSync('src/components/admin/AdminSimplePages.module.css','utf8');
assert.match(css, /var\(--admin-/);
assert.doesNotMatch(css, /!important|#[a-f0-9]{3,8}\b|opacity:/i);
assert.match(css, /repeat\(4,minmax\(0,1fr\)\)/);
assert.match(css, /max-width:599px/);
assert.match(css, /grid-template-columns:1fr/);
assert.match(css, /min-width:0/);
// Allow the approved phone-only density refinement alongside the Phase 2A presentation scope.
const allowed = new Set([...pages.map(([file]) => file), 'src/components/admin/AdminSimplePages.module.css', 'scripts/validate-admin-simple-pages.mjs', 'src/components/admin/AdminUI.module.css', 'src/app/finance/finance.module.css', 'src/app/system-health/system-health.module.css', 'scripts/validate-admin-ui.mjs', 'scripts/validate-system-health-owner-view.mjs']);
const status = execFileSync('git', ['status','--porcelain=v1','--untracked-files=all'], { encoding:'utf8' });
for (const line of status.split('\n').filter(Boolean)) assert.ok(allowed.has(line.slice(3)), `Out-of-scope pending change: ${line}`);
console.log('PASS: seven shared-shell views, original headings/placeholders/static KPIs, no invented actions/data/security checks, unchanged Dashboard redirect/auth/appearance/Client settings and scoped responsive semantic styling.');
