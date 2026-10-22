#!/usr/bin/env node
// The athena host (apps/server/src/athena-host.ts, wolf-plan L5.3), offline: the host runs in this process over apps/server's
// own route table and Kettle's in-memory sims, against an in-process FAKE daemon (node:http; no Python, no athena, no model).
// The fake derives a tool's class the way athena does (AUTO only when reversible and not external), files cards on request,
// and answers POST /decisions/<id> with an `execute` it does NOT spend, so a replay reaches the host again and the host's own
// call_id record is what is tested. It proves:
//   manifest  the tool names and the reversible / side_effects flags are tech-stack.md section 4's table (read from the doc),
//             and the classes the daemon derives from them are the table's AUTO and GATED
//   approve   approving a wave.dispatch card runs the wave's dispatch handler exactly once (one execute job for the wave)
//   replay    the same execute again (the card re-approved, and the entry re-sent) runs it zero more times
//   decline   a decline runs nothing, even when the daemon's answer carries an execute
//   refused   a manifest refused 403, refused with a non-ok body, or sent to no daemon at all is a reported failure, not a throw
//   redirect  a 3xx from the daemon URL is not followed, so the token never reaches its Location
//   status-host  GET /athena refuses a Host that is not a loopback name (the read guard every API GET runs)
//   daemon-url  main.ts --athena with plain http off this machine, or a user:password, exits before it binds
// Each assertion has a seeded control that must come out red: a wave.dispatch flagged reversible and internal (AUTO), a card
// naming a tool bp lacks (zero runs), a second host with no call_id record (a second run), approve in place of decline (a run),
// a daemon that accepts (not a failure), a loopback Host (200) and a loopback daemon URL (the server binds).
// BP_CHECK_ATHENA_HOST_SEED=classes|approve|replay|decline|refused|status-host|daemon-url feeds that
// control to the assertion itself, which must then FAIL and the check exit 1 (each shown red on Lynx, 2026-10-22).
// Run: node --import @bp/core/register scripts/check-athena-host.mjs   (npm run check:athena-host)   Exit 1 on any failure.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hostKettleSims } from '../apps/server/src/kettle-sim.ts';
import { loadRoutes } from '../apps/server/src/mount.ts';
import { AthenaHost, BP_TOOLS, classOf, hostRoutes, wireName } from '../apps/server/src/athena-host.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };
const SEED = process.env.BP_CHECK_ATHENA_HOST_SEED ?? '';
/** The assertion on the real run, then the same predicate on the seeded control, which must be false. Under
 *  BP_CHECK_ATHENA_HOST_SEED=<key> the assertion is given the control in place of the real run. */
const holds = (key, name, pred, real, control, seed) => {
  if (SEED === key) real = control;
  check(name, pred(real), JSON.stringify(real).slice(0, 300));
  check(`control: ${seed} turns "${name}" red`, !pred(control), JSON.stringify(control).slice(0, 300));
};

// ------------------------------------------------------------------------------------------------ section 4's table
const doc = fs.readFileSync(path.join(ROOT, 'docs/concepts/vr-light-table/tech-stack.md'), 'utf8');
const sec4 = doc.slice(doc.indexOf('## 4.'), doc.indexOf('## 5.'));
const TABLE = [...sec4.matchAll(/^\| `([\w.]+)`[^|]*\| (yes|no) \| (none|internal|external) \| (AUTO|GATED) \|\r?$/gm)]
  .map((m) => ({ name: m[1], reversible: m[2] === 'yes', side_effects: m[3], cls: m[4] }));
check(`tech-stack.md section 4 lists bp's tools (${TABLE.length} rows read)`, TABLE.length >= 7, sec4.slice(0, 200));

