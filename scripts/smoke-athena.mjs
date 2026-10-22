#!/usr/bin/env node
// The athena seam smoke (wolf-plan L5.3): apps/server's athena host against a REAL daemon. Not part of `npm run check`: it
// starts athena-portable's `athena serve` and runs ONE live model turn (claude_code, on the operator's subscription).
//   1. `uv run --frozen --no-sync athena serve --port 0` in the athena-portable checkout (read only: nothing is written there),
//      with ATHENA_HOME a fresh directory under the OS temp dir, so the operator's own brain and vault are never touched. The
//      bound port and the token file come from the ready line; the default port 17490 is never used.
//   2. GET /health. apps/server on a free port with --athena: its host POSTs the manifest; the tools must come back as
//      host:bp with section 4's classes. The 127.0.0.1 page origin is probed too and its refusal recorded (the open seam).
//   3. A draft Kettle wave, then exactly ONE typed turn, POST /run `dispatch the wave` from the host's origin, with the draft
//      wave in host_state. If the model proposes no wave_dispatch, one retry: never more than 2 live turns, no /voice.
//   4. GET /decisions holds exactly one GATED wave_dispatch card. It is approved through the host (POST /athena/decisions/<id>):
//      one new execute job for that wave. Approved again: refused or an empty execute, and the job count does not move.
//      GET /ledger shows the turn.
//   5. Both process trees are stopped (success, failure or Ctrl-C), neither port is left listening, and ATHENA_HOME is deleted.
// The token is read from the daemon's file and never printed. Env: BP_SMOKE_UV (uv.exe), BP_SMOKE_ATHENA_DIR (the checkout).
// Run: node scripts/smoke-athena.mjs [--no-turn]   Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UV = process.env.BP_SMOKE_UV ?? 'C:/Users/kazda/ai/tools/uv/uv.exe';
const ATHENA_DIR = process.env.BP_SMOKE_ATHENA_DIR ?? 'C:/Users/kazda/kiro/athena-portable';
const MAX_TURNS = 2, TURN_MS = 300000;
// --no-turn: everything up to the live turn (daemon, manifest, the seam probe, the wave), then the teardown; spends nothing
const NO_TURN = process.argv.includes('--no-turn');
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); return ok; };
const note = (s) => console.log(`      ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-smoke-athena-'));
const serverCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-smoke-athena-wd-'));
const procs = []; // { name, child, port }
let token = '';

// ------------------------------------------------------------------------------------------------ teardown
const killTree = (child) => {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
};
/** Is anything accepting on 127.0.0.1:port? (a connect, plus netstat's LISTENING rows on Windows) */
const listening = async (port) => {
  const connects = await new Promise((r) => { const s = net.connect(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); r(true); }); s.once('error', () => r(false)); });
  let row = '';
  if (process.platform === 'win32') {
    try { row = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' }).split(/\r?\n/).filter((l) => /LISTENING/.test(l) && new RegExp(`:${port}\\s`).test(l)).join(' | '); } catch { /* netstat missing: the connect decides */ }
  }
  return { up: connects || !!row, row };
};
let tornDown = false;
async function teardown() {
  if (tornDown) return;
  tornDown = true;
  console.log('\n--- teardown');
  for (const p of procs) killTree(p.child);
  await sleep(1500);
  for (const p of procs) {
    if (!p.port) { note(`${p.name}: never bound a port`); continue; }
    let l = await listening(p.port);
    for (let i = 0; l.up && i < 10; i++) { await sleep(500); l = await listening(p.port); }
    check(`teardown: ${p.name} port ${p.port} is not listening`, !l.up, l.row || (l.up ? 'a connect succeeded' : 'netstat: no LISTENING row; connect refused'));
  }
  for (const d of [home, serverCwd]) {
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* checked below */ }
    check(`teardown: ${path.basename(d)} deleted`, !fs.existsSync(d), d);
  }
}
const onSignal = async () => { console.log('\ninterrupted'); failed++; await teardown(); process.exit(130); };
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);
process.on('exit', () => { for (const p of procs) killTree(p.child); });

// ------------------------------------------------------------------------------------------------ HTTP
/** One request; JSON answer parsed when it is JSON. */
// Every body goes with a Content-Length: athena's stdlib server reads exactly that many bytes, so a chunked body reads as empty.
const request = (base, method, p, { headers = {}, body } = {}) => new Promise((resolve) => {
  const u = new URL(p, base), data = body !== undefined ? JSON.stringify(body) : undefined;
  const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { ...headers, ...(data !== undefined ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
    let s = ''; res.setEncoding('utf8'); res.on('data', (d) => (s += d));
    res.on('end', () => { let json = null; try { json = JSON.parse(s); } catch { /* not JSON */ } resolve({ status: res.statusCode, body: s, json }); });
  });
  r.on('error', (e) => resolve({ status: 0, body: e.message, json: null }));
  if (data !== undefined) r.write(data);
  r.end();
});
/** POST /run, read to its last frame: every channel event, parsed. */
const runTurn = (base, body) => new Promise((resolve) => {
  const u = new URL('/run', base), events = [], data = JSON.stringify(body);
  const r = http.request({ host: u.hostname, port: u.port, path: '/run', method: 'POST', headers: { 'x-athena-token': token, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (d) => {
      buf += d.replace(/\r\n/g, '\n');
      for (let i; (i = buf.indexOf('\n\n')) >= 0; ) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (data) { try { events.push(JSON.parse(data)); } catch { events.push({ kind: 'unparsed', text: data.slice(0, 200) }); } }
      }
    });
    res.on('end', () => resolve({ status: res.statusCode, events }));
  });
  r.setTimeout(TURN_MS, () => { r.destroy(); resolve({ status: 0, events: [...events, { kind: 'turn.error', reason: 'smoke_timeout' }] }); });
  r.on('error', (e) => resolve({ status: 0, events: [...events, { kind: 'turn.error', reason: e.message }] }));
  r.write(data);
  r.end();
});
/** Spawn and wait for a line matching `re` on stdout (or stderr); the child is recorded for teardown. */
function start(name, cmd, args, opts, re, ms) {
  const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
  const rec = { name, child, port: 0, out: '' };
  procs.push(rec);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ rec, match: null }), ms);
    const look = (d) => { rec.out += d; const m = re.exec(rec.out); if (m) { clearTimeout(t); resolve({ rec, match: m }); } };
    child.stdout.on('data', look);
    child.stderr.on('data', (d) => { rec.out += d; });
    child.on('exit', (code) => { clearTimeout(t); resolve({ rec, match: re.exec(rec.out), exited: code }); });
    child.on('error', (e) => { rec.out += `spawn error: ${e.message}`; clearTimeout(t); resolve({ rec, match: null }); });
  });
}
/** A line of output with the token (if it ever appeared) cut out. */
const safe = (s) => (token ? String(s).split(token).join('<token>') : String(s));

let result = 1;
try {
  let head = '?';
  try { head = execFileSync('git', ['-C', ATHENA_DIR, 'rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* reported as ? */ }
  console.log(`athena-portable ${ATHENA_DIR} at ${head}; ATHENA_HOME ${home}`);

  // ---------------------------------------------------------------------------------------------- 1. the daemon
  const env = { ...process.env, ATHENA_HOME: home };
  const d = await start('athena daemon', UV, ['run', '--frozen', '--no-sync', 'athena', 'serve', '--port', '0'], { cwd: ATHENA_DIR, env }, /^\{.*"url".*\}\s*$/m, 90000);
  if (!check('daemon: athena serve printed its ready line', !!d.match, safe(d.rec.out.trim().split('\n').slice(-3).join(' | ')))) throw new Error('no daemon');
  const ready = JSON.parse(d.match[0]);
  const A = ready.url, port = Number(new URL(A).port);
  d.rec.port = port;
  check(`daemon: bound a free port (${port}), not the default 17490`, port > 0 && port !== 17490, A);
  check('daemon: the token file is under the temp ATHENA_HOME', typeof ready.token_file === 'string' && path.resolve(ready.token_file).startsWith(path.resolve(home)), ready.token_file);
  token = JSON.parse(fs.readFileSync(ready.token_file, 'utf8')).token;
  const H = { 'x-athena-token': token };
  note(`ready: url ${A}, engine ${ready.engine}, token_file ${ready.token_file}`);

  const health = await request(A, 'GET', '/health', { headers: H });
  check('GET /health: 200 ok', health.status === 200 && health.json?.ok === true, `${health.status} engine ${health.json?.engine} tools ${health.json?.tools}`);

  // ---------------------------------------------------------------------------------------------- 2. apps/server + the host
  const s = await start('apps/server', process.execPath, ['--import', pathToFileURL(path.join(ROOT, 'packages/core/register.mjs')).href, path.join(ROOT, 'apps/server/src/main.ts'), '--port', '0', '--athena', A, '--athena-token-file', ready.token_file],
    { cwd: serverCwd }, /^athena host: .*$/m, 60000);
  const sp = Number(/listening on http:\/\/[^:]+:(\d+)/.exec(s.rec.out)?.[1] ?? 0);
  s.rec.port = sp;
  check(`apps/server: listening on ${sp} with the host attached`, sp > 0 && !!s.match, safe(s.rec.out.trim().split('\n').slice(-3).join(' | ')));
  check('apps/server: its output never carries the token', !s.rec.out.includes(token));
  if (!sp || !s.match) throw new Error('no server');
  note(s.match[0]);
  const S = `http://127.0.0.1:${sp}`;
  const me = (await request(S, 'GET', '/athena')).json;
  const origin = me?.page_origin;
  const want = { navigate: 'AUTO', lens_set: 'AUTO', scan_place: 'AUTO', wave_compose: 'AUTO', wave_dispatch: 'GATED', decision_answer: 'GATED', finding_decline: 'AUTO' };
  const got = Object.fromEntries((me?.registered?.tools ?? []).map((t) => [t.name, t.class]));
  const classes = Object.entries(want).map(([n, c]) => `host.bp.${n}=${got[`host.bp.${n}`] ?? 'missing'}${got[`host.bp.${n}`] === c ? '' : ` (want ${c})`}`);
  check('POST /manifest: accepted, the tools are host:bp with section 4\'s classes', me?.registered?.ok === true && Object.entries(want).every(([n, c]) => got[`host.bp.${n}`] === c) && Object.keys(got).length === 7, JSON.stringify(me?.registered).slice(0, 300));
  note(`manifest classes: ${classes.join(', ')}; page_origin ${origin}`);
  // the open seam: the origin the plan named (127.0.0.1) - refused whole, so nothing of the registration above moves
  const seam = await request(A, 'POST', '/manifest', { headers: H, body: { ...me.manifest, page_origin: `http://127.0.0.1:${sp}` } });
  note(`seam: page_origin http://127.0.0.1:${sp} -> ${seam.status} ${seam.body.slice(0, 260)}`);
  check('seam: the 127.0.0.1 origin is refused whole (400 manifest_invalid), localhost is admitted', seam.status === 400 && seam.json?.reason === 'manifest_invalid' && (seam.json.problems ?? []).length === 1 && /page_origin must be https with a host, or http on localhost/.test(seam.json.problems[0]));

  // ---------------------------------------------------------------------------------------------- 3. one live turn
  const scan = (await request(S, 'GET', '/api/products/kettle/scan', { headers: { host: `localhost:${sp}` } })).json;
  const fid = scan?.proposals?.find((p) => p.status === 'proposed')?.id;
  const made = await request(S, 'POST', '/api/products/kettle/waves', { headers: { host: `localhost:${sp}` }, body: { name: 'Smoke wave', packages: [{ name: 'Kettle fix', model: 'sonnet', effort: 'low', ids: [fid] }] } });
  const wave = made.json?.wave;
  if (!check('Kettle: one draft wave to dispatch', made.status === 201 && wave?.status === 'draft', `${made.status} ${made.body.slice(0, 120)}`)) throw new Error('no wave');
  note(`wave ${wave.id} (${wave.name}), package ${wave.packages[0].id}: ${wave.packages[0].ids.join(',')}`);
  const jobsOf = async () => ((await request(S, 'GET', '/api/products/kettle/scans', { headers: { host: `localhost:${sp}` } })).json ?? []).filter((j) => j.kind === 'execute' && j.wave === wave.id);
  const jobs0 = (await jobsOf()).length;

  if (NO_TURN) { note('--no-turn: stopping before the live turn'); result = failed ? 1 : 0; throw Object.assign(new Error('no-turn'), { quiet: true }); }
  const hostState = { product: 'kettle', view: 'the Kettle sample in the VR light table', waves: [{ id: wave.id, name: wave.name, status: wave.status, packages: wave.packages.map((p) => ({ id: p.id, name: p.name, model: p.model, effort: p.effort, findings: p.ids.length })) }] };
  let turns = 0, turn = null, card = null, costs = [];
  while (turns < MAX_TURNS && !card) {
    turns++;
    turn = await runTurn(A, { message: 'dispatch the wave', origin, host_state: hostState });
    const kinds = turn.events.map((e) => e.kind);
    const sum = turn.events.find((e) => e.kind === 'turn.summary');
    costs.push(sum?.cost_usd ?? null);
    card = turn.events.find((e) => e.kind === 'decision.requested' && e.action === 'host.bp.wave_dispatch') ?? null;
    note(`turn ${turns}: ${turn.status} ${kinds.join(' ')}; cost_usd ${sum?.cost_usd}; ${turn.events.filter((e) => e.kind === 'tool.call').map((e) => `${e.name} ${JSON.stringify(e.params)}`).join('; ') || 'no tool call'}`);
    const text = turn.events.filter((e) => e.kind === 'text.delta').map((e) => e.text).join('').replace(/\s+/g, ' ').slice(0, 240);
    if (text) note(`turn ${turns} said: ${safe(text)}`);
    const err = turn.events.find((e) => e.kind === 'turn.error');
    if (err) note(`turn ${turns} error: ${safe(JSON.stringify(err).slice(0, 240))}`);
  }
  check(`live turns: ${turns} of at most ${MAX_TURNS}, cost_usd ${costs.join(' + ')}`, turns <= MAX_TURNS && costs.every((c) => typeof c === 'number'));
  if (!check('POST /run: the model proposed wave_dispatch and a GATED card was filed', !!card, card ? '' : 'no decision.requested for host.bp.wave_dispatch')) throw new Error('no card');
  note(`card ${card.id}: ${card.action} ${JSON.stringify(card.params)}`);

  // ---------------------------------------------------------------------------------------------- 4. the card, approve, replay
  const inbox = (await request(A, 'GET', '/decisions', { headers: H })).json;
  const pending = (inbox?.pending ?? []).filter((p) => p.action === 'host.bp.wave_dispatch');
  check('GET /decisions: exactly one card, a wave_dispatch from host:bp', inbox?.pending?.length === 1 && pending.length === 1 && pending[0].id === card.id && pending[0].origin === 'host:bp', JSON.stringify(inbox).slice(0, 300));
  check(`card id shape: ${card.id}`, /^apr_[0-9a-f]{12}$/.test(card.id));

  const ap = await request(S, 'POST', `/athena/decisions/${card.id}`, { headers: { host: `localhost:${sp}` }, body: { choice: 'approve' } });
  const jobs1 = await jobsOf();
  const w1 = (await request(S, 'GET', '/api/products/kettle/waves', { headers: { host: `localhost:${sp}` } })).json?.waves?.find((w) => w.id === wave.id);
  note(`approve: ${ap.status} status ${ap.json?.daemon?.status}, execute ${ap.json?.daemon?.execute?.length}, ran ${JSON.stringify(ap.json?.ran?.map((r) => ({ call_id: r.call_id, name: r.name, status: r.status, ok: r.ok }))).slice(0, 240)}`);
  check('approve through the host: the daemon granted it and its execute ran wave.dispatch (202)', ap.status === 200 && ap.json?.daemon?.status === 'approved' && ap.json?.ran?.length === 1 && ap.json.ran[0].status === 202, ap.body.slice(0, 300));
  const dispatched = check('Kettle: one wave dispatched (exactly one new execute job for the wave, the wave dispatched)', jobs1.length - jobs0 === 1 && w1?.status === 'dispatched', `${jobs0} -> ${jobs1.length} jobs, wave ${w1?.status}`);
  if (dispatched) note(`one wave dispatched: job ${jobs1[0].id} (${jobs1[0].kind}, model ${jobs1[0].model}, effort ${jobs1[0].effort})`);

  const again = await request(S, 'POST', `/athena/decisions/${card.id}`, { headers: { host: `localhost:${sp}` }, body: { choice: 'approve' } });
  const jobs2 = await jobsOf();
  note(`replay: ${again.status} ${safe(JSON.stringify(again.json?.daemon ?? again.body)).slice(0, 260)}`);
  check('replay: the same card approved again is refused or answers an empty execute', (again.json?.ok === false || (again.json?.daemon?.execute ?? []).length === 0) && !(again.json?.ran ?? []).some((r) => !r.replayed));
  check('replay: the job count does not move', jobs2.length === jobs1.length, `${jobs1.length} -> ${jobs2.length}`);

  const ledger = (await request(A, 'GET', '/ledger?limit=5', { headers: H })).json;
  const rows = (ledger?.rows ?? []).filter((r) => r.origin === 'host:bp');
  check('GET /ledger: the turn is there (origin host:bp)', rows.length >= 1, JSON.stringify(ledger).slice(0, 300));
  for (const r of rows) note(`ledger row ${r.row_id}: turn ${r.turn_id}, engine ${r.engine}, model ${r.model}, rounds ${r.rounds}, cost_usd ${r.cost_usd}, error ${r.error_reason}`);
  result = failed ? 1 : 0;
} catch (e) {
  if (!e.quiet) {
    failed++;
    console.log(`FAIL  stopped: ${safe(e.message)}`);
    for (const p of procs) if (p.out) console.log(`--- ${p.name} output (last lines)\n${safe(p.out.trim().split('\n').slice(-12).join('\n'))}`);
  }
} finally {
  await teardown();
}
console.log(`\nsmoke-athena: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : result);
