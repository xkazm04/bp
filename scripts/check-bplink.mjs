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

const kdata = JSON.parse(fs.readFileSync(path.join(DATA, 'kettle.app-structure.json'), 'utf8'));
const lines = (s) => s.split('\n').filter((l) => l.trim());
const wantEvents = lines(fs.readFileSync(path.join(DATA, 'kettle.events.jsonl'), 'utf8'));
// BP_CHECK_BPLINK_WINGS seeds a wrong expectation (of the domain count), to show the smoke can fail.
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

    // Derived over the C++ source, because no rung above it is reachable: this repo has no Unreal toolchain, so the
    // module cannot be compiled, let alone run against the server. Stripping comments and string literals first is what
    // makes it a check on the CODE and not on the prose beside it.
    const cpp = stripCxx(fs.readFileSync(path.join(ROOT, 'apps/vr/Source/BpLink/Private/BpLink.cpp'), 'utf8'));
    const pinned = [...cpp.matchAll(/StreamStatus\s*==\s*(\d{3})/g)].map((m) => Number(m[1]));
    check(`source: BpLink.cpp branches on the /stream status the server answers (${st.status})`, pinned.includes(st.status),
      `BpLink.cpp accepts [${pinned.join(', ')}], the server answered ${st.status}`);

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
    const combine = /Path\.Combine\(ModuleDirectory\s*,\s*((?:"[^"]*"\s*,?\s*)+)\)/.exec(build);
    const parts = [...(combine?.[1] ?? '').matchAll(/"([^"]*)"/g)].map((m) => m[1]);
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
