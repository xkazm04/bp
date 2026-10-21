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

const kdata = JSON.parse(fs.readFileSync(path.join(DATA, 'kettle.app-structure.json'), 'utf8'));
const lines = (s) => s.split('\n').filter((l) => l.trim());
const wantEvents = lines(fs.readFileSync(path.join(DATA, 'kettle.events.jsonl'), 'utf8'));
// BP_CHECK_BPLINK_WINGS seeds a wrong expectation (of the domain count), to show the smoke can fail
const wantDomains = Number(process.env.BP_CHECK_BPLINK_WINGS ?? kdata.domains.length);
const wantPlan = {
  wings: WING_DEFS.filter((w) => kdata.domains.some((d) => w.doms.includes(d.slug))).length, rooms: kdata.domains.length,
  bays: kdata.capabilities.length, tiles: kdata.features.length,
};

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
    check(`structure: ${kdata.lenses.length} lens manifests in structure.lenses (packages/core/data)`, kb?.structure?.lenses?.length === kdata.lenses.length && kdata.lenses.length > 0, `${kb?.structure?.lenses?.length}`);

    const kp = await get('/api/products/kettle/plan', { accept: 'application/json' });
    let pb = null; try { pb = JSON.parse(kp.body); } catch { /* reported below */ }
    check('plan: 200 JSON', kp.status === 200 && /json/.test(String(kp.headers['content-type'])), `${kp.status} ${kp.headers['content-type']}`);
    const gotPlan = { wings: pb?.wings?.length, rooms: pb?.rooms?.length, bays: pb?.bays?.length, tiles: pb?.tiles?.length };
    check(`plan: ${wantPlan.wings} wings, ${wantPlan.rooms} rooms, ${wantPlan.bays} bays, ${wantPlan.tiles} tiles (WING_DEFS and packages/core/data)`, JSON.stringify(gotPlan) === JSON.stringify(wantPlan) && wantPlan.wings > 0, JSON.stringify(gotPlan));
    check('plan: rev equals the structure rev', typeof pb?.rev === 'string' && pb.rev === kb?.rev, `${pb?.rev} vs ${kb?.rev}`);
    check('plan: every tile carries a box and a health for each of the plan lenses', !!pb?.tiles?.length && Array.isArray(pb.lenses) && pb.lenses.length > 0 && pb.tiles.every((t) => typeof t.box?.x === 'number' && pb.lenses.every((l) => typeof t.health?.[l] === 'string')), `${pb?.lenses?.length} lenses`);

    const evs = lines(kb?.events ?? '');
    let parsed = true; for (const l of evs) { try { JSON.parse(l); } catch { parsed = false; } }
    check(`events: the payload's JSONL has the data file's ${wantEvents.length} lines, each valid JSON`, evs.length === wantEvents.length && wantEvents.length > 0 && parsed, `${evs.length} lines, parsed=${parsed}`);

    const st = await firstEvent('/api/products/kettle/stream');
    const m = /^event: (\w+)\ndata: (.*)$/m.exec(st.body);
    let sd = null; try { sd = JSON.parse(m?.[2] ?? ''); } catch { /* reported below */ }
    check('stream: 200 text/event-stream', st.status === 200 && /text\/event-stream/.test(String(st.headers['content-type'])), `${st.status} ${st.headers['content-type']}`);
    check('stream: the first event is a snapshot with the sample findings (proposals) and every scan table', m?.[1] === 'snapshot' && Array.isArray(sd?.proposals) && sd.proposals.length > 0 && ['runs', 'measurements', 'activity'].every((t) => Array.isArray(sd?.[t])), `${m?.[1]} ${st.body.slice(0, 80)}`);
    const again = await get('/api/products/kettle/structure');
    let ab = null; try { ab = JSON.parse(again.body); } catch { /* reported below */ }
    check('rev: stable across reads (a fallback that reads it once can trust it)', !!ab?.rev && ab.rev === kb?.rev, `${kb?.rev} vs ${ab?.rev}`);
  }
} finally {
  // the child holds its working directory until it has exited (Windows), so wait before removing it
  if (child.exitCode === null) await new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(`\ncheck-bplink: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