// ------------------------------------------------------------------------------------------------ the fake daemon
const TOKEN = 'fake-token-for-check-athena-host';
const fake = { mode: 'ok', seenToken: true, cards: new Map(), declineCarriesExecute: true, n: 0 };
const sendJson = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', connection: 'close' }); res.end(JSON.stringify(body)); };
const daemon = http.createServer((req, res) => {
  let s = '';
  req.on('data', (d) => (s += d));
  req.on('end', () => {
    if (req.headers['x-athena-token'] !== TOKEN) { fake.seenToken = false; return sendJson(res, 401, { ok: false, reason: 'unauthorized', detail: 'token' }); }
    let body = {};
    try { body = JSON.parse(s || '{}'); } catch { return sendJson(res, 400, { ok: false, reason: 'validator_failed', detail: 'json' }); }
    if (req.method === 'POST' && req.url === '/manifest') {
      if (fake.mode === 'redirect') { res.writeHead(307, { location: `${CATCH}/manifest`, connection: 'close' }); return res.end(); }
      if (fake.mode === '403') return sendJson(res, 403, { ok: false, reason: 'foreign_origin', detail: 'Open the app this is about and focus its tab, then try again.' });
      if (fake.mode === 'not-ok') return sendJson(res, 200, { ok: false, reason: 'manifest_invalid', detail: "manifest 'bp' is refused whole" });
      const tools = (body.tools ?? []).map((t) => ({ name: `host.${body.app_id}.${t.name}`, class: t.reversible === true && t.side_effects !== 'external' ? 'AUTO' : 'GATED', origin: `host:${body.app_id}`, tier: 1 }));
      return sendJson(res, 200, { ok: true, tools, showing: tools.length, total: tools.length, footer: '', app_id: body.app_id, origin: body.page_origin, registry_origin: `host:${body.app_id}` });
    }
    const m = /^\/decisions\/([^/]+)$/.exec(req.url ?? '');
    if (req.method === 'POST' && m) {
      const card = fake.cards.get(decodeURIComponent(m[1]));
      if (!card) return sendJson(res, 404, { ok: false, reason: 'unknown_ref', detail: `unknown approval ${m[1]}` });
      const execute = [{ call_id: card.call_id, name: card.action, params: card.params, origin: 'host:bp', tier: 1, approval_id: card.id }];
      if (body.choice === 'decline') return sendJson(res, 200, { ok: true, id: card.id, status: 'declined', choice: 'decline', execute: fake.declineCarriesExecute ? execute : [] });
      return sendJson(res, 200, { ok: true, id: card.id, status: 'approved', choice: 'approve', execute, output: '' });
    }
    sendJson(res, 404, { ok: false, reason: 'unknown_ref', detail: req.url });
  });
});
await new Promise((r) => daemon.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${daemon.address().port}`;
// whatever a redirect from the daemon's URL points at: it records every token that reaches it
const caught = [];
const catcher = http.createServer((req, res) => { caught.push(req.headers['x-athena-token'] ?? null); sendJson(res, 404, { ok: false }); });
await new Promise((r) => catcher.listen(0, '127.0.0.1', r));
const CATCH = `http://127.0.0.1:${catcher.address().port}`;
/** File a card for one call; returns its id. */
const card = (action, params) => { const id = `apr_${(++fake.n).toString(16).padStart(12, '0')}`; fake.cards.set(id, { id, call_id: `turn_check_${fake.n}_exec`, action, params }); return id; };

// ------------------------------------------------------------------------------------------------ the server's handlers
hostKettleSims();
const API = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@bp/core/server/api/products/route'))), '..');
const routes = await loadRoutes(API);
// count every call that reaches the wave dispatch handler: that is "a wave dispatch run", whatever the sim then answers
let dispatchRuns = 0;
const dr = routes.find((r) => r.path === '/api/products/[slug]/waves/[wave]/dispatch');
const realDispatch = dr.handlers.POST;
dr.handlers.POST = (req, ctx) => { dispatchRuns++; return realDispatch(req, ctx); };
const SELF = '127.0.0.1:3100';
const call = async (method, p, body) => {
  const url = new URL(p, `http://${SELF}`);
  let params = null;
  const r = routes.find((x) => (params = x.match(url.pathname)));
  const res = await r.handlers[method](new Request(url, { method, headers: { host: SELF, 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json() };
};
const proposed = (await call('GET', '/api/products/kettle/scan')).json.proposals.filter((p) => p.status === 'proposed').map((p) => p.id);
check(`Kettle's sample has proposed findings to build waves from (${proposed.length})`, proposed.length >= 4);
let nWave = 0;
const draftWave = async () => (await call('POST', '/api/products/kettle/waves', { name: `Check ${++nWave}`, packages: [{ name: 'One', model: 'sonnet', effort: 'low', ids: [proposed[nWave - 1]] }] })).json.wave.id;
const jobsOf = async (wave) => (await call('GET', '/api/products/kettle/scans')).json.filter((j) => j.kind === 'execute' && j.wave === wave).length;

const mkHost = (o = {}) => new AthenaHost({ url: URL_, token: TOKEN, pageOrigin: 'http://localhost:3100', routes, selfHost: SELF, ...o });
const host = mkHost();
// answer through the host's own route, as POST /athena/decisions/<id> would be called
const [, answerRoute] = hostRoutes(host);
const answer = async (id, choice) => {
  const res = await answerRoute.handlers.POST(new Request(`http://${SELF}/athena/decisions/${id}`, { method: 'POST', headers: { host: SELF, 'content-type': 'application/json' }, body: JSON.stringify({ choice }) }), { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json() };
};

try {
  // ---------------------------------------------------------------------------------------------- manifest
  const reg = await host.register();
  const asTable = (tools, registered) => ({
    names: tools.map((t) => t.name).sort().join(','), flags: tools.map((t) => `${t.name}:${t.reversible}:${t.side_effects}:${t.cls}:${classOf(t)}`).sort().join(','),
    classes: registered.ok ? registered.tools.map((t) => `${t.name}=${t.class}`).sort().join(',') : `refused ${registered.reason}`,
  });
  const want = {
    names: TABLE.map((t) => t.name).sort().join(','), flags: TABLE.map((t) => `${t.name}:${t.reversible}:${t.side_effects}:${t.cls}:${t.cls}`).sort().join(','),
    classes: TABLE.map((t) => `host.bp.${wireName(t.name)}=${t.cls}`).sort().join(','),
  };
  const matchesTable = (x) => x.names === want.names && x.flags === want.flags && x.classes === want.classes;
  const bent = BP_TOOLS.map((t) => (t.name === 'wave.dispatch' ? { ...t, reversible: true, side_effects: 'internal' } : t));
  const bentReg = await mkHost({ tools: bent }).register();
  holds('classes', 'manifest: tool names, flags and the classes the daemon derives are section 4\'s table', matchesTable, asTable(BP_TOOLS, reg), asTable(bent, bentReg), 'wave.dispatch flagged reversible and internal');
  check('manifest: the token went in X-Athena-Token on every request', fake.seenToken);

  // ---------------------------------------------------------------------------------------------- approve
  const w1 = await draftWave();
  const c1 = card('host.bp.wave_dispatch', { slug: 'kettle', wave: w1 });
  const before = dispatchRuns;
  const a1 = await answer(c1, 'approve');
  const ranOnce = (x) => x.runs === 1 && x.jobs === 1 && x.ok;
  const wc = await draftWave();
  const cc = card('host.bp.wave_dispatchh', { slug: 'kettle', wave: wc });
  const bc = dispatchRuns, ac = await answer(cc, 'approve');
  holds('approve', 'approve: one wave.dispatch card approved runs the wave\'s dispatch exactly once (one execute job)', ranOnce,
    { runs: dispatchRuns - before, jobs: await jobsOf(w1), ok: a1.status === 200 && a1.json.ran?.[0]?.ok === true && a1.json.ran[0].status === 202 },
    { runs: dispatchRuns - bc, jobs: await jobsOf(wc), ok: ac.status === 200 }, 'a card naming a tool bp lacks');

  // ---------------------------------------------------------------------------------------------- replay
  const b2 = dispatchRuns;
  const a2 = await answer(c1, 'approve');
  const again = await host.execute([{ call_id: fake.cards.get(c1).call_id, name: 'host.bp.wave_dispatch', params: { slug: 'kettle', wave: w1 }, origin: 'host:bp' }]);
  const b3 = dispatchRuns, replayed = { runs: b3 - b2, jobs: await jobsOf(w1) };
  const noMore = (x) => x.runs === 0 && x.jobs === 1;
  await mkHost().execute([{ call_id: fake.cards.get(c1).call_id, name: 'host.bp.wave_dispatch', params: { slug: 'kettle', wave: w1 }, origin: 'host:bp' }]);
  holds('replay', 'replay: the same call_id again (the card re-approved, the entry re-sent) runs zero more dispatches', noMore,
    replayed, { runs: dispatchRuns - b3, jobs: await jobsOf(w1) }, 'a second host with no call_id record');
  check('replay: the replayed results say so', a2.json.ran?.[0]?.replayed === true && again[0]?.replayed === true, JSON.stringify([a2.json.ran, again]).slice(0, 200));

  // ---------------------------------------------------------------------------------------------- decline
  const w3 = await draftWave();
  const c3 = card('host.bp.wave_dispatch', { slug: 'kettle', wave: w3 });
  const b4 = dispatchRuns, d3 = await answer(c3, 'decline'), declined = { runs: dispatchRuns - b4, jobs: await jobsOf(w3), ran: d3.json.ran?.length };
  const w4 = await draftWave();
  const c4 = card('host.bp.wave_dispatch', { slug: 'kettle', wave: w4 });
  const b5 = dispatchRuns;
  await answer(c4, 'approve');
  holds('decline', 'decline: runs nothing, though the daemon\'s answer carried an execute', (x) => x.runs === 0 && x.jobs === 0 && x.ran === 0,
    declined, { runs: dispatchRuns - b5, jobs: await jobsOf(w4), ran: 1 }, 'approve in place of decline');

  // ---------------------------------------------------------------------------------------------- refused
  const failure = (r) => r.threw === false && r.ok === false && typeof r.reason === 'string' && r.reason.length > 0;
  const tryRegister = async (h) => { try { const r = await h.register(); return { threw: false, ...r }; } catch (e) { return { threw: true, ok: false, reason: String(e) }; } };
  fake.mode = '403';
  const r403 = await tryRegister(mkHost());
  fake.mode = 'not-ok';
  const rBody = await tryRegister(mkHost());
  const dead = http.createServer();
  await new Promise((r) => dead.listen(0, '127.0.0.1', r));
  const deadUrl = `http://127.0.0.1:${dead.address().port}`;
  await new Promise((r) => dead.close(r));
  const rNone = await tryRegister(mkHost({ url: deadUrl }));
  fake.mode = 'redirect';
  const rRedirect = await tryRegister(mkHost());
  fake.mode = 'ok';
  const rOk = await tryRegister(mkHost());
  holds('refused', 'refused: a 403 manifest is a reported failure, not a throw', failure, r403, rOk, 'a daemon that accepts');
  check('refused: a 200 with a non-ok body is a reported failure, not a throw', failure(rBody) && rBody.status === 200, JSON.stringify(rBody));
  check('refused: no daemon listening is a reported failure, not a throw', failure(rNone) && rNone.reason === 'unreachable', JSON.stringify(rNone));
  check('refused: no failure detail carries the token', ![r403, rBody, rNone].some((r) => JSON.stringify(r).includes(TOKEN)));
  // a redirect is not followed: fetch keeps a custom header across origins, so following one hands the token to its target
  check('redirect: a 307 from the daemon is a reported failure and the token never reaches its target', failure(rRedirect) && rRedirect.status === 307 && caught.length === 0,
    JSON.stringify({ rRedirect, caught: caught.map((t) => (t === TOKEN ? '<token>' : t)) }));

  // ---------------------------------------------------------------------------------------------- GET /athena
  // a DNS-rebound page reaches the server from a loopback peer with its own name in Host: the read guard every other GET
  // runs (localHost) must refuse it here too, or the page reads the daemon's URL and port and the registration detail
  const [statusRoute] = hostRoutes(host);
  const getStatus = async (h) => (await statusRoute.handlers.GET(new Request(`http://${SELF}/athena`, { headers: { host: h } }), { params: Promise.resolve({}) })).status;
  holds('status-host', 'GET /athena: a Host that is not a loopback name (DNS rebinding) is refused 403', (s) => s === 403,
    await getStatus('rebind.example:3100'), await getStatus(SELF), 'a loopback Host');

  // ---------------------------------------------------------------------------------------------- daemon URL
  // main.ts with --athena: plain http to a host off this machine would send the token in clear, and a user:password in the
  // URL would be printed and served by GET /athena. Either must stop the server before it binds; a loopback URL must not.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-check-athena-host-'));
  try {
    const tokenFile = path.join(tmp, 'daemon.json');
    fs.writeFileSync(tokenFile, JSON.stringify({ token: TOKEN }));
    const startsFor = (url) => new Promise((resolve) => {
      const child = spawn(process.execPath, ['--import', '@bp/core/register', path.join(ROOT, 'apps/server/src/main.ts'), '--port', '0', '--athena', url, '--athena-token-file', tokenFile], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let out = '';
      const done = (r) => { clearTimeout(t); child.kill(); resolve({ ...r, out: out.split(TOKEN).join('<token>').trim().split('\n').slice(-2).join(' | ') }); };
      const t = setTimeout(() => done({ exited: null, listened: false }), 30000);
      child.stdout.on('data', (d) => { out += d; if (/bp server listening on/.test(out)) done({ exited: null, listened: true }); });
      child.stderr.on('data', (d) => { out += d; });
      child.on('exit', (code) => done({ exited: code, listened: false }));
    });
    const refusedBeforeBind = (r) => r.exited === 1 && !r.listened;
    const offBox = await startsFor('http://192.0.2.1:9'), withUser = await startsFor(`http://me:pw@127.0.0.1:${daemon.address().port}`);
    holds('daemon-url', 'daemon URL: plain http to a host off this machine stops the server before it binds', refusedBeforeBind, offBox, await startsFor(URL_), 'a loopback daemon URL');
    check('daemon URL: a user:password in the URL stops the server before it binds', refusedBeforeBind(withUser), JSON.stringify(withUser));
    let threw = '';
    try { mkHost({ url: 'http://192.0.2.1:9' }); } catch (e) { threw = e.message; }
    check('daemon URL: the host itself refuses a plain-http daemon off this machine', /loopback/.test(threw), threw || 'constructed');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
} finally {
  daemon.close();
  daemon.closeAllConnections();
  catcher.close();
  catcher.closeAllConnections();
}
console.log(`\ncheck-athena-host: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
