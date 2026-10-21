#!/usr/bin/env node
// apps/server mounts what apps/web mounts (plan.md WP1.4). Starts the headless server on a free port in an empty temp
// working directory (so no product is registered), and checks:
//   routes   the server's printed route table (`route <methods> <path>`) is exactly the web app's: one line per
//            apps/web/src/app/api/**/route.ts, the same methods its thin mount re-exports
//   kettle   with no products file GET /api/products/kettle/structure answers the built-in sample ({ structure, events, rev },
//            domain count = packages/core/data's), GET /api/products/kettle/plan answers the derived plan (wings, rooms, bays, tiles
//            counted from WING_DEFS and the data); the server hosts Kettle's sims (L5.2): a Kettle scan POST answers 202 (a
//            malformed one 400), its stream answers SSE, a write the sims do not cover (triage) still 405 (Kettle stays
//            unlisted). scripts/check-kettle-sim.mjs walks the sims through the stream and proves nothing is written.
//   http     GET /api/products answers 200 [] (no products file), an unknown path 404, a method the route lacks 405
//            with Allow, a foreign Host 403 and a non-JSON write 415: the guards run under this mount too
// The live-product walk (structure, SSE stream, waves, shots) is scripts/smoke-live.mjs against `npm run server`.
// Run: node scripts/check-server.mjs   Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WING_DEFS } from '../packages/core/src/model/constants.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_API = path.join(ROOT, 'apps/web/src/app/api');
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name === 'route.ts' ? [path.join(d, e.name)] : []));
const want = new Map(walk(WEB_API).map((f) => {
  const rel = path.relative(WEB_API, path.dirname(f)).split(path.sep).join('/');
  const m = /export\s*\{\s*([A-Z,\s]+)\}\s*from/.exec(fs.readFileSync(f, 'utf8'));
  return ['/api/' + rel, (m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : []).sort().join(',')];
}));

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-server-'));
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

const req = (method, p, headers = {}, body) => new Promise((resolve) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
    let s = ''; res.on('data', (d) => (s += d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: s }));
  });
  r.on('error', (e) => resolve({ status: 0, headers: {}, body: e.message }));
  if (body !== undefined) r.write(body);
  r.end();
});

