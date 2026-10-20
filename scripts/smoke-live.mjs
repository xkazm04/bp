#!/usr/bin/env node
// The live-product smoke over HTTP: seeds the demo product (scan-demo.mjs, idempotent) and walks the product routes
// against a running server, so the same smoke proves either mount: the web app (`npm start`, :3000) or the headless
// server (`npm run server`, apps/server). Reads, the SSE stream, a wave written and deleted, a shot, the guards (a
// foreign Host, a foreign Origin, a non-JSON write) and the 404s. Writes touch only .demo/kettle-live (gitignored).
// Run: node scripts/smoke-live.mjs [base]   (base defaults to $BP_BASE, else http://localhost:3000)
// Exit 1 on any failed step.
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] || process.env.BP_BASE || 'http://localhost:3000').replace(/\/$/, '');
const SLUG = 'kettle-live', API = `${BASE}/api/products/${SLUG}`;

const seed = spawnSync(process.execPath, [path.join(ROOT, 'scripts/scan-demo.mjs')], { cwd: ROOT, encoding: 'utf8' });
if (seed.status !== 0) { console.error(`scan-demo failed:\n${seed.stderr}`); process.exit(1); }

let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };
const get = async (url, headers = {}) => { const r = await fetch(url, { headers }); return { status: r.status, type: r.headers.get('content-type') ?? '', body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.arrayBuffer() }; };
const send = async (method, url, body, headers = {}) => {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

try {
  const list = await get(`${BASE}/api/products`);
  const demo = Array.isArray(list.body) ? list.body.find((p) => p.slug === SLUG) : undefined;
  check('GET /api/products lists kettle-live with its store', list.status === 200 && !!demo?.readiness?.store, `${list.status}`);

  const st = await get(`${API}/structure`);
  check('GET structure: the v3 map, its events and a rev', st.status === 200 && st.body?.structure?.version === 3 && typeof st.body?.rev === 'string' && Array.isArray(st.body?.structure?.features), `${st.status}`);
  const nFeatures = st.body?.structure?.features?.length ?? 0;
  check('GET structure: 133 features (the Kettle map)', nFeatures === 133, `${nFeatures}`);

  const scan = await get(`${API}/scan`);
  const runs = scan.body?.runs ?? [], proposals = scan.body?.proposals ?? [];
  check('GET scan: two seeded runs and the proposals', scan.status === 200 && runs.length >= 2 && proposals.length >= 1, `${scan.status} runs=${runs.length} proposals=${proposals.length}`);

  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 8000);
  let first = '';
  try {
    const r = await fetch(`${API}/stream`, { signal: ac.signal });
    const rd = r.body.getReader(), dec = new TextDecoder();
    while (!first.includes('\n\n')) { const { value, done } = await rd.read(); if (done) break; first += dec.decode(value, { stream: true }); }
    check('GET stream: text/event-stream opening with a snapshot event', r.headers.get('content-type')?.startsWith('text/event-stream') && /^event: snapshot\ndata: \{/.test(first), first.slice(0, 80));
    ac.abort();
  } catch (e) { check('GET stream: text/event-stream opening with a snapshot event', false, e.message); } finally { clearTimeout(t); }

  const jobs = await get(`${API}/scans`);
  check('GET scans: the job list (an array)', jobs.status === 200 && Array.isArray(jobs.body), `${jobs.status}`);

  const open = proposals.filter((p) => p.status === 'proposed').map((p) => p.id).slice(0, 2);
  const made = await send('POST', `${API}/waves`, { name: 'smoke wave', packages: [{ name: 'smoke', model: 'sonnet', effort: 'low', ids: open }] });
  const wave = made.body?.wave;
  check('POST waves: a draft wave of the open findings (201)', made.status === 201 && wave?.packages?.[0]?.id === 'pk-1', `${made.status} ${JSON.stringify(made.body).slice(0, 120)}`);
  const waves = await get(`${API}/waves`);
  check('GET waves: lists it', waves.status === 200 && (waves.body?.waves ?? []).some((w) => w.id === wave?.id), `${waves.status}`);
  if (wave?.id) {
    const del = await send('DELETE', `${API}/waves/${encodeURIComponent(wave.id)}`);
    check('DELETE waves/<id>: removed (200)', del.status === 200 && del.body?.id === wave.id, `${del.status}`);
  }

  const shot = (scan.body?.measurements ?? []).flatMap((m) => m.shots ?? []).concat(scan.body?.shots ?? []).find((s) => typeof s?.path === 'string');
  if (shot) {
    const img = await get(`${API}/shots/${shot.path.replace(/^shots\//, '')}`);
    check('GET shots/<path>: the seeded PNG', img.status === 200 && img.type.startsWith('image/png'), `${img.status} ${img.type}`);
  } else check('GET shots/<path>: a seeded shot to fetch', false, 'no shot path in the scan snapshot');

  // fetch will not send another Host, so this one goes through node:http
  const foreign = await new Promise((resolve) => {
    const u = new URL(`${API}/scan`);
    http.get({ host: u.hostname, port: u.port, path: u.pathname, headers: { host: 'evil.example' } }, (r) => { r.resume(); resolve({ status: r.statusCode }); })
      .on('error', (e) => resolve({ status: 0, body: e.message }));
  });
  check('guard: a foreign Host is refused (403)', foreign.status === 403, `${foreign.status}`);
  const cross = await send('POST', `${API}/waves`, { name: 'x', packages: [] }, { origin: 'http://evil.example' });
  check('guard: a write from a foreign Origin is refused (403)', cross.status === 403, `${cross.status}`);
  const plain = await send('POST', `${API}/waves`, 'name=x', { 'content-type': 'text/plain' });
  check('guard: a non-JSON write is refused (415)', plain.status === 415, `${plain.status}`);

  const none = await get(`${BASE}/api/products/no-such-product/structure`);
  check('GET an unknown product: 404', none.status === 404, `${none.status}`);
} catch (e) {
  check(`reach ${BASE}`, false, e.cause?.code ?? e.message);
}
console.log(`\nsmoke-live ${BASE}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
