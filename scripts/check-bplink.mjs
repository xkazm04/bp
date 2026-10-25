#!/usr/bin/env node
// The BpLink contract (plan.md WP3.1): the UE client in apps/vr reads Kettle from apps/server with exactly these requests.
// Starts the headless server on a free port in an empty temp working directory (no products file) and makes them:
//   structure  GET /api/products/kettle/structure: 200 { structure, events, rev }; domains = structure.domains and lens
//              manifests = structure.lenses, both counted against packages/core/data, never hard-coded
//   plan       GET /api/products/kettle/plan: 200 { rev, lenses, wings, rooms, bays, tiles }, the levels VR draws (wing, room,
//              bay, tile): 5 wings, 13 rooms, 29 bays, 133 tiles today, derived from WING_DEFS and the data, never hard-coded.
//              BpLink asks for ?layout=islands (wings and rooms spaced apart; the geometry is scripts/check-plan-islands.mjs's):
//              the same plan but for its boxes, and any other `layout` answers the default body byte for byte
//   events     the event log BpLink reads is that payload's `events` string (JSONL), line for line the data file's
//   stream     GET /api/products/kettle/stream answers SSE (apps/server hosts Kettle's sims, L5.2): the first event is a `snapshot`
//              of the sample (its findings as `proposals`); `delta` and `jobs` follow a scan (scripts/check-kettle-sim.mjs)
//   schema     the structure, plan, first stream frame and waves bodies conform to structure-envelope-1, plan-1 and scan-wire-1
//              (packages/schema/schema, via ajv), and each validator is shown to refuse one broken copy of the same body
// Pins the server's current answers; it changes no route. A gap BpLink must live with is asserted as it is, not papered over.
//
// `npm run check` cannot compile BpLink (no Unreal toolchain here, apps/vr/WP3.1.md), so the last block derives what it can
// [Correction 2026-10-22: "no Unreal toolchain here" is out of date for Lynx, which has UE 5.8.4 and has built BpLink in
// scripts/uht-probe.mjs's project outside the repo (docs/concepts/vr-light-table/machine.md). The reason stands in another
// form: that build needs an engine install and minutes, and is wired to no gate, so `npm run check` still cannot compile it.]
// from the C++ TEXT instead: the /stream status codes `BpLink.cpp` branches on must include the one the live server just
// answered, and `BpLink.cpp` must request /plan, parse it into FBpPlan and log wings/rooms/bays/tiles from the plan's own
// arrays, so the logged figures are the live /plan answer's counts. Comments (and, where the assertion is not about a
// literal, string literals) are stripped first, or a file that only TALKS about a status or a request would pass.
// Run: node scripts/check-bplink.mjs   Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv2020Module from 'ajv/dist/2020.js';
import { WING_DEFS } from '../packages/core/src/model/constants.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'packages/core/data');
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };

/**
 * C++ with its comments blanked out, and its string literals too unless `keepStrings` is set, so a matcher sees only
 * code. A `//` inside a string (`TEXT("http://127.0.0.1:3100")`) is not a comment, so strings are consumed before
 * comments are recognised either way. Newlines survive, so a line number taken from the result still points at the
 * source. Keep the strings only when the assertion is ABOUT a literal (a log's format string); drop them otherwise, or
 * a file that merely quotes the rule reads as compliant.
 */
export function stripCxx(text, keepStrings = false) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const two = text.slice(i, i + 2);
    if (two === '//') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (two === '/*') { const end = text.indexOf('*/', i + 2); const body = text.slice(i, end < 0 ? text.length : end + 2); out += body.replace(/[^\n]/g, ' '); i += body.length - 1; continue; }
    if (text[i] === '"' || text[i] === "'") {
      const q = text[i]; out += q; i++;
      for (; i < text.length && text[i] !== q; i++) { out += keepStrings ? text[i] : text[i] === '\n' ? '\n' : ' '; if (text[i] === '\\') { i++; out += keepStrings ? text[i] : ' '; } }
      out += q; continue;
    }
    out += text[i];
  }
  return out;
}

/** [start, end) of the first `{ ... }` at or after `from`, on text whose comments and strings are already blanked. */
export function braceSpan(code, from = 0) {
  const open = code.indexOf('{', from);
  if (open < 0) return null;
  for (let i = open, depth = 0; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return [open, i + 1];
  }
  return null;
}

/**
 * The warnings in BpLink.cpp's ReadEvents: how many sit inside the per-line loop with no `if (counter < cap)` in front of
 * them (each would fire once per bad line, so up to one per events line), and how many follow the loop and carry two or
 * more %d (a "N of M" summary). `code` is stripCxx(text) and `lit` is stripCxx(text, true): same length, so an index
 * into one is an index into the other. Null when the function or its loop is not found.
 */
export function readEventsReport(code, lit) {
  const fn = /\bvoid\s+ReadEvents\s*\(/.exec(code);
  const body = fn && braceSpan(code, fn.index + fn[0].length);
  const loop = body && /\bfor\s*\(/.exec(code.slice(body[0], body[1]));
  const loopBody = loop && braceSpan(code, body[0] + loop.index + loop[0].length);
  if (!loopBody) return null;
  let unguarded = 0, summaries = 0;
  for (const m of code.matchAll(/UE_LOG\s*\(\s*LogBpLink\s*,\s*Warning\b/g)) {
    if (m.index < body[0] || m.index >= body[1]) continue;
    if (m.index >= loopBody[0] && m.index < loopBody[1]) {
      const from = Math.max(code.lastIndexOf(';', m.index), code.lastIndexOf('}', m.index)) + 1;
      if (!/\bif\s*\([^)]*<=?[^)]*\)\s*\{?\s*$/.test(code.slice(from, m.index))) unguarded++;
    } else if (m.index >= loopBody[1]) {
      const fmt = /TEXT\("((?:[^"\\]|\\.)*)"\)/.exec(lit.slice(m.index, m.index + 400))?.[1] ?? '';
      if ((fmt.match(/%d/g) ?? []).length >= 2) summaries++;
    }
  }
  return { unguarded, summaries };
}

