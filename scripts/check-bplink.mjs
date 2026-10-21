#!/usr/bin/env node
// The BpLink contract (plan.md WP3.1): the UE client in apps/vr reads Kettle from apps/server with exactly these requests.
// Starts the headless server on a free port in an empty temp working directory (no products file) and makes them:
//   structure  GET /api/products/kettle/structure: 200 { structure, events, rev }; domains = structure.domains and lens
//              manifests = structure.lenses, both counted against packages/core/data, never hard-coded
//   plan       GET /api/products/kettle/plan: 200 { rev, lenses, wings, rooms, bays, tiles }, the levels VR draws (wing, room,
//              bay, tile): 5 wings, 13 rooms, 29 bays, 133 tiles today, derived from WING_DEFS and the data, never hard-coded
//   events     the event log BpLink reads is that payload's `events` string (JSONL), line for line the data file's
//   stream     GET /api/products/kettle/stream answers SSE (apps/server hosts Kettle's sims, L5.2): the first event is a `snapshot`
//              of the sample (its findings as `proposals`); `delta` and `jobs` follow a scan (scripts/check-kettle-sim.mjs)
//   schema     the structure, plan, first stream frame and waves bodies conform to structure-envelope-1, plan-1 and scan-wire-1
//              (packages/schema/schema, via ajv), and each validator is shown to refuse one broken copy of the same body
// Pins the server's current answers; it changes no route. A gap BpLink must live with is asserted as it is, not papered over.
//
// `npm run check` cannot compile BpLink (no Unreal toolchain here, apps/vr/WP3.1.md), so the last block derives what it can
// from the C++ TEXT instead: the /stream status codes `BpLink.cpp` branches on must include the one the live server just
// answered. Comments and string literals are stripped first, or a file that only TALKS about a status would pass.
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
 * The path segments BpLink.Build.cs hands to Path.Combine(ModuleDirectory, ...), read out of the file rather than retyped, so a
 * check that resolves them fails when the Build.cs and the check disagree. [] when there is no such call.
 */
