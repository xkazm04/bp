#!/usr/bin/env node
// Gate: every exported handler in src/app/api/**/route.ts opens with its localhost guard. GET -> localHost (or
// localOnly); POST/PATCH/PUT/DELETE -> localOnly, plus jsonOnly before any body parse. "Opens with" = the guard call
// is the first statement and is followed by `if (x) return`. scripts/check-local-only.ts tests the guard functions;
// this proves the routes call them. Exceptions below are known gaps (reported, and the check fails once one is fixed
// so the entry is removed). Exits 1 on any violation.
// Control: BP_ROUTE_GUARDS_MUTATE='[["scan/route.ts","localHost(req)","null"]]' rewrites route source as it is read
// ([path suffix, find, replace]); a built-in self-test also mutates every handler in memory and expects each to fail.
// Run: node scripts/check-route-guards.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments as strip } from './lib/source.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = path.join(ROOT, 'src/app/api');
const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];
const mutations = JSON.parse(process.env.BP_ROUTE_GUARDS_MUTATE || '[]');

// KNOWN GAPS - DECISION NEEDED (routes are outside tooling's write set). key: `<route path> <METHOD> <rule>`.
const KNOWN = {
  'products/route.ts GET localHost': 'TODO: GET() takes no request and lists registered roots without the Host check (DNS rebinding); take req and call localHost.',
  'products/route.ts POST jsonOnly': 'TODO: parses req.json() without the Content-Type check; add jsonOnly(req) -> 415 after localOnly.',
  'products/[slug]/route.ts PATCH jsonOnly': 'TODO: parses req.json() without the Content-Type check; add jsonOnly(req) -> 415 after localOnly.',
};

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name === 'route.ts' ? [path.join(d, e.name)] : []));
const matchClose = (s, i, open, close) => { // index of the bracket closing the one at s[i]
  for (let d = 0; i < s.length; i++) { if (s[i] === open) d++; else if (s[i] === close && --d === 0) return i; }
  return -1;
};

/** Exported handlers of a route source: [{ method, body }]. */
function handlers(src) {
  const out = [];
  for (const m of strip(src).matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\b/g)) {
    const code = strip(src), p = code.indexOf('(', m.index + m[0].length), pe = matchClose(code, p, '(', ')'), b = code.indexOf('{', pe);
    out.push({ method: m[1], body: code.slice(b + 1, matchClose(code, b, '{', '}')) });
  }
  return out;
}
const PARSE = /\b(?:req|request)\.(?:json|text|formData|arrayBuffer|blob)\s*\(/;

/** Violations of one handler: [rule]. */
function audit({ method, body }) {
  const bad = [];
  const need = method === 'GET' ? '(localHost|localOnly)' : '(localOnly)';
  const open = body.match(new RegExp(String.raw`^\s*const\s+(\w+)\s*=\s*${need}\(\s*\w+\s*\);?\s*if\s*\(\s*(\w+)\s*\)\s*return(?!\w)`));
  if (!open || open[1] !== open[3]) bad.push(method === 'GET' ? 'localHost' : 'localOnly');
  if (method !== 'GET' && PARSE.test(body)) {
    const j = body.search(/\bjsonOnly\s*\(/), p = body.search(PARSE);
    if (j < 0 || (open && j < open[0].length) || j > p) bad.push('jsonOnly');
  }
  return bad;
}

const files = walk(API);
let handlerCount = 0, ok = 0, known = 0, failures = [];
const seen = new Set();
for (const file of files) {
  const rel = path.relative(API, file).split(path.sep).join('/');
  let src = fs.readFileSync(file, 'utf8');
  for (const [suffix, find, repl] of mutations) if (rel.endsWith(suffix)) src = src.split(find).join(repl);
  const hs = handlers(src);
  if (!hs.length) failures.push(`${rel}: no exported handler found`);
  for (const h of hs) {
    handlerCount++;
    if (!METHODS.includes(h.method)) { failures.push(`${rel}: ${h.method} is not a method this check knows; add its rule`); continue; }
    const bad = audit(h);
    if (!bad.length) ok++;
    for (const rule of bad) {
      const key = `${rel} ${h.method} ${rule}`;
      if (KNOWN[key]) { known++; seen.add(key); console.log(`  KNOWN  ${key}\n         ${KNOWN[key]}`); } else failures.push(`${key}: handler must call ${rule} before any other work`);
    }
  }
}
for (const key of Object.keys(KNOWN)) if (!seen.has(key) && !mutations.length) failures.push(`${key}: listed as a known gap but now passes; remove it from KNOWN`);

// Self-test (seeded defects, in memory): dropping a handler's guard, or moving work ahead of it, must be caught.
let controls = 0;
for (const file of files) {
  const src = strip(fs.readFileSync(file, 'utf8'));
  for (const h of handlers(src)) {
    const g = h.body.match(/(localHost|localOnly)\(/);
    if (!g || audit(h).length) continue; // only handlers that pass today
    const dropped = { ...h, body: h.body.replace(/(localHost|localOnly)\(\s*\w+\s*\)/, 'null') };
    const late = { ...h, body: `const t0 = Date.now();\n${h.body}` };
    const noJson = /\bjsonOnly\s*\(/.test(h.body) ? { ...h, body: h.body.replace(/jsonOnly\(\s*\w+\s*\)/, 'null') } : null;
    for (const [what, m] of [['guard dropped', dropped], ['work before guard', late], ['jsonOnly dropped', noJson]]) {
      if (!m) continue;
      controls++;
      if (!audit(m).length) failures.push(`control: ${path.relative(API, file)} ${h.method} "${what}" was not caught`);
    }
  }
}

console.log(`${handlerCount} handlers in ${files.length} routes: ${ok} guarded, ${known} known gaps; ${controls} seeded-defect controls`);
if (failures.length) { console.error(`\nFAIL (${failures.length}):\n  ${failures.join('\n  ')}`); process.exit(1); }