/**
 * What each `BindLambda([...])` in BpLink.cpp captures BY COPY from the named variable: a bare `Name`, or a default `=`
 * capture, which copies everything it mentions. `Name = MoveTemp(Name)` and `Name = Name` are init-captures and are read
 * as what they are: only the MoveTemp form is a move. `code` is stripCxx(text).
 */
export function copiedCaptures(code, name) {
  const out = [];
  for (const m of code.matchAll(/BindLambda\s*\(\s*\[([^\]]*)\]/g)) {
    for (const raw of m[1].split(',')) {
      const c = raw.trim();
      if (c === name || c === '=') out.push(c);
      else if (c.startsWith(name) && /^\w+\s*=/.test(c) && c.replace(/\s+/g, '') !== `${name}=MoveTemp(${name})`) out.push(c);
    }
  }
  return out;
}

/**
 * What FBpLinkSnapshot::StreamStatus can say, read off the C++: the value a snapshot starts with (the "never asked" state,
 * which the structure-failure early return also hands back), the value the stream callback assigns when the request did not
 * connect (the `: N` arm of its ternary), and the text of the warning branch that handles that value. The two numbers must
 * differ and the branch must not claim the server "answered". `header` and `code` are stripCxx(text); `lit` is
 * stripCxx(cppText, true), the same length as `code`. Fields are null when not found.
 */
export function streamStateReport(header, code, lit) {
  const initial = /\bint32\s+StreamStatus\s*=\s*(-?\d+)/.exec(header)?.[1];
  const noConnect = /StreamStatus\s*=[^;]*\?[^;]*:\s*(-?\d+)\s*;/.exec(code)?.[1];
  let message = null;
  for (const m of code.matchAll(/StreamStatus\s*==\s*(-?\d+)\s*\)\s*\{?\s*UE_LOG/g)) {
    if (m[1] !== noConnect) continue;
    message = /TEXT\("((?:[^"\\]|\\.)*)"\)/.exec(lit.slice(m.index, m.index + 400))?.[1] ?? null;
  }
  return { initial: initial === undefined ? null : Number(initial), noConnect: noConnect === undefined ? null : Number(noConnect), message };
}

/**
 * Every include-path entry a Build.cs adds in CODE (Public/Private[System]IncludePaths.Add or .AddRange), comments
 * stripped, as the matched call text. BpLink must add none: its one path to the generated headers is the Public/Schema
 * junction, and a second path to the same file breaks #pragma once (machine.md, Lynx readings 4-5).
 */
export function includePathAdds(build) {
  return [...stripCxx(build).matchAll(/\b(?:Public|Private)(?:System)?IncludePaths\s*\.\s*Add(?:Range)?\s*\(/g)].map((m) => m[0]);
}

/**
 * The junction apps/vr/tools/link-schema.ps1 makes, read out of its `$LinkRel = '...'` and `$TargetRel = '...'` lines
 * (repo-relative, returned with `/` separators) rather than retyped, so a check that resolves them fails when the script
 * and the check disagree. null when either line is missing.
 */
export function junctionSpec(ps1) {
  const read = (name) => new RegExp(`^\\s*\\$${name}\\s*=\\s*'([^']+)'`, 'm').exec(ps1)?.[1]?.replace(/\\/g, '/');
  const link = read('LinkRel'), target = read('TargetRel');
  return link && target ? { link, target } : null;
}

// The payload schemas, all six registered under their $id so structure-envelope-1's relative $ref to app-structure-3 resolves.
// Same ajv options as scripts/validate-structure.mjs and packages/schema/generate.mjs (strict, allowUnionTypes).
const SCHEMA_DIR = path.join(ROOT, 'packages/schema/schema');
const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
for (const f of fs.readdirSync(SCHEMA_DIR).filter((n) => n.endsWith('.schema.json'))) ajv.addSchema(JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, f), 'utf8')));
const PAYLOAD_SCHEMAS = { envelope: 'structure-envelope-1', plan: 'plan-1', islands: 'plan-1', snapshot: 'scan-wire-1', waves: 'scan-wire-1' };
const PAYLOAD_LABEL = { envelope: '/structure body', plan: '/plan body', islands: '/plan?layout=islands body', snapshot: '/stream snapshot frame', waves: '/waves body' };
// One break per payload, applied to a copy of the live body. scan-wire-1's root takes one property per frame name, so a
// stream frame is validated as { snapshot: <data> } and the waves answer as { waves }.
const WRONG = {
  envelope: (b) => { const c = structuredClone(b); delete c.events; return c; },
  plan: (b) => { const c = structuredClone(b); const h = c.tiles?.[0]?.health; if (h) h[Object.keys(h)[0]] = 'purple'; else c.tiles = [{}]; return c; },
  islands: (b) => { const c = structuredClone(b); if (c.wings?.[0]?.box) delete c.wings[0].box.h; else c.wings = [{}]; return c; },
  snapshot: (b) => { const c = structuredClone(b); c.snapshot = { ...(c.snapshot ?? {}), runs: 'not-an-array' }; return c; },
  waves: (b) => ({ ...structuredClone(b), waves: [{}] }),
};
const WRONG_WHAT = { envelope: '`events` omitted', plan: 'a health value that is no status', islands: 'a wing box with no height', snapshot: '`runs` that is not an array', waves: 'a wave with no fields' };
/** '' when `body` conforms to the named schema, else ajv's first errors as one string. */
export function payloadErrors(schema, body) {
  const validate = ajv.getSchema(`https://app-structure.example/schema/${schema}.schema.json`);
  if (!validate) return `schema ${schema} is not registered`;
  return validate(body) ? '' : (validate.errors ?? []).slice(0, 3).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
}

