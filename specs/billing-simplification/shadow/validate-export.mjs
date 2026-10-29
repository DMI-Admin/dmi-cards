// Read an external frozen file; delegate only to disposable Unix-socket PostgreSQL.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {load} from '../local/load.mjs';
const fail=reason=>{console.log(JSON.stringify({ok:false,reason}));process.exit(1);};
try{
 const [file,sha,bin,driver,companionFile,companionSha,...extra]=process.argv.slice(2);
 if(extra.length||Boolean(companionFile)!==Boolean(companionSha)||![file,bin,driver].every(v=>v&&path.isAbsolute(v))||!sha||!/^[0-9a-f]{64}$/i.test(sha))fail('V2_EXPORT_ARGUMENTS');
 const real=fs.realpathSync(file),root=fs.realpathSync(process.cwd());
 if(real===root||real.startsWith(root+path.sep)||!fs.statSync(real).isFile()||fs.statSync(real).size>20*1024*1024)fail('V2_EXPORT_FILE');
 const before=fs.readFileSync(real);if(createHash('sha256').update(before).digest('hex')!==sha.toLowerCase())fail('V2_EXPORT_CHECKSUM_MISMATCH');
 let companionReal,companionBefore;const companions=[];
 if(companionFile){if(!path.isAbsolute(companionFile)||!/^[0-9a-f]{64}$/.test(companionSha))fail('V2_EXPORT_ARGUMENTS');companionReal=fs.realpathSync(companionFile);if(companionReal.startsWith(root+path.sep)||!fs.statSync(companionReal).isFile()||fs.statSync(companionReal).size>20*1024*1024)fail('V2_EXPORT_FILE');companionBefore=fs.readFileSync(companionReal);companions.push({text:companionBefore.toString('utf8'),sha256:companionSha});}
 await load('src/lib/billing-v2/tooling/frozen-export.ts').prepareFrozenExport(before.toString('utf8'),sha,companions);
 const result=spawnSync(process.execPath,['specs/billing-simplification/shadow/postgres.mjs',bin,driver,real,sha,...(companionReal?[companionReal,companionSha]:[])],{encoding:'utf8',maxBuffer:8*1024*1024,timeout:180000});
 if(!before.equals(fs.readFileSync(real)))fail('V2_EXPORT_FILE_CHANGED');
 if(companionReal&&!companionBefore.equals(fs.readFileSync(companionReal)))fail('V2_EXPORT_FILE_CHANGED');
 if(result.status!==0)fail('V2_EXPORT_LOCAL_VALIDATION_FAILED');
 const line=result.stdout.split('\n').find(l=>l.startsWith('FROZEN_EXPORT_RESULT '));if(!line)fail('V2_EXPORT_LOCAL_RESULT_MISSING');
 console.log(line.slice('FROZEN_EXPORT_RESULT '.length));
}catch(e){fail(e instanceof Error&&/^V2_EXPORT_[A-Z_]+$/.test(e.message)?e.message:'V2_EXPORT_LOCAL_VALIDATION_FAILED');}
