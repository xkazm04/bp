#!/usr/bin/env node
// Gate: every exported handler in packages/core/src/server/api/**/route.ts opens with its localhost guard. GET ->
// localHost (or localOnly); POST/PATCH/PUT/DELETE -> localOnly, plus jsonOnly before any body parse. "Opens with" = the
// guard call is the first statement and is followed by `if (x) return`. scripts/check-local-only.ts tests the guard
// functions; this proves the handlers call them. The handlers live in core so every mount runs the same guarded code:
// each apps/web/src/app/api/**/route.ts must be a thin mount (only `export { <methods> } from '@bp/core/server/api/
// <same path>/route'` plus Next's `runtime` / `dynamic` config) re-exporting exactly the core module's methods, and
// every core handler module must be mounted. Exceptions below are known gaps (reported, and the check fails once one is fixed
// so the entry is removed). Exits 1 on any violation.
// Control: BP_ROUTE_GUARDS_MUTATE='[["scan/route.ts","localHost(req)","null"]]' rewrites route source as it is read
// ([path suffix, find, replace]); a built-in self-test also mutates every handler in memory and expects each to fail.
// Run: node scripts/check-route-guards.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments as strip } from './lib/source.ts';
import { exportedMethods } from './lib/mounts.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = path.join(ROOT, 'packages/core/src/server/api');
const WEB_API = path.join(ROOT, 'apps/web/src/app/api');
const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];
const mutations = JSON.parse(process.env.BP_ROUTE_GUARDS_MUTATE || '[]');

// KNOWN GAPS (none today). key: `<route path> <METHOD> <rule>`: a gap listed here is reported, not failed.
const KNOWN = {};

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