/**
 * plan-1's cross-field rule, which a JSON Schema cannot state: `lenses` are "the keys of every tile's health". Returns the
 * disagreements as strings ([] when it holds): the plan's lens list against the declared registry's ids (`registryIds`,
 * read from the data file by the caller, never typed here), then each tile's health keys as a SET against that list, in
 * both directions (a missing key reads as 'unmeasured' on the web, a default on the VR side; an extra one is read by nobody).
 */
export function planLensProblems(plan, registryIds) {
  const out = [];
  const lenses = Array.isArray(plan?.lenses) ? plan.lenses : null;
  if (!lenses || !Array.isArray(plan?.tiles)) return ['plan has no lenses array or no tiles array'];
  if (JSON.stringify(lenses) !== JSON.stringify(registryIds)) out.push(`plan.lenses [${lenses}] is not the registry's [${registryIds}]`);
  const want = new Set(lenses);
  for (const t of plan.tiles) {
    const got = new Set(Object.keys(t?.health ?? {}));
    const missing = [...want].filter((l) => !got.has(l)), extra = [...got].filter((l) => !want.has(l));
    if (missing.length || extra.length) out.push(`tile ${t?.id}: health lacks [${missing}] and has unlisted [${extra}]`);
  }
  return out;
}

const PLAN_LEVELS = ['wings', 'rooms', 'bays', 'tiles'];
/** The /plan request BpLink makes: the islands view, the table's layout (plan-projection's WING_GAP, ROOM_GAP). */
const PLAN_ASK = '/plan?layout=islands';

/** The labelled figures of the first `UE_LOG(LogBpLink, ...)` whose format string carries `<label>=%`: { label: argument
 * expression, whitespace removed }. `code` is stripCxx(text) and `lit` is stripCxx(text, true), the same length, so the
 * arguments are split on `code`, where a comma inside a string literal is already blanked. Null when no such line. */
