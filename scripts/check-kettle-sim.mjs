#!/usr/bin/env node
// apps/server hosts the Kettle sample's sims in memory (wolf-plan L5.2; packages/core/src/server/kettle-sim.server.ts).
// Starts the headless server on a free port in an empty temp working directory (no products file) and checks:
//   stream   GET /api/products/kettle/stream answers SSE: `snapshot` first (the sample's findings, no scan run), and after a
//            scan POST a `jobs` and a `delta` carrying the scan's run, then its first measurements
//   writes   POST /api/products/kettle/scans: 202 with the sim's job, a bad scope 400 (a label over 200 too; unknown scope keys
//            are dropped, so a job keeps no stuffed body); GET scans and GET scan see it; a wave
//            POST 201, listed by GET waves; POST dispatch 202 (the finding approved); DELETE scans/<job> cancels (200)
//   disk     nothing was written: a listing (path, size, mtime, sha256) of packages/core/data and of the server's working
//            directory is the same before the server starts and after it has exited
// Control (every run): the listing compare goes red on a file planted in a copy of the working directory, and on a data
// file whose bytes changed in a copy, so a compare that stops seeing writes fails the check. BP_CHECK_KETTLE_SIM_SEED=1
// also plants a file in the server's working directory mid-run, to show the disk check itself fails.
// Run: node scripts/check-kettle-sim.mjs   Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'packages/core/data');
const LENS = 'development';
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every entry under `dir` (directories too, so an empty one made counts): `rel size mtime sha256`, sorted. */
function listing(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name), rel = path.relative(dir, p).split(path.sep).join('/'), st = fs.statSync(p);
      if (e.isDirectory()) { out.push(`${rel}/ dir ${st.mtimeMs}`); walk(p); }
      else out.push(`${rel} ${st.size} ${st.mtimeMs} ${crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}`);
    }
  };
  walk(dir);
  return out.sort();
}
/** The lines one listing has and the other lacks. */
const diff = (a, b) => { const x = new Set(a), y = new Set(b); return [...a.filter((l) => !y.has(l)).map((l) => '- ' + l), ...b.filter((l) => !x.has(l)).map((l) => '+ ' + l)]; };

// ------------------------------------------------------------------------------------------------ the control
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-kettle-sim-ctl-'));
  try {
    const wd = path.join(tmp, 'wd'), data = path.join(tmp, 'data');
    fs.mkdirSync(wd);
    fs.cpSync(DATA, data, { recursive: true, preserveTimestamps: true });
    const w0 = listing(wd), d0 = listing(data);
    check('control: an untouched copy lists the same', !diff(w0, listing(wd)).length && !diff(d0, listing(data)).length && d0.length > 0);
    fs.mkdirSync(path.join(wd, '.ai/lens-scan'), { recursive: true });
    fs.writeFileSync(path.join(wd, '.ai/lens-scan/scan.db'), 'x');
    check('control: a file planted in the working directory is seen', diff(w0, listing(wd)).some((l) => l.includes('scan.db')));
    const f = path.join(data, 'kettle.events.jsonl'), st = fs.statSync(f);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/.$/s, ' '));
    fs.utimesSync(f, st.atime, st.mtime); // same size and mtime: only the hash can tell
    check('control: a data file whose bytes changed (same size and mtime) is seen', diff(d0, listing(data)).some((l) => l.includes('kettle.events.jsonl')));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// ------------------------------------------------------------------------------------------------ the server
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-kettle-sim-'));
const before = { data: listing(DATA), cwd: listing(cwd) };
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