export function includeParts(build) {
  const combine = /Path\.Combine\(ModuleDirectory\s*,\s*((?:"[^"]*"\s*,?\s*)+)\)/.exec(build);
  return [...(combine?.[1] ?? '').matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

// The payload schemas, all six registered under their $id so structure-envelope-1's relative $ref to app-structure-3 resolves.
// Same ajv options as scripts/validate-structure.mjs and packages/schema/generate.mjs (strict, allowUnionTypes).
const SCHEMA_DIR = path.join(ROOT, 'packages/schema/schema');
const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
for (const f of fs.readdirSync(SCHEMA_DIR).filter((n) => n.endsWith('.schema.json'))) ajv.addSchema(JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, f), 'utf8')));
const PAYLOAD_SCHEMAS = { envelope: 'structure-envelope-1', plan: 'plan-1', snapshot: 'scan-wire-1', waves: 'scan-wire-1' };
const PAYLOAD_LABEL = { envelope: '/structure body', plan: '/plan body', snapshot: '/stream snapshot frame', waves: '/waves body' };
// One break per payload, applied to a copy of the live body. scan-wire-1's root takes one property per frame name, so a
// stream frame is validated as { snapshot: <data> } and the waves answer as { waves }.
const WRONG = {
  envelope: (b) => { const c = structuredClone(b); delete c.events; return c; },
  plan: (b) => { const c = structuredClone(b); const h = c.tiles?.[0]?.health; if (h) h[Object.keys(h)[0]] = 'purple'; else c.tiles = [{}]; return c; },
  snapshot: (b) => { const c = structuredClone(b); c.snapshot = { ...(c.snapshot ?? {}), runs: 'not-an-array' }; return c; },
  waves: (b) => ({ ...structuredClone(b), waves: [{}] }),
};
const WRONG_WHAT = { envelope: '`events` omitted', plan: 'a health value that is no status', snapshot: '`runs` that is not an array', waves: 'a wave with no fields' };
/** '' when `body` conforms to the named schema, else ajv's first errors as one string. */
export function payloadErrors(schema, body) {
  const validate = ajv.getSchema(`https://app-structure.example/schema/${schema}.schema.json`);
  if (!validate) return `schema ${schema} is not registered`;
  return validate(body) ? '' : (validate.errors ?? []).slice(0, 3).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
}

/** True when this file was started directly (`node scripts/check-bplink.mjs`), false when another module imported it for its helpers. */
const isMain = !!process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

async function main() {
  const kdata = JSON.parse(fs.readFileSync(path.join(DATA, 'kettle.app-structure.json'), 'utf8'));
  const lines = (s) => s.split('\n').filter((l) => l.trim());
  const wantEvents = lines(fs.readFileSync(path.join(DATA, 'kettle.events.jsonl'), 'utf8'));
  // BP_CHECK_BPLINK_WINGS seeds a wrong expectation (of the domain count), to show the smoke can fail.
  // BP_CHECK_BPLINK_SEED=schema:envelope|schema:plan|schema:snapshot|schema:waves breaks the live body before it is validated against its schema.
// BP_CHECK_BPLINK_SEED=plan,lenses,events does the same for the other derived figures, one or several at once: each adds 1
  // to that expectation, and the run must then FAIL on exactly that assertion (an expectation that survives its own seed is
  // not pinning anything). Unset, nothing changes.
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
      check('plan: every tile carries a box and a health for each of the plan lenses', !!pb?.tiles?.length && Array.isArray(pb.lenses) && pb.lenses.length > 0 && pb.tiles.every((t) => typeof t.box?.x === 'number' && pb.lenses.every((l) => typeof t.health?.[l] === 'string')), `${pb?.lenses?.length} lenses`);

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
      const live = { envelope: kb ?? {}, plan: pb ?? {}, snapshot: { snapshot: sd }, waves: wb ?? {} };
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

      // The level names are the web's and the plan route's: structure.domains are ROOMS (13 here), and wings are the
      // WING_DEFS groups of domains (5 here). A log line that labels the domain count "wings" reports a number that is
      // right for rooms and wrong for the level it names, and WP3.1.md's acceptance asks for the wing count. The format
      // string is the subject of this assertion, so string literals are kept and only comments are stripped.
      const lit = stripCxx(fs.readFileSync(path.join(ROOT, 'apps/vr/Source/BpLink/Private/BpLink.cpp'), 'utf8'), true);
      const call = /UE_LOG\((?:(?!UE_LOG\()[\s\S])*?Structure\.domains\.Num\(\)[\s\S]*?\);/.exec(lit);
      const label = /(\w+)=%d/.exec(/TEXT\("((?:[^"\\]|\\.)*)"\)/.exec(call?.[0] ?? '')?.[1] ?? '')?.[1];
      check(`source: the count BpLink logs from structure.domains is labelled "rooms" (${wantPlan.rooms}), not "wings" (${wantPlan.wings})`,
        label === 'rooms', `BpLink.cpp labels it "${label}"; domains=${wantDomains}, wings=${wantPlan.wings}, rooms=${wantPlan.rooms}`);

      // BpLink.Build.cs reaches the generated USTRUCT headers through a hand-counted run of ".." from ModuleDirectory,
      // and nothing in the repo has ever resolved it: a header moved, or one ".." too few, surfaces as an unresolved
      // include in a UE build this repo cannot run. The path EXPRESSION is read out of the Build.cs rather than
      // retyped here, so this check fails if the two ever disagree. The headers asserted are the ones BpLink actually
      // includes, derived from its own #include lines, not a typed list.
      const MOD = path.join(ROOT, 'apps/vr/Source/BpLink');
      const build = fs.readFileSync(path.join(MOD, 'BpLink.Build.cs'), 'utf8');
      const parts = includeParts(build);
      const inc = path.resolve(MOD, ...parts);
      check('build: BpLink.Build.cs names its include path as a Path.Combine off ModuleDirectory', parts.length > 0, build.slice(0, 0));
      check(`build: that include path resolves inside the repo (${parts.join('/')})`, parts.length > 0 && !path.relative(ROOT, inc).startsWith('..'), inc);
      check('build: the directory it adds to PublicIncludePaths exists', parts.length > 0 && fs.existsSync(inc), inc);
      const includes = ['Public/BpLink.h', 'Private/BpLink.cpp']
        .flatMap((f) => [...stripCxx(fs.readFileSync(path.join(MOD, f), 'utf8'), true).matchAll(/#include\s+"([^"]+)"/g)].map((m) => m[1]))
        .filter((h) => /^Bp/.test(h) && !h.endsWith('.generated.h') && h !== 'BpLink.h');
      const missing = includes.filter((h) => !fs.existsSync(path.join(inc, h)));
      check(`build: every Bp* header BpLink includes is in that directory (${includes.join(', ')})`, includes.length > 0 && missing.length === 0,
        missing.length ? `missing: ${missing.join(', ')}` : `0 of ${includes.length} missing`);
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