export function loggedFigures(code, lit, label) {
  for (const m of lit.matchAll(/UE_LOG\s*\(\s*LogBpLink\s*,\s*\w+\s*,\s*TEXT\("((?:[^"\\]|\\.)*)"\)/g)) {
    if (!m[1].includes(`${label}=%`)) continue;
    const args = [];
    let depth = 0, cur = '';
    for (let i = m.index + m[0].length; i < code.length; i++) {
      const c = code[i];
      if (c === '(') depth++;
      else if (c === ')' && depth-- === 0) break;
      if (c === ',' && depth === 0) { args.push(cur); cur = ''; } else cur += c;
    }
    args.push(cur);
    const specs = [...m[1].matchAll(/(?:(\w+)=)?%(?!%)[-+ #0-9.]*[a-zA-Z]/g)].map((s) => s[1] ?? null);
    const out = {};
    specs.forEach((name, i) => { if (name) out[name] = (args[i + 1] ?? '').replace(/\s+/g, ''); });
    return out;
  }
  return null;
}

/**
 * What is wrong with BpLink.cpp's use of GET .../plan ([] when nothing): it must request `<Root> + TEXT("/plan?layout=islands")` with an
 * application/json Accept in CODE (a comment naming it does not count), parse the answer into the snapshot's FBpPlan through
 * BpSchema::FromJson, and log a line whose wings/rooms/bays/tiles are each `Snapshot.Plan.<that level>.Num()`, so each
 * logged figure is the live answer's count for the level it names. `plan` is the live /plan body, for the counts.
 */
export function planProblems(cppText, plan) {
  const code = stripCxx(cppText), lit = stripCxx(cppText, true);
  const out = [];
  if (!/MakeGet\s*\(\s*Root\s*\+\s*TEXT\("\/plan\?layout=islands"\)\s*,\s*TEXT\("application\/json"\)\s*\)/.test(lit)) out.push(`no GET <Root>${PLAN_ASK} request with Accept: application/json`);
  if (!/BpSchema::FromJson\s*\([^;]*,\s*Snapshot\.Plan\s*\)/.test(code)) out.push('the /plan answer is not parsed into Snapshot.Plan (FBpPlan) through BpSchema::FromJson');
  const figs = loggedFigures(code, lit, 'wings');
  if (!figs) return [...out, 'no LogBpLink line logs wings='];
  for (const level of PLAN_LEVELS) {
    const src = /^Snapshot\.Plan\.(\w+)\.Num\(\)$/.exec(figs[level] ?? '')?.[1];
    if (src !== level) out.push(`${level}= logs ${figs[level] ?? 'nothing'} (${src ? `${plan?.[src]?.length} live` : 'not a plan array'}), not the plan's ${level} (${plan?.[level]?.length} live)`);
  }
  return out;
}

/**
 * What is wrong with how BpLink.cpp reports a refused /structure answer ([] when nothing). Reading 10 (machine.md) got one
 * line for four possible failures; the source must keep them apart: a reason set in its own branch for each of
 * FJsonSerializer::Deserialize, the `structure` field and BpSchema::FromJson (which reads BpSchema::LastFailure() for the
 * call and key), and Error lines that log that reason and the answer's length and first 200 characters. Read between
 * the /structure and /plan requests, on code with comments stripped (string literals kept where the subject is one).
 */
export function structureDiagProblems(cppText) {
  const code = stripCxx(cppText), lit = stripCxx(cppText, true);
  const from = lit.indexOf('TEXT("/structure")'), to = lit.indexOf('TEXT("/plan');
  if (from < 0 || to < from) return ['no /structure request before the /plan one'];
  const c = code.slice(from, to), l = lit.slice(from, to), out = [];
  if (!/\bif\s*\(\s*!FJsonSerializer::Deserialize\([^;{]*\)\s*\{\s*Refused\s*=/.test(c)) out.push('no branch of its own for FJsonSerializer::Deserialize');
  if (!/\belse\s+if\s*\(\s*!Payload->TryGetObjectField\(TEXT\("structure"\)[^;{]*\)\s*\{\s*Refused\s*=/.test(l)) out.push('no branch of its own for the `structure` field');
  if (!/\belse\s+if\s*\(\s*!BpSchema::FromJson\([^;{]*\)\s*\{[^}]*BpSchema::LastFailure\(\)[^}]*Refused\s*=/.test(c)) out.push('no branch of its own for BpSchema::FromJson that reads BpSchema::LastFailure()');
  if (!/UE_LOG\s*\(\s*LogBpLink\s*,\s*Error\s*,\s*TEXT\("[^"]*did not parse into FBpAppStructure: %s"\)\s*,\s*\*Root\s*,\s*\*Refused\s*\)/.test(l)) out.push('no Error line that logs the reason');
  if (!/UE_LOG\s*\(\s*LogBpLink\s*,\s*Error\s*,[^;]*GetContent\(\)\.Num\(\)[^;]*\.Left\(200\)/.test(c)) out.push("no Error line with the answer's byte length and first 200 characters");
  return out;
}

/** True when this file was started directly (`node scripts/check-bplink.mjs`), false when another module imported it for its helpers. */
const isMain = !!process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

async function main() {
  const kdata = JSON.parse(fs.readFileSync(path.join(DATA, 'kettle.app-structure.json'), 'utf8'));
  const lines = (s) => s.split('\n').filter((l) => l.trim());
  const wantEvents = lines(fs.readFileSync(path.join(DATA, 'kettle.events.jsonl'), 'utf8'));
  // BP_CHECK_BPLINK_WINGS seeds a wrong expectation (of the domain count), to show the smoke can fail.
  // BP_CHECK_BPLINK_SEED=schema:envelope|schema:plan|schema:islands|schema:snapshot|schema:waves breaks the live body before it is validated against its schema.
// BP_CHECK_BPLINK_SEED=plan,lenses,events does the same for the other derived figures, one or several at once: each adds 1
  // to that expectation, and the run must then FAIL on exactly that assertion (an expectation that survives its own seed is
  // not pinning anything). Unset, nothing changes.
  // BP_CHECK_BPLINK_SEED=source:plan drifts an in-memory copy of BpLink.cpp before the /plan source assertion reads it (the
  // wings figure is fed from Plan.rooms), and that assertion must then FAIL. The file on disk is not touched.
  // BP_CHECK_BPLINK_SEED=source:diag does the same for the /structure diagnosis assertion (its FromJson branch stops reading
  // BpSchema::LastFailure()), which must then FAIL.
  const seeded = new Set((process.env.BP_CHECK_BPLINK_SEED ?? '').split(',').filter(Boolean));
  const seedBy = (key) => (seeded.has(key) ? 1 : 0);
  const wantDomains = Number(process.env.BP_CHECK_BPLINK_WINGS ?? kdata.domains.length);
  const wantPlan = {
    wings: WING_DEFS.filter((w) => kdata.domains.some((d) => w.doms.includes(d.slug))).length, rooms: kdata.domains.length,
    bays: kdata.capabilities.length, tiles: kdata.features.length + seedBy('plan'),
  };
  const wantLenses = kdata.lenses.length + seedBy('lenses');
  const wantEventLines = wantEvents.length + seedBy('events');

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-bplink-'));
  const child = spawn(process.execPath, ['--import', pathToFileURL(path.join(ROOT, 'packages/core/register.mjs')).href, path.join(ROOT, 'apps/server/src/main.ts'), '--port', '0'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const port = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(0), 20000);
    const look = () => { const m = /listening on http:\/\/[^:]+:(\d+)/.exec(out); if (m) { clearTimeout(t); resolve(Number(m[1])); } };
    child.stdout.on('data', look);
    child.on('exit', () => { clearTimeout(t); resolve(0); });
  });

  const get = (p, headers = {}) => new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      let s = ''; res.on('data', (d) => (s += d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: s }));
    });
    r.on('error', (e) => resolve({ status: 0, headers: {}, body: e.message }));
    r.end();
  });

  /** A GET that ends at the first SSE event (or the body's end). */
  const firstEvent = (p) => new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: { host: `localhost:${port}`, accept: 'text/event-stream' } }, (res) => {
      let s = ''; res.setEncoding('utf8');
      const done = () => resolve({ status: res.statusCode, headers: res.headers, body: s });
      res.on('data', (d) => { s += d; if (s.includes('\n\n')) { r.destroy(); done(); } });
      res.on('end', done);
    });
    r.on('error', (e) => resolve({ status: 0, headers: {}, body: e.message }));
    r.end();
  });

  try {
    check('the server starts and prints its port', port > 0, out.trim().split('\n').slice(-5).join(' | '));
    if (port > 0) {
      const ks = await get('/api/products/kettle/structure', { accept: 'application/json' });
      let kb = null; try { kb = JSON.parse(ks.body); } catch { /* reported below */ }
      check('structure: 200 JSON', ks.status === 200 && /json/.test(String(ks.headers['content-type'])), `${ks.status} ${ks.headers['content-type']}`);
      check('structure: { structure, events, rev }', !!kb?.structure && typeof kb.structure === 'object' && typeof kb.events === 'string' && typeof kb.rev === 'string' && kb.rev.length > 0, ks.body.slice(0, 80));
      check(`structure: ${wantDomains} domains in structure.domains (packages/core/data)`, kb?.structure?.domains?.length === wantDomains && wantDomains > 0, `${kb?.structure?.domains?.length}`);
      check(`structure: ${wantLenses} lens manifests in structure.lenses (packages/core/data)`, kb?.structure?.lenses?.length === wantLenses && wantLenses > 0, `${kb?.structure?.lenses?.length}`);

      const kp = await get('/api/products/kettle/plan', { accept: 'application/json' });
      let pb = null; try { pb = JSON.parse(kp.body); } catch { /* reported below */ }
      check('plan: 200 JSON', kp.status === 200 && /json/.test(String(kp.headers['content-type'])), `${kp.status} ${kp.headers['content-type']}`);
      const gotPlan = { wings: pb?.wings?.length, rooms: pb?.rooms?.length, bays: pb?.bays?.length, tiles: pb?.tiles?.length };
      check(`plan: ${wantPlan.wings} wings, ${wantPlan.rooms} rooms, ${wantPlan.bays} bays, ${wantPlan.tiles} tiles (WING_DEFS and packages/core/data)`, JSON.stringify(gotPlan) === JSON.stringify(wantPlan) && wantPlan.wings > 0, JSON.stringify(gotPlan));
      check('plan: rev equals the structure rev', typeof pb?.rev === 'string' && pb.rev === kb?.rev, `${pb?.rev} vs ${kb?.rev}`);
      // The islands view BpLink asks for: the same plan-1 body but for its boxes, and only `layout=islands` asks for it.
      const ki = await get(`/api/products/kettle${PLAN_ASK}`, { accept: 'application/json' });
      let ib = null; try { ib = JSON.parse(ki.body); } catch { /* reported below */ }
      const unboxed = (b) => JSON.stringify(b, (k, v) => (k === 'box' ? undefined : v));
      check(`plan: ${PLAN_ASK} answers 200 JSON, the default plan but for its boxes, and moves boxes`,
        ki.status === 200 && !!ib && unboxed(ib) === unboxed(pb) && JSON.stringify(ib) !== JSON.stringify(pb), `${ki.status} ${ki.body.slice(0, 80)}`);
      const kg = await get('/api/products/kettle/plan?layout=grid', { accept: 'application/json' });
      check('plan: any other layout value answers the default body byte for byte', kg.status === 200 && kg.body === kp.body, `${kg.status} ${kg.body.length} vs ${kp.body.length} bytes`);
      check('plan: every tile carries a box and a health for each of the plan lenses', !!pb?.tiles?.length && Array.isArray(pb.lenses) && pb.lenses.length > 0 && pb.tiles.every((t) => typeof t.box?.x === 'number' && pb.lenses.every((l) => typeof t.health?.[l] === 'string')), `${pb?.lenses?.length} lenses`);

      // plan-1's lenses/health rule, on the live answer, against the registry in the data file. BP_CHECK_BPLINK_SEED=
      // lens:extra|lens:missing|lens:renamed breaks a copy of the body first, and the line must then FAIL.
      const lensPlan = structuredClone(pb ?? {});
      if (seeded.has('lens:extra') && lensPlan.tiles?.[0]?.health) lensPlan.tiles[0].health['not-a-lens'] = 'good';
      if (seeded.has('lens:missing') && lensPlan.tiles?.[0]?.health) delete lensPlan.tiles[0].health[Object.keys(lensPlan.tiles[0].health)[0]];
      if (seeded.has('lens:renamed') && Array.isArray(lensPlan.lenses)) lensPlan.lenses = lensPlan.lenses.map((l, i) => (i ? l : `${l}-renamed`));
      const lensBad = planLensProblems(lensPlan, kdata.lenses.map((l) => l.id));
      check('plan: plan.lenses is the registry lens ids and every tile health keys are exactly that set (plan-1 prose rule)', lensBad.length === 0, lensBad.slice(0, 2).join(' | '));
      // permanent control: the helper refuses each of the three breaks on a copy of the live body
      const ids = kdata.lenses.map((l) => l.id);
      const brk = (fn) => { const c = structuredClone(pb ?? {}); fn(c); return planLensProblems(c, ids).length > 0; };
      check('plan: the lens rule refuses an unlisted health key, a missing one, and a renamed plan lens',
        brk((c) => { c.tiles[0].health['not-a-lens'] = 'good'; }) && brk((c) => { delete c.tiles[0].health[ids[0]]; }) && brk((c) => { c.lenses[0] += '-renamed'; }));

      const evs = lines(kb?.events ?? '');
      let parsed = true; for (const l of evs) { try { JSON.parse(l); } catch { parsed = false; } }
      check(`events: the payload's JSONL has the data file's ${wantEventLines} lines, each valid JSON`, evs.length === wantEventLines && wantEventLines > 0 && parsed, `${evs.length} lines, parsed=${parsed}`);

      const st = await firstEvent('/api/products/kettle/stream');
      const m = /^event: (\w+)\ndata: (.*)$/m.exec(st.body);
      let sd = null; try { sd = JSON.parse(m?.[2] ?? ''); } catch { /* reported below */ }
      check('stream: 200 text/event-stream', st.status === 200 && /text\/event-stream/.test(String(st.headers['content-type'])), `${st.status} ${st.headers['content-type']}`);
      check('stream: the first event is a snapshot with the sample findings (proposals) and every scan table', m?.[1] === 'snapshot' && Array.isArray(sd?.proposals) && sd.proposals.length > 0 && ['runs', 'measurements', 'activity'].every((t) => Array.isArray(sd?.[t])), `${m?.[1]} ${st.body.slice(0, 80)}`);
      const again = await get('/api/products/kettle/structure');
      let ab = null; try { ab = JSON.parse(again.body); } catch { /* reported below */ }
      check('rev: stable across reads (a fallback that reads it once can trust it)', !!ab?.rev && ab.rev === kb?.rev, `${kb?.rev} vs ${ab?.rev}`);

      // The three payload schemas (structure-envelope-1, plan-1, scan-wire-1) describe exactly these bodies, and the VR client
      // has no validator of its own, so the bodies held above are validated against them: a route that answers a shape its
      // own schema forbids is red here, not a surprise in Unreal. The waves answer is scan-wire-1's `waves` property.
      const waves = await get('/api/products/kettle/waves', { accept: 'application/json' });
      let wb = null; try { wb = JSON.parse(waves.body); } catch { /* reported below */ }
      const live = { envelope: kb ?? {}, plan: pb ?? {}, islands: ib ?? {}, snapshot: { snapshot: sd }, waves: wb ?? {} };
      for (const [key, schema] of Object.entries(PAYLOAD_SCHEMAS)) {
        const body = seeded.has(`schema:${key}`) ? WRONG[key](live[key]) : live[key];
        const bad = payloadErrors(schema, body);
        check(`schema: the live ${PAYLOAD_LABEL[key]} conforms to ${schema}`, bad === '', bad);
        // permanent control: a copy of the same live body, broken one way, must be refused (a validator that accepts
        // everything would make the line above vacuous)
        check(`schema: ${schema} refuses a ${PAYLOAD_LABEL[key]} with ${WRONG_WHAT[key]}`, payloadErrors(schema, WRONG[key](live[key])) !== '');
      }

      // Derived over the C++ source, because no rung above it is reachable: this repo has no Unreal toolchain, so the
      // module cannot be compiled, let alone run against the server. Stripping comments and string literals first is what
      // makes it a check on the CODE and not on the prose beside it.
      const cpp = stripCxx(fs.readFileSync(path.join(ROOT, 'apps/vr/Source/BpLink/Private/BpLink.cpp'), 'utf8'));
      const pinned = [...cpp.matchAll(/StreamStatus\s*==\s*(\d{3})/g)].map((m) => Number(m[1]));
      check(`source: BpLink.cpp branches on the /stream status the server answers (${st.status})`, pinned.includes(st.status),
        `BpLink.cpp accepts [${pinned.join(', ')}], the server answered ${st.status}`);

      // ReadEvents is forgiving by design (a bad line is skipped, never fatal), so the REPORT is what is pinned: a payload
      // whose every line fails (a format change, a truncated body) must produce a count and a few samples, not one Warning
      // per line (566 of them for Kettle) with no total. Derived over the text because there is no UE run to corrupt a payload.
      const cppText = fs.readFileSync(path.join(ROOT, 'apps/vr/Source/BpLink/Private/BpLink.cpp'), 'utf8');
      const rep = readEventsReport(stripCxx(cppText), stripCxx(cppText, true));
      check(`source: ReadEvents' per-line warning is capped (0 unguarded in the loop) and a "skipped N of M" summary follows it`,
        !!rep && rep.unguarded === 0 && rep.summaries >= 1, rep ? `${rep.unguarded} unguarded warnings in the loop, ${rep.summaries} summaries after it` : 'ReadEvents or its loop not found');

      // The parsed snapshot carries the whole events array (566 entries here). The stream continuation must take it by MOVE:
      // a by-value capture copies the array a second time per fetch. No UE build or profiler exists to time it, so the
      // capture list is what is read, and it is the thing that decides the copy.
      const copies = copiedCaptures(stripCxx(cppText), 'Snapshot');
      check('source: no BindLambda in BpLink.cpp copies Snapshot into its capture list (it is moved in)', copies.length === 0, `copied captures: ${copies.join(' | ')}`);

      // StreamStatus must tell "never asked" (default, and the structure-failure early return) from "asked and nothing
      // answered" (the stream request did not connect); one value for both made the log say the server "answered 0".
      // Five outcomes reach a caller: structure failed, stream unreachable, 200, 405, any other status. They are told apart
      // by StreamStatus alone when the first two differ.
      const headerText = stripCxx(fs.readFileSync(path.join(ROOT, 'apps/vr/Source/BpLink/Public/BpLink.h'), 'utf8'));
      const ss = streamStateReport(headerText, stripCxx(cppText), stripCxx(cppText, true));
      const outcomes = [ss.initial, ss.noConnect, 200, 405, 'another status'];
      const told = new Set(outcomes.filter((v) => v !== null)).size;
      check(`source: StreamStatus tells ${outcomes.length} outcomes apart (never asked ${ss.initial}, no connection ${ss.noConnect}), ${told} distinct`,
        ss.initial !== null && ss.noConnect !== null && told === outcomes.length, `initial=${ss.initial} noConnect=${ss.noConnect}`);
      check('source: the warning for a stream that did not connect does not say the server "answered"',
        ss.message !== null && !/answered/i.test(ss.message), ss.message === null ? 'no branch on the no-connection value' : ss.message);

      // The level names are the plan route's: structure.domains are DOMAINS, which are Kettle's rooms (13 here) but a live
      // product's wings (a live product draws one room per capability). A log line that labels the domain count "rooms"
      // or "wings" reports a number that is right for one product and wrong for another, so every line that logs it calls
      // it "domains". The format string is the subject of this assertion, so string literals are kept and only comments
      // are stripped.
      const lit = stripCxx(fs.readFileSync(path.join(ROOT, 'apps/vr/Source/BpLink/Private/BpLink.cpp'), 'utf8'), true);
      const calls = [...lit.matchAll(/UE_LOG\((?:(?!UE_LOG\()[\s\S])*?Structure\.domains\.Num\(\)[\s\S]*?\);/g)].map((m) => m[0]);
      const labels = calls.map((c) => /(\w+)=%d/.exec(/TEXT\("((?:[^"\\]|\\.)*)"\)/.exec(c)?.[1] ?? '')?.[1]);
      check(`source: every count BpLink logs from structure.domains (${calls.length} lines) is labelled "domains" (${wantDomains}), not "rooms" (${wantPlan.rooms}) or "wings" (${wantPlan.wings})`,
        labels.length >= 2 && labels.every((l) => l === 'domains'), `BpLink.cpp labels them ${JSON.stringify(labels)}; domains=${wantDomains}, wings=${wantPlan.wings}, rooms=${wantPlan.rooms}`);

      // WP3.1's acceptance is the WING count, which only GET .../plan carries. BpLink.cpp must make that request, parse it
      // into FBpPlan, and feed each labelled level of its summary line from the plan's own array of that level, so the
      // figures it logs are the live /plan answer's counts (read off pb, never typed here). The seed drifts a copy.
      const planText = seeded.has('source:plan') ? cppText.replace('Snapshot.Plan.wings.Num()', 'Snapshot.Plan.rooms.Num()') : cppText;
      const planBad = planProblems(planText, pb);
      const liveCounts = PLAN_LEVELS.map((l) => `${l}=${pb?.[l]?.length}`).join(' ');
      check(`source: BpLink.cpp requests GET .../plan, parses it into FBpPlan and logs its wings/rooms/bays/tiles from the plan (live /plan: ${liveCounts})`,
        planBad.length === 0, planBad.join(' | '));
      // permanent control: the helper refuses a copy with no /plan request, one whose request survives only in a comment,
      // and one whose wings figure is fed from another level
      const noPlanGet = cppText.replace(`TEXT("${PLAN_ASK}")`, 'TEXT("/structure")');
      check('source: the /plan rule refuses a BpLink.cpp with no /plan request, one that names it only in a comment, one that asks the default (not islands) plan, and a drifted wings figure',
        planProblems(noPlanGet, pb).length > 0
        && planProblems(`// MakeGet(Root + TEXT("${PLAN_ASK}"), TEXT("application/json"))\n${noPlanGet}`, pb).length > 0
        && planProblems(cppText.replace(`TEXT("${PLAN_ASK}")`, 'TEXT("/plan")'), pb).length > 0
        && planProblems(cppText.replace('Snapshot.Plan.wings.Num()', 'Snapshot.Plan.rooms.Num()'), pb).length > 0);

      // A refused /structure answer names the step that refused it (machine.md, reading 12 measured it as CopyRaw at
      // structure.lenses[0].manifest.presentation.glyph). The seed drops the FromJson branch's LastFailure() read.
      const diagText = seeded.has('source:diag') ? cppText.replace(/const BpSchema::FFromJsonFailure& Failure = BpSchema::LastFailure\(\);(\s*Refused)/, 'const BpSchema::FFromJsonFailure Failure;$1') : cppText;
      const diagBad = structureDiagProblems(diagText);
      check('source: a refused /structure answer is told apart as Deserialize, the `structure` field or FromJson (with its LastFailure() call and key), and logged with its length and head',
        diagBad.length === 0, diagBad.join(' | '));
      // permanent control: the one-condition shape reading 10 ran (ba4e759) is refused
      const oneLine = '\tStructure->OnProcessRequestComplete().BindLambda([](FHttpRequestPtr, FHttpResponsePtr Response, bool) {\n'
        + '\t\tif (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Response->GetContentAsString()), Payload) || !Payload.IsValid()\n'
        + '\t\t\t|| !Payload->TryGetObjectField(TEXT("structure"), StructureJson) || !BpSchema::FromJson(StructureJson->ToSharedRef(), Snapshot.Structure))\n'
        + '\t\t{ UE_LOG(LogBpLink, Error, TEXT("BpLink: the %s/structure answer did not parse into FBpAppStructure"), *Root); }\n';
      check('source: the /structure diagnosis rule refuses the one-condition shape reading 10 ran',
        structureDiagProblems(`MakeGet(Root + TEXT("/structure"), x);\n${oneLine}MakeGet(Root + TEXT("/plan"), y);`).length === 5);

      // One path to the generated USTRUCT headers (2026-10-23, R1 closed): the junction Source/BpLink/Public/Schema ->
      // packages/schema/generated/ue that apps/vr/tools/link-schema.ps1 makes; Public/ is on the module's include path,
      // so BpLink.Build.cs adds none. The junction is git-ignored machine state, so a fresh checkout has none: the link
      // and target are read out of link-schema.ps1 rather than retyped, and the headers are resolved in the target. The
      // headers asserted are the ones BpLink actually includes, derived from its own #include lines, not a typed list.
      const MOD = path.join(ROOT, 'apps/vr/Source/BpLink');
      const build = fs.readFileSync(path.join(MOD, 'BpLink.Build.cs'), 'utf8');
      const adds = includePathAdds(build);
      check('build: BpLink.Build.cs adds no include path (the Public/Schema junction is the one path to the headers)', adds.length === 0, adds.join(' | '));
      // permanent control: the rule refuses the PublicIncludePaths entry into packages/schema that readings 4-5 broke on
      check('build: the one-path rule refuses a Build.cs that adds PublicIncludePaths into packages/schema',
        includePathAdds(`${build}\nPublicIncludePaths.Add(Path.Combine(ModuleDirectory, "..", "..", "..", "..", "packages", "schema", "generated", "ue"));`).length > 0
        && includePathAdds(`// PublicIncludePaths.Add(SchemaUe);\n${build}`).length === 0);
      const spec = junctionSpec(fs.readFileSync(path.join(ROOT, 'apps/vr/tools/link-schema.ps1'), 'utf8'));
      const link = spec ? path.resolve(ROOT, spec.link) : '';
      const inc = spec ? path.resolve(ROOT, spec.target) : '';
      check('build: apps/vr/tools/link-schema.ps1 names the junction it makes ($LinkRel, $TargetRel)', spec !== null);
      check(`build: that junction is BpLink's Public/Schema (${spec?.link})`, spec !== null && link === path.join(MOD, 'Public', 'Schema'), link);
      check(`build: its target resolves inside the repo and exists (${spec?.target})`, spec !== null && !path.relative(ROOT, inc).startsWith('..') && fs.existsSync(inc), inc);
      // Where the junction exists (a UE host that ran link-schema.ps1), it must be the junction to that target, not a copy.
      let linkState = 'absent (apps/vr/tools/link-schema.ps1 makes it)';
      let linkOk = true;
      if (spec && fs.existsSync(link)) {
        const isLink = fs.lstatSync(link).isSymbolicLink();
        const real = fs.realpathSync(link);
        linkOk = isLink && real.toLowerCase() === fs.realpathSync(inc).toLowerCase();
        linkState = `${isLink ? 'link' : 'a real directory'} -> ${real}`;
      }
      check(`build: Public/Schema, where it exists, is a link to that target, not a copy (${linkState})`, linkOk, linkState);
      // `Schema/` is the junction Source/BpLink/Public/Schema -> that target, so `Schema/X` is read there as X.
      const schemaIncludes = (text) => [...stripCxx(text, true).matchAll(/#include\s+"([^"]+)"/g)].map((m) => m[1])
        .filter((h) => /^(Schema\/)?Bp/.test(h) && !h.endsWith('.generated.h') && h !== 'BpLink.h');
      const sources = ['Public/BpLink.h', 'Private/BpLink.cpp'].map((f) => fs.readFileSync(path.join(MOD, f), 'utf8'));
      const includes = sources.flatMap(schemaIncludes);
      const missing = includes.filter((h) => !fs.existsSync(path.join(inc, h.replace(/^Schema\//, ''))));
      check(`build: every Bp* header BpLink includes is in that directory (${includes.join(', ')})`, includes.length > 0 && missing.length === 0,
        missing.length ? `missing: ${missing.join(', ')}` : `0 of ${includes.length} missing`);
      // One spelling. UHT's BpSchema.gen.cpp includes "Schema/BpSchema.h"; a BpLink file that says "BpSchema.h" reaches
      // the same file by another path, MSVC's #pragma once does not match the two, and a unity build that merges both
      // stops at BpSchema.generated.h's `#error "... already included"` (machine.md, Lynx readings 4 and 5).
      const otherSpelling = (list) => list.filter((h) => !h.startsWith('Schema/'));
      check('build: BpLink spells every generated header Schema/<header>, the path UHT\'s generated code uses',
        includes.length > 0 && otherSpelling(includes).length === 0, otherSpelling(includes).join(', '));
      // permanent control: the rule refuses a BpLink.h that goes back to the PublicIncludePaths spelling
      check('build: the one-spelling rule refuses a BpLink.h that includes "BpSchema.h"',
        otherSpelling(schemaIncludes(sources[0].replace('"Schema/BpSchema.h"', '"BpSchema.h"'))).length > 0);
    }
  } finally {
    // the child holds its working directory until it has exited (Windows), so wait before removing it
    if (child.exitCode === null) await new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  console.log(`\ncheck-bplink: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

if (isMain) await main();