const req = (method, p, body) => new Promise((resolve) => {
  const headers = { host: `localhost:${port}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) };
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
    let s = ''; res.on('data', (d) => (s += d)); res.on('end', () => { let json = null; try { json = JSON.parse(s); } catch { /* not JSON */ } resolve({ status: res.statusCode, body: s, json }); });
  });
  r.on('error', (e) => resolve({ status: 0, body: e.message, json: null }));
  if (body !== undefined) r.write(JSON.stringify(body));
  r.end();
});

/** An open SSE connection: its status, content type and the events so far, parsed. */
function sse(p) {
  const s = { status: 0, type: '', events: [], close: () => {} };
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: { host: `localhost:${port}`, accept: 'text/event-stream' } }, (res) => {
      s.status = res.statusCode; s.type = String(res.headers['content-type']);
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => {
        buf += d;
        for (let i; (i = buf.indexOf('\n\n')) >= 0; ) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/m.exec(block)?.[1], data = /^data: (.*)$/m.exec(block)?.[1];
          if (ev) { let json = null; try { json = JSON.parse(data ?? ''); } catch { /* reported by the checks */ } s.events.push({ ev, data: json }); }
        }
      });
      s.close = () => r.destroy();
      resolve(s);
    });
    r.on('error', () => resolve(s));
    r.end();
  });
}
async function until(pred, ms = 15000) { const t = Date.now() + ms; while (Date.now() < t) { if (pred()) return true; await sleep(50); } return pred(); }

try {
  check('the server starts and prints its port', port > 0, out.trim().split('\n').slice(-5).join(' | '));
  if (port > 0) {
    const st = await sse('/api/products/kettle/stream');
    check('stream: 200 text/event-stream', st.status === 200 && /text\/event-stream/.test(st.type), `${st.status} ${st.type}`);
    await until(() => st.events.length > 0, 5000);
    const first = st.events[0];
    check('stream: the first event is a snapshot of the sample (its findings, no scan run yet)', first?.ev === 'snapshot' && first.data?.proposals?.length > 0 && Array.isArray(first.data?.runs) && !first.data.runs.some((r) => r.id.startsWith('run-sim-')),
      `${first?.ev} ${first?.data?.proposals?.length} proposals ${first?.data?.runs?.length} runs`);

    const bad = await req('POST', '/api/products/kettle/scans', { lens: LENS, scope: { kind: 'room', id: 'r', label: 'R', features: ['no-such-feature'] } });
    check('scans: a scope of an unknown feature: 400 bad-scope', bad.status === 400 && bad.json?.error === 'bad-scope', `${bad.status} ${bad.body.slice(0, 80)}`);
    // the scope the sim keeps is the route's own parse, as for a live product: no unknown keys, a label of at most 200
    const stuffed = await req('POST', '/api/products/kettle/scans', { lens: LENS, scope: { kind: 'all', label: 'Everything', features: [], junk: 'x'.repeat(100000) } });
    check('scans: a scope\'s unknown keys are dropped before the sim keeps the job', stuffed.status === 202 && !!stuffed.json?.scope && !('junk' in stuffed.json.scope) && stuffed.body.length < 2000, `${stuffed.status} ${stuffed.body.length} bytes`);
    if (stuffed.json?.id) await req('DELETE', `/api/products/kettle/scans/${stuffed.json.id}`);
    const longLabel = await req('POST', '/api/products/kettle/scans', { lens: LENS, scope: { kind: 'all', label: 'x'.repeat(201), features: [] } });
    check('scans: a scope label over 200 characters: 400 bad-scope', longLabel.status === 400 && longLabel.json?.error === 'bad-scope', `${longLabel.status} ${longLabel.body.slice(0, 80)}`);
    const noLens = await req('POST', '/api/products/kettle/scans', { lens: 'no.such.lens', scope: { kind: 'all', label: 'x'.repeat(201), features: [] } });
    check('scans: an unknown lens with a bad scope: still 400 unknown-lens (the lens is checked first)', noLens.status === 400 && noLens.json?.error === 'unknown-lens', `${noLens.status} ${noLens.body.slice(0, 80)}`);
    const scan = await req('POST', '/api/products/kettle/scans', { lens: LENS, scope: { kind: 'all', label: 'Everything', features: [] } });
    const job = scan.json;
    check(`scans: POST a ${LENS} scan of everything: 202 with the sim's measure job`, scan.status === 202 && job?.kind === 'measure' && job?.lens === LENS && typeof job?.id === 'string', `${scan.status} ${scan.body.slice(0, 120)}`);

    const runId = 'run-' + job?.id;
    const deltaRun = () => st.events.findIndex((e) => e.ev === 'delta' && e.data?.runs?.some((r) => r.id === runId));
    const deltaMs = () => st.events.findIndex((e) => e.ev === 'delta' && e.data?.measurements?.some((m) => m.run_id === runId));
    await until(() => deltaMs() >= 0);
    check('stream: a jobs event names the scan job', st.events.some((e) => e.ev === 'jobs' && Array.isArray(e.data) && e.data.some((j) => j.id === job?.id)), st.events.map((e) => e.ev).join(','));
    check('stream: then a delta carries the scan\'s run', deltaRun() > 0, st.events.map((e) => e.ev).join(','));
    check('stream: and a later delta its first measurements', deltaMs() > 0 && st.events[deltaMs()].data.measurements.every((m) => m.lens === LENS), st.events.map((e) => e.ev).join(','));
    check('stream: exactly one snapshot, first', st.events.filter((e) => e.ev === 'snapshot').length === 1 && st.events[0].ev === 'snapshot', st.events.map((e) => e.ev).join(','));

    const jobs = await req('GET', '/api/products/kettle/scans');
    check('scans: GET lists the job', jobs.status === 200 && Array.isArray(jobs.json) && jobs.json.some((j) => j.id === job?.id && (j.status === 'running' || j.status === 'queued')), `${jobs.status} ${jobs.body.slice(0, 120)}`);
    const snap = await req('GET', '/api/products/kettle/scan');
    check('scan: GET answers the sim\'s snapshot, with the run', snap.status === 200 && snap.json?.runs?.some((r) => r.id === runId) && snap.json.measurements.length > 0, `${snap.status} ${snap.body.slice(0, 80)}`);

    const fid = first?.data?.proposals?.find((p) => p.status === 'proposed')?.id;
    const wave = await req('POST', '/api/products/kettle/waves', { name: 'Check wave', packages: [{ name: 'One', model: 'sonnet', effort: 'low', ids: [fid] }] });
    check('waves: POST a draft wave: 201', wave.status === 201 && wave.json?.wave?.status === 'draft', `${wave.status} ${wave.body.slice(0, 120)}`);
    const waves = await req('GET', '/api/products/kettle/waves');
    check('waves: GET lists it', waves.status === 200 && waves.json?.waves?.some((w) => w.id === wave.json?.wave?.id), `${waves.status} ${waves.body.slice(0, 120)}`);
    const disp = await req('POST', '/api/products/kettle/dispatch', { ids: [fid] });
    check('dispatch: POST a proposed finding: 202, approved, one execute job', disp.status === 202 && disp.json?.approved?.includes(fid) && disp.json?.job?.kind === 'execute', `${disp.status} ${disp.body.slice(0, 120)}`);
    await until(() => st.events.some((e) => e.ev === 'delta' && e.data?.proposals?.some((p) => p.id === fid && p.status !== 'proposed')), 5000);
    check('stream: a delta carries the dispatched finding\'s new status', st.events.some((e) => e.ev === 'delta' && e.data?.proposals?.some((p) => p.id === fid && p.status !== 'proposed')));
    const cancel = await req('DELETE', `/api/products/kettle/scans/${job?.id}`);
    check('scans: DELETE cancels the scan: 200 cancelled', cancel.status === 200 && cancel.json?.status === 'cancelled', `${cancel.status} ${cancel.body.slice(0, 80)}`);
    const dj = disp.json?.job?.id;
    if (dj) await req('DELETE', `/api/products/kettle/scans/${dj}`);
    st.close();
    if (process.env.BP_CHECK_KETTLE_SIM_SEED === '1') fs.writeFileSync(path.join(cwd, 'seeded-write.txt'), 'the seeded control');
  }
} finally {
  // the child holds its working directory until it has exited (Windows), so wait before listing and removing it
  if (child.exitCode === null) await new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
  const after = { data: listing(DATA), cwd: listing(cwd) };
  const dd = diff(before.data, after.data), dc = diff(before.cwd, after.cwd);
  check(`disk: packages/core/data unchanged (${before.data.length} entries, hashes and mtimes)`, before.data.length > 0 && !dd.length, dd.slice(0, 4).join('; '));
  check('disk: the server\'s working directory unchanged (nothing written)', !dc.length, dc.slice(0, 4).join('; '));
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(`\ncheck-kettle-sim: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
