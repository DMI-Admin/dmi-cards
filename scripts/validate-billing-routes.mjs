// Closed billing route list; scan src only, never docs or fixtures elsewhere.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const billingRoutes = [
  '/api/admin/subscriptions',
  '/api/stripe/portal',
  '/api/stripe/webhook',
  '/api/v1/billing/checkout/embedded',
  '/api/v1/billing/complete',
  '/api/v1/billing/subscription',
];
const billingNamespace = /^\/api\/(?:stripe(?:\/|$)|(?:v1\/)?billing(?:\/|$)|admin\/(?:billing|finance|subscriptions)(?:\/|$)|internal\/(?:billing|finance))/;

export function scanBillingRoutes(sourceRoot = 'src') {
  const failures = [], references = [];
  let files = 0;
  for (const route of billingRoutes) {
    if (!fs.existsSync(path.join(sourceRoot,'app',route.slice(1),'route.ts'))) {
      failures.push({file:sourceRoot,route,reason:'missing current route file'});
    }
  }
  function walk(directory) {
    for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      const file = path.join(directory,entry.name);
      if (entry.isDirectory()) {walk(file);continue;}
      if (!entry.isFile()) continue;
      const bytes = fs.readFileSync(file);
      if (bytes.includes(0)) continue;
      files++;
      const text = bytes.toString('utf8');
      for (const match of text.matchAll(/\/api\/[A-Za-z0-9_./${}*%-]+/g)) {
        const route = match[0];
        if (!billingNamespace.test(route)) continue;
        const reference = {file,line:text.slice(0,match.index).split('\n').length,route};
        references.push(reference);
        if (!billingRoutes.includes(route)) failures.push({...reference,reason:'deleted or unapproved billing route'});
      }
    }
  }
  walk(sourceRoot);
  return {files,references,failures};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = scanBillingRoutes();
  for (const failure of result.failures) console.error(`${failure.file}:${failure.line || 0} ${failure.route}: ${failure.reason}`);
  if (result.failures.length) process.exitCode = 1;
  else console.log(`Billing API routes: PASS (${result.files} source files, ${result.references.length} current references)`);
}
