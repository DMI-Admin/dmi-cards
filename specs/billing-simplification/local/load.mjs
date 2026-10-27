// Test-only TS loader. No runtime dependency on this file is permitted.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import assert from 'node:assert/strict';
const cache=new Map();
export function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,Error,Date,JSON,BigInt,Map,Set,Promise,structuredClone,AbortController,performance,setTimeout,clearTimeout,require:name=>{if(name==='node:crypto')return crypto;if(name==='server-only')return {};assert.ok(name.startsWith('.'),'Unexpected test module import '+name);return load(path.join(path.dirname(file),name)+'.ts');}});return exports;}
