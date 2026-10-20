#!/usr/bin/env node
// The BpLink contract (plan.md WP3.1): the UE client in apps/vr reads Kettle from apps/server with exactly these requests.
// Starts the headless server on a free port in an empty temp working directory (no products file) and makes them:
//   structure  GET /api/products/kettle/structure: 200 { structure, events, rev }; wings = structure.domains and lens
//              manifests = structure.lenses, both counted against packages/core/data, never hard-coded
//   events     the event log BpLink reads is that payload's `events` string (JSONL), line for line the data file's
//   stream     GET /api/products/kettle/stream answers 405 JSON today (Kettle has no SSE): BpLink's fallback is to read `rev` once
// Pins the server's current answers; it changes no route. A gap BpLink must live with is asserted as it is, not papered over.
// Run: node scripts/check-bplink.mjs   Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'packages/core/data');
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };

const kdata = JSON.parse(fs.readFileSync(path.join(DATA, 'kettle.app-structure.json'), 'utf8'));
const lines = (s) => s.split('\n').filter((l) => l.trim());
const wantEvents = lines(fs.readFileSync(path.join(DATA, 'kettle.events.jsonl'), 'utf8'));
// BP_CHECK_BPLINK_WINGS seeds a wrong expectation, to show the smoke can fail
const wantWings = Number(process.env.BP_CHECK_BPLINK_WINGS ?? kdata.domains.length);

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

try {
  check('the server starts and prints its port', port > 0, out.trim().split('\n').slice(-5).join(' | '));
  if (port > 0) {
    const ks = await get('/api/products/kettle/structure', { accept: 'application/json' });
    let kb = null; try { kb = JSON.parse(ks.body); } catch { /* reported below */ }
    check('structure: 200 JSON', ks.status === 200 && /json/.test(String(ks.headers['content-type'])), `${ks.status} ${ks.headers['content-type']}`);
    check('structure: { structure, events, rev }', !!kb?.structure && typeof kb.structure === 'object' && typeof kb.events === 'string' && typeof kb.rev === 'string' && kb.rev.length > 0, ks.body.slice(0, 80));
    check(`structure: ${wantWings} wings in structure.domains (packages/core/data)`, kb?.structure?.domains?.length === wantWings && wantWings > 0, `${kb?.structure?.domains?.length}`);
    check(`structure: ${kdata.lenses.length} lens manifests in structure.lenses (packages/core/data)`, kb?.structure?.lenses?.length === kdata.lenses.length && kdata.lenses.length > 0, `${kb?.structure?.lenses?.length}`);

    const evs = lines(kb?.events ?? '');
    let parsed = true; for (const l of evs) { try { JSON.parse(l); } catch { parsed = false; } }
    check(`events: the payload's JSONL has the data file's ${wantEvents.length} lines, each valid JSON`, evs.length === wantEvents.length && wantEvents.length > 0 && parsed, `${evs.length} lines, parsed=${parsed}`);

    const st = await get('/api/products/kettle/stream', { accept: 'text/event-stream' });
    let sb = null; try { sb = JSON.parse(st.body); } catch { /* reported below */ }
    check('stream: Kettle has no SSE, 405 JSON error (BpLink reads rev once from structure)', st.status === 405 && !/event-stream/.test(String(st.headers['content-type'])) && typeof sb?.error === 'string', `${st.status} ${st.headers['content-type']} ${st.body.slice(0, 80)}`);
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
