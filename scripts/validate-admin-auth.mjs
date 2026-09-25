// Local-only authorization regression checks; no network or real credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
const env = {};
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/admin-auth.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, process: { env } });
const { requireAdminAccess, isAdminAllowlistConfigured } = exports;
const denied = async identity => {
  const result = await requireAdminAccess(identity);
  assert.equal(result.authorized, false);
  assert.equal(result.status, 403);
};
await denied({ userId: 'user_owner' });
assert.equal(isAdminAllowlistConfigured(), false);
for (const alias of ['DMI_ADMIN_CLERK_USER_ID', 'CLERK_ADMIN_USER_IDS', 'CLERK_ADMIN_USER_ID', 'DMI_ADMIN_EMAILS', 'DMI_ADMIN_EMAIL', 'ADMIN_EMAILS', 'ADMIN_EMAIL']) {
  env[alias] = alias.includes('EMAIL') ? 'owner@example.test' : 'user_owner';
  await denied({ userId: 'user_owner', email: 'owner@example.test', sessionClaims: { email: 'owner@example.test' } });
  assert.equal(isAdminAllowlistConfigured(), false);
}
for (const value of ['', ' ,  , ']) {
  env.DMI_ADMIN_CLERK_USER_IDS = value;
  await denied({ userId: 'user_owner' });
  assert.equal(isAdminAllowlistConfigured(), false);
}
env.DMI_ADMIN_CLERK_USER_IDS = ' user_owner, user_second , ';
assert.equal(isAdminAllowlistConfigured(), true);
for (const userId of ['user_owner', 'user_second']) assert.equal((await requireAdminAccess({ userId })).authorized, true);
for (const userId of [null, undefined, '', 'user_other', 'USER_OWNER', 'user_ow', ' user_owner']) {
  await denied({ userId, email: 'owner@example.test', sessionClaims: { email: 'owner@example.test' }, role: 'admin', username: 'user_owner' });
}
const boundaries = ['src/lib/business-entitlement-server.ts', 'src/middleware.ts', 'src/app/admin/page.tsx', 'src/lib/admin-card-mutations-server.ts', 'src/lib/admin-inventory-server.ts', 'src/app/api/admin/templates/route.ts', 'src/app/api/admin/templates/[templateId]/route.ts', 'src/app/api/admin/system-health/route.ts'];
for (const file of boundaries) {
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /requireAdminAccess\((?:await auth\(\)|adminAuth)\)/, file);
  assert.doesNotMatch(source, /currentUser|emailFromClerkUser|clerkClient/, file);
}
const middleware = fs.readFileSync('src/middleware.ts', 'utf8');
assert.match(middleware, /isAdminEntryRoute\(req\)/);
assert.match(middleware, /isAdminUnauthorizedRoute\(req\)/);
assert.match(middleware, /status: 403/);
// Preserve existing separate Supabase authentication and Clerk presentation.
for (const file of ['src/components/ClientLogin.tsx', 'src/lib/client-auth.ts', 'src/app/client/layout.tsx', 'src/components/AdminSignIn.tsx']) {
  assert.equal(fs.readFileSync(file, 'utf8'), execFileSync('git', ['show', `bfd7482a5f70354cfb6904abd04e03bad1fc092c:${file}`], { encoding: 'utf8' }), file);
}
console.log('PASS: Admin ID-only authorization, fail-closed aliases/email/session checks, protected boundaries and unchanged Client auth/sign-in presentation.');