try {
  check('the server starts and prints its port', port > 0, out.trim().split('\n').slice(-5).join(' | '));
  if (port > 0) {
    const got = new Map([...out.matchAll(/^route (\S+) (\S+)$/gm)].map((m) => [m[2], m[1].split(',').sort().join(',')]));
    const missing = [...want.keys()].filter((p) => !got.has(p)), extra = [...got.keys()].filter((p) => !want.has(p));
    const differ = [...want.keys()].filter((p) => got.has(p) && got.get(p) !== want.get(p));
    check(`routes: the ${want.size} web mounts, no more, no fewer`, want.size > 0 && !missing.length && !extra.length, `missing ${missing.join(' ')} extra ${extra.join(' ')}`);
    check('routes: the same methods per route', !differ.length, differ.map((p) => `${p} ${got.get(p)} vs ${want.get(p)}`).join('; '));

    const list = await req('GET', '/api/products');
    check('GET /api/products: 200 [] with no products file', list.status === 200 && list.body.trim() === '[]', `${list.status} ${list.body.slice(0, 80)}`);
    const kdata = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.app-structure.json'), 'utf8'));
    const wantDomains = kdata.domains.length;
    const ks = await req('GET', '/api/products/kettle/structure');
    let kb = null; try { kb = JSON.parse(ks.body); } catch { /* reported below */ }
    check(`GET /api/products/kettle/structure: 200 with no products file (${kb?.structure?.domains?.length ?? '?'} domains)`, ks.status === 200 && !!kb?.structure && typeof kb.events === 'string' && typeof kb.rev === 'string', `${ks.status} ${ks.body.slice(0, 80)}`);
    check(`kettle structure: domain count equals the data's ${wantDomains}`, kb?.structure?.domains?.length === wantDomains, `${kb?.structure?.domains?.length}`);
    check('kettle structure: lens manifests served', kb?.structure?.lenses?.length === kdata.lenses.length && kdata.lenses.length > 0, `${kb?.structure?.lenses?.length}`);
    // the derived plan: wings = the WING_DEFS groups that hold a domain of the data; rooms, bays and tiles are the data's
    const wantPlan = {
      wings: WING_DEFS.filter((w) => kdata.domains.some((d) => w.doms.includes(d.slug))).length, rooms: kdata.domains.length,
      bays: kdata.capabilities.length, tiles: kdata.features.length,
    };
    const kp = await req('GET', '/api/products/kettle/plan');
    let pb = null; try { pb = JSON.parse(kp.body); } catch { /* reported below */ }
    const gotPlan = { wings: pb?.wings?.length, rooms: pb?.rooms?.length, bays: pb?.bays?.length, tiles: pb?.tiles?.length };
    check(`GET /api/products/kettle/plan: 200 with ${wantPlan.wings} wings, ${wantPlan.rooms} rooms, ${wantPlan.bays} bays, ${wantPlan.tiles} tiles`,
      kp.status === 200 && JSON.stringify(gotPlan) === JSON.stringify(wantPlan) && wantPlan.wings > 0, `${kp.status} ${JSON.stringify(gotPlan)} ${kp.body.slice(0, 80)}`);
    check('kettle plan: rev equals the structure rev', !!pb?.rev && pb.rev === kb?.rev, `${pb?.rev} vs ${kb?.rev}`);
    const ids = new Set([...(pb?.wings ?? []), ...(pb?.rooms ?? []), ...(pb?.bays ?? [])].map((n) => n.id));
    check('kettle plan: every room, bay and tile names an existing parent by id', [...(pb?.rooms ?? []), ...(pb?.bays ?? []), ...(pb?.tiles ?? [])].every((n) => typeof n.parentId === 'string' && ids.has(n.parentId)), '');
    check('kettle plan: every tile has a box and a health per enabled lens', !!pb?.tiles?.length && pb.tiles.every((t) => typeof t.box?.w === 'number' && pb.lenses.every((l) => typeof t.health?.[l] === 'string')), `${pb?.lenses?.length} lenses`);
    const kpw = await req('POST', '/api/products/kettle/plan', { 'content-type': 'application/json' }, '{}');
    check('a Kettle write to /plan: 4xx', kpw.status >= 400 && kpw.status < 500, `${kpw.status}`);
    const kw = await req('POST', '/api/products/kettle/scans', { 'content-type': 'application/json' }, JSON.stringify({ lens: 'development', scope: { kind: 'all', label: 'Everything', features: [] } }));
    let kj = null; try { kj = JSON.parse(kw.body); } catch { /* reported below */ }
    check('a Kettle scan write: 202, the hosted sim queues it', kw.status === 202 && kj?.kind === 'measure', `${kw.status} ${kw.body.slice(0, 80)}`);
    if (kj?.id) await req('DELETE', `/api/products/kettle/scans/${kj.id}`);
    const kbad = await req('POST', '/api/products/kettle/scans', { 'content-type': 'application/json' }, '{}');
    check('a malformed Kettle scan write: 400', kbad.status === 400, `${kbad.status}`);
    const ktr = await req('POST', '/api/products/kettle/triage', { 'content-type': 'application/json' }, '{}');
    check('a Kettle write the sims do not cover (triage): 405', ktr.status === 405, `${ktr.status}`);
    const kst = await new Promise((resolve) => {
      const r = http.request({ host: '127.0.0.1', port, path: '/api/products/kettle/stream', headers: { host: `localhost:${port}`, accept: 'text/event-stream' } }, (res) => {
        let s = ''; res.setEncoding('utf8');
        res.on('data', (d) => { s += d; if (s.includes('\n\n')) { r.destroy(); resolve({ status: res.statusCode, type: String(res.headers['content-type']), body: s }); } });
        res.on('end', () => resolve({ status: res.statusCode, type: String(res.headers['content-type']), body: s }));
      });
      r.on('error', (e) => resolve({ status: 0, type: '', body: e.message }));
      r.end();
    });
    check('Kettle stream: 200 SSE, a snapshot first', kst.status === 200 && /text\/event-stream/.test(kst.type) && kst.body.startsWith('event: snapshot\n'), `${kst.status} ${kst.type} ${kst.body.slice(0, 40)}`);
    const kl = await req('GET', '/api/products');
    check('Kettle stays unlisted: GET /api/products still []', kl.status === 200 && kl.body.trim() === '[]', kl.body.slice(0, 80));
    const none = await req('GET', '/api/nothing-here');
    check('an unknown path: 404', none.status === 404, `${none.status}`);
    const nope = await req('DELETE', '/api/products');
    check('a method the route lacks: 405 with Allow', nope.status === 405 && /GET/.test(String(nope.headers.allow)), `${nope.status} allow=${nope.headers.allow}`);
    const foreign = await req('GET', '/api/products', { host: 'evil.example' });
    check('guard: a foreign Host: 403', foreign.status === 403, `${foreign.status}`);
    const plain = await req('POST', '/api/products', { 'content-type': 'text/plain', 'content-length': '3' }, 'x=1');
    check('guard: a non-JSON write: 415', plain.status === 415, `${plain.status}`);
    const fwd = await req('POST', '/api/products', { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' }, '{}');
    check('guard: a forwarded non-local hop: 403', fwd.status === 403, `${fwd.status}`);
  }
} finally {
  // the child holds its working directory until it has exited (Windows), so wait before removing it
  if (child.exitCode === null) await new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(`\ncheck-server: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
