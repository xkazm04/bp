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
//   mount    apps/server/src/check-mount.ts (the mount's own guards over a throwaway handler tree: 400 on a bad escape or
//            Host, 413 past MAX_BODY, 500 without the message, 403 for a non-loopback peer) runs and passes
// The live-product walk (structure, SSE stream, waves, shots) is scripts/smoke-live.mjs against `npm run server`.
// Run: node scripts/check-server.mjs   Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { routeMethods } from './lib/mounts.ts';
import { WING_DEFS } from '../packages/core/src/model/constants.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE_API = path.join(ROOT, 'packages/core/src/server/api');
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };

// Expected table: derived from the CORE handlers' exported methods (scripts/lib/mounts.ts, the same read check-route-guards.mjs
// uses), never from the web mounts' own re-export lists - check-route-guards.mjs proves each mount re-exports exactly these.
const want = new Map([...routeMethods(CORE_API)].map(([rel, ms]) => ['/api/' + path.posix.dirname(rel).replace(/^\.$/, ''), [...ms].sort().join(',')]));

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
    check(`routes: the ${want.size} core handler routes, no more, no fewer`, want.size > 0 && !missing.length && !extra.length, `missing ${missing.join(' ')} extra ${extra.join(' ')}`);
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
    // the two routes agreeing proves nothing about WHAT they hash (both would change together), so the rev is also
    // recomputed here from the data files, and the routes are shown to hold no fingerprint code of their own
    const wantRev = createHash('sha1').update(fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.app-structure.json'), 'utf8')).update('\0').update(fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.events.jsonl'), 'utf8')).digest('hex').slice(0, 16);
    check('kettle structure: rev is sha1(map, NUL, events) cut to 16 hex', kb?.rev === wantRev, `${kb?.rev} vs ${wantRev}`);
    const own = ['structure', 'plan'].filter((r) => /createHash/.test(fs.readFileSync(path.join(CORE_API, `products/[slug]/${r}/route.ts`), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')));
    check('kettle rev: one implementation (neither route hashes on its own)', own.length === 0, own.join(' '));
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
    const fwdRead = await req('GET', '/api/products', { 'x-forwarded-for': '203.0.113.9' });
    check('guard: a forwarded non-local hop on a read: 403', fwdRead.status === 403, `${fwdRead.status}`);
    // log: a handler guard's refusal is recorded once by the guard itself (packages/core/src/scan/refusals.ts), on this
    // mount as under Next; mount.ts appends the loopback socket as the nearest hop, so the flag reads peer=loopback.
    const lineOf = (re) => [...out.matchAll(new RegExp(re.source, 'gm'))].length;
    const HOP = /^refused 403 \(foreign-hop\) "POST" "\/api\/products" peer=loopback$/;
    for (let i = 0; i < 50 && !lineOf(HOP); i++) await new Promise((r) => setTimeout(r, 20));
    check('log: the forwarded-hop write leaves exactly one foreign-hop line in the server output', lineOf(HOP) === 1, out.split('\n').filter((l) => /^refused/.test(l)).join(' | '));
    check('log: the foreign Host read leaves one foreign-host line, without the Host value', lineOf(/^refused 403 \(foreign-host\) "GET" "\/api\/products" peer=loopback$/) === 1 && !/^refused.*evil\.example/m.test(out), out.split('\n').filter((l) => /^refused/.test(l)).join(' | '));
    check('log: the non-JSON write leaves one not-json line', lineOf(/^refused 415 \(not-json\) "POST" "\/api\/products" peer=loopback$/) === 1);
  }
} finally {
  // the child holds its working directory until it has exited (Windows), so wait before removing it
  if (child.exitCode === null) await new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
// argv: a bad --port is refused with exit 1 and a message naming the value (Number('abc') is NaN, and listen(NaN) binds a random
// port), and a wildcard --host prints the dialable loopback URL, not the bind address. Spawned in parallel, own empty cwd.
{
  const spawnMain = (args, env = {}) => new Promise((resolve) => {
    const c = spawn(process.execPath, ['--import', pathToFileURL(path.join(ROOT, 'packages/core/register.mjs')).href, path.join(ROOT, 'apps/server/src/main.ts'), ...args], { cwd: os.tmpdir(), env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '', killed = false;
    const kill = () => { killed = true; c.kill(); };
    const t = setTimeout(kill, 20000);
    const done = (code) => { clearTimeout(t); resolve({ code: killed ? 'killed' : code, out: o }); };
    c.stdout.on('data', (d) => { o += d; if (/listening on/.test(o)) kill(); });
    c.stderr.on('data', (d) => (o += d));
    c.on('exit', (code) => done(code));
  });
  const bad = [['--port', 'abc'], ['--port', '70000'], ['--port', '-1'], ['--port', '--host'], ['--port', '80x']];
  const [wild, envBad, ...refused] = await Promise.all([spawnMain(['--host', '0.0.0.0', '--port', '0']), spawnMain([], { BP_SERVER_PORT: '8o80' }), ...bad.map((a) => spawnMain(a))]);
  bad.forEach((a, i) => check(`argv: ${a.join(' ')} exits 1 with a message and binds nothing`, refused[i].code === 1 && /^bp server: /m.test(refused[i].out) && !/listening on/.test(refused[i].out), `${refused[i].code} ${refused[i].out.trim().slice(-120)}`));
  check('argv: BP_SERVER_PORT=8o80 exits 1 naming the value', envBad.code === 1 && envBad.out.includes('8o80') && !/listening on/.test(envBad.out), `${envBad.code} ${envBad.out.trim().slice(-120)}`);
  check('argv: --host 0.0.0.0 prints a dialable URL (127.0.0.1) and names the bind', /listening on http:\/\/127\.0\.0\.1:[1-9]\d*\b.*bound to 0\.0\.0\.0/.test(wild.out), wild.out.trim().split('\n').slice(-2).join(' | '));
  // the refusals after argv: a port another listener holds ends with the one `cannot listen` line and exit 1 (main.ts's
  // server 'error' handler), and --lan-host is refused for every interface (0.0.0.0) and for anything that is no IPv4
  const held = net.createServer();
  await new Promise((resolve) => held.listen(0, '127.0.0.1', resolve));
  const heldPort = held.address().port;
  try {
    const [busy, lanAll, lanJunk] = await Promise.all([spawnMain(['--port', String(heldPort)]),
      spawnMain(['--port', '0', '--lan', '--lan-host', '0.0.0.0']), spawnMain(['--port', '0', '--lan', '--lan-host', 'nonsense'])]);
    check('a held port: exits 1 with one `bp server: cannot listen on 127.0.0.1:<port>: EADDRINUSE` line, no stack',
      busy.code === 1 && new RegExp(`^bp server: cannot listen on 127\\.0\\.0\\.1:${heldPort}: EADDRINUSE`, 'm').test(busy.out) && !/listening on|\n\s+at /.test(busy.out), `${busy.code} ${busy.out.trim().slice(-160)}`);
    check('--lan --lan-host 0.0.0.0: exits 1 naming every interface, binds nothing', lanAll.code === 1 && /^bp server: --lan-host 0\.0\.0\.0 is every interface/m.test(lanAll.out) && !/listening on/.test(lanAll.out), `${lanAll.code} ${lanAll.out.trim().slice(-160)}`);
    check('--lan --lan-host nonsense: exits 1 asking for an IPv4 address, binds nothing', lanJunk.code === 1 && /^bp server: --lan-host takes an IPv4 address, not "nonsense"/m.test(lanJunk.out) && !/listening on/.test(lanJunk.out), `${lanJunk.code} ${lanJunk.out.trim().slice(-160)}`);
  } finally { held.close(); }
}
{
  const m = spawnSync(process.execPath, [path.join(ROOT, 'apps/server/src/check-mount.ts')], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  const stdout = m.stdout ?? '';
  const tally = /check-mount: (\d+) passed, (\d+) failed, (\d+) skipped/.exec(stdout);
  const fails = stdout.split('\n').filter((l) => l.startsWith('FAIL')).join(' | ');
  // Forward the child's own SKIP lines (check-all.mjs counts lines starting `SKIP`): the LAN leg is the only proof behind
  // mount.ts's `--host 0.0.0.0` argument. Not fatal here - whether a skipped peer check should fail is the owner's call.
  const skipLines = stdout.split(/\r?\n/).filter((l) => /^\s*SKIP\b/.test(l));
  for (const l of skipLines) console.log(l.trim());
  // The floor is on checks run PLUS checks skipped, so a LAN-less machine (one skip) stays green while a shrinking suite
  // goes red. Raise it deliberately whenever check-mount grows. 38 checks today with the LAN leg; its two checks become
  // one SKIP on a LAN-less machine, so the floor is 37 (raised from 31 with the refusal-record cases, 2026-10-24).
  const MOUNT_FLOOR = 37;
  const total = tally ? Number(tally[1]) + Number(tally[3]) : 0;
  check(`mount: apps/server/src/check-mount.ts passes (${tally?.[1] ?? '?'} checks, ${tally?.[3] ?? '?'} skipped)`, m.status === 0 && !!tally && total >= MOUNT_FLOOR && tally[2] === '0' && Number(tally[3]) === skipLines.length,
    fails || (tally && total < MOUNT_FLOOR ? `${total} checks accounted for, floor ${MOUNT_FLOOR}` : '') || `exit ${m.status} ${(m.stderr ?? '').slice(-200)}`);
}
// a start-up failure after argv: a Kettle sim that cannot be built ends with one `bp server:` line and exit 1, never an
// uncaught stack. Seeded by a preload that pins globalThis.localStorage, which hostKettleSims must hide and then cannot.
{
  const pin = "data:text/javascript,Object.defineProperty(globalThis,'localStorage',{value:1,configurable:false})";
  const r = spawnSync(process.execPath, ['--import', pin, '--import', pathToFileURL(path.join(ROOT, 'packages/core/register.mjs')).href, path.join(ROOT, 'apps/server/src/main.ts'), '--port', '0'],
    { cwd: os.tmpdir(), encoding: 'utf8', timeout: 30000 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  check('a Kettle sim that cannot be built: exits 1 with one `bp server: cannot build the Kettle sims: ...` line, no stack',
    r.status === 1 && /^bp server: cannot build the Kettle sims: /m.test(out) && !/\n\s+at /.test(out) && !/listening on/.test(out), `${r.status} ${out.trim().slice(-200)}`);
}
console.log(`\ncheck-server: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