// Thin mounts: a web route re-exports the core module at the same path and nothing else.
const MOUNT = /^\s*export\s*\{\s*([A-Z]+(?:\s*,\s*[A-Z]+)*)\s*\}\s*from\s*'([^']+)';?\s*((?:export\s+const\s+(?:runtime|dynamic)\s*=\s*'[\w-]+';?\s*)*)$/;
/** Problems of one mount source (comments stripped by the caller), against the core module's methods. */
function auditMount(code, rel, methods) {
  const m = MOUNT.exec(code), want = `@bp/core/server/api/${rel.replace(/\.ts$/, '')}`;
  if (!m) return ['is not a thin mount (only `export { METHODS } from \'' + want + '\'` and runtime/dynamic config)'];
  const bad = [];
  if (m[2] !== want) bad.push(`re-exports '${m[2]}', not '${want}'`);
  const got = m[1].split(',').map((x) => x.trim()).sort().join(','), need = [...methods].sort().join(',');
  if (got !== need) bad.push(`mounts ${got || 'nothing'} but the core handler exports ${need || 'nothing'}`);
  // Next's route-segment config is the one hand-typed field of a mount: every handler reads the filesystem (node:fs) and
  // the routes read live state, so each mount must say exactly these two, once each.
  const cfg = [...m[3].matchAll(/export\s+const\s+(runtime|dynamic)\s*=\s*'([\w-]+)'/g)].map((x) => x[1] + '=' + x[2]).sort().join(',');
  if (cfg !== 'dynamic=force-dynamic,runtime=nodejs') bad.push(`route config is ${cfg || 'absent'}, not runtime = 'nodejs' + dynamic = 'force-dynamic'`);
  return bad;
}
const webFiles = fs.existsSync(WEB_API) ? walk(WEB_API) : [];
const coreMethods = new Map(files.map((f) => [path.relative(API, f).split(path.sep).join('/'), exportedMethods(fs.readFileSync(f, 'utf8'))]));
let mounts = 0;
for (const file of webFiles) {
  const rel = path.relative(WEB_API, file).split(path.sep).join('/');
  mounts++;
  if (!coreMethods.has(rel)) { failures.push(`apps/web/src/app/api/${rel}: no core handler at packages/core/src/server/api/${rel}`); continue; }
  for (const b of auditMount(strip(fs.readFileSync(file, 'utf8')), rel, coreMethods.get(rel))) failures.push(`apps/web/src/app/api/${rel}: ${b}`);
}
for (const rel of coreMethods.keys()) if (!webFiles.some((f) => path.relative(WEB_API, f).split(path.sep).join('/') === rel)) failures.push(`packages/core/src/server/api/${rel}: not mounted by apps/web`);
// The UI contract's API table (docs/blueprint-ui.md) is the third mirror of the route set: every `VERB /api/...` row must
// name a live handler and every live handler must have a row. Path params are positional, so `[slug]` and `<slug>` both
// normalise to `*`. Comments are blanked by the caller's source: only table rows (`| `VERB /api/...` |`) count.
const routeKey = (verb, p) => `${verb} /api/${p.replace(/\[\.{0,3}[^\]]*\]|<[^>]*>/g, '*')}`;
/** Problems of the doc's route rows against the live `rel path -> methods` map. */
function auditDocRoutes(doc, live) {
  const want = new Set(), got = new Set(), bad = [];
  for (const [rel, ms] of live) for (const v of ms) want.add(routeKey(v, rel.replace(/\/?route\.ts$/, '')));
  for (const m of doc.matchAll(/^\|\s*`(GET|POST|PATCH|PUT|DELETE) \/api\/?([^`\s]*)`/gm)) got.add(routeKey(m[1], m[2]));
  for (const k of want) if (!got.has(k)) bad.push(`${k} is served but has no row in docs/blueprint-ui.md`);
  for (const k of got) if (!want.has(k)) bad.push(`${k} has a row in docs/blueprint-ui.md but no live handler`);
  return bad;
}
const DOC = path.join(ROOT, 'docs/blueprint-ui.md');
const docText = fs.readFileSync(DOC, 'utf8');
for (const b of auditDocRoutes(docText, coreMethods)) failures.push(b);
{ // the doc gate must bite: a deleted row and an invented row are each caught, and a row count is asserted (not a vacuous empty set)
  const rows = docText.split(/\r?\n/).filter((l) => /^\|\s*`(GET|POST|PATCH|PUT|DELETE) \/api/.test(l));
  controls++; if (rows.length < 30) failures.push(`control: only ${rows.length} route rows parsed out of the doc`);
  controls++; if (!auditDocRoutes(docText.replace(rows[0], ''), coreMethods).length) failures.push('control: a deleted doc row was not caught');
  controls++; if (!auditDocRoutes(docText + '\n| `GET /api/nonesuch` | x |\n', coreMethods).length) failures.push('control: an invented doc row was not caught');
}
// Mount controls: an inline handler, a wrong path and a missing method must each be caught.
{
  const rel = 'products/[slug]/scan/route.ts', spec = "'@bp/core/server/api/products/[slug]/scan/route'";
  for (const [what, code, methods] of [
    ['inline handler', `export async function GET(req: Request) { return new Response('x'); }\n`, ['GET']],
    ['wrong path', `export { GET } from '@bp/core/server/api/products/[slug]/scans/route';\n`, ['GET']],
    ['missing method', `export { GET } from ${spec};\nexport const runtime = 'nodejs';\nexport const dynamic = 'force-dynamic';\n`, ['GET', 'POST']],
    ['no directives', `export { GET } from ${spec};\n`, ['GET']],
    ['runtime edge', `export { GET } from ${spec};\nexport const runtime = 'edge';\nexport const dynamic = 'force-dynamic';\n`, ['GET']],
    ['force-static', `export { GET } from ${spec};\nexport const runtime = 'nodejs';\nexport const dynamic = 'force-static';\n`, ['GET']],
    ['one directive only', `export { GET } from ${spec};\nexport const runtime = 'nodejs';\n`, ['GET']],
    ['extra code', `export { GET } from ${spec};\nconsole.log('side effect');\n`, ['GET']],
  ]) { controls++; if (!auditMount(code, rel, methods).length) failures.push(`control: mount "${what}" was not caught`); }
  controls++; if (auditMount(`export { GET } from ${spec};\n\nexport const runtime = 'nodejs';\nexport const dynamic = 'force-dynamic';\n`, rel, ['GET']).length) failures.push('control: a clean mount was refused');
}

console.log(`${handlerCount} handlers in ${files.length} core routes: ${ok} guarded, ${known} known gaps; ${mounts} web mounts; ${controls} seeded-defect controls`);
if (failures.length) { console.error(`\nFAIL (${failures.length}):\n  ${failures.join('\n  ')}`); process.exit(1); }
