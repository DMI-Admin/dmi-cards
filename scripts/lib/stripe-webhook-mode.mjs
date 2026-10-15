// Offline loader for the real trusted-runtime policy; never reads environment files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
export function loadModeModule(file, deps = {}, env = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText, {exports, process: {env}, require: name => {
    if (name === 'server-only') return {};
    assert.ok(Object.hasOwn(deps, name), 'UNEXPECTED_MODE_IMPORT ' + name);
    return deps[name];
  }});
  return exports;
}
const base = loadModeModule('src/lib/stripe/billing-work-config.ts');
export const modeStagingEnvironment = {
  VERCEL_ENV: 'preview', VERCEL_TARGET_ENV: 'staging', VERCEL_PROJECT_ID: base.BILLING_WORK_PROJECT,
};
export const modeProductionEnvironment = {
  VERCEL_ENV: 'production', VERCEL_TARGET_ENV: 'production', VERCEL_PROJECT_ID: base.BILLING_WORK_PROJECT,
};
export function webhookModeGuard(env) {
  return loadModeModule('src/lib/stripe/webhook-mode-guard.ts', {'./billing-work-config': base}, env);
}
