#!/usr/bin/env node
// Tripo 3D API v3 client for look-dev experiments: one task per call, logged, capped. Dependency-free (Node's fetch and fs).
// API: https://openapi.tripo3d.ai/v3 (international, "ov"; developers.tripo3d.ai). The China site (.com) is another account.
//
//   node scripts/lookdev/tripo.mjs balance                              the account's available and frozen credits
//   node scripts/lookdev/tripo.mjs total                                credits the log records, against EXPERIMENT_CAP
//   node scripts/lookdev/tripo.mjs estimate --endpoint <e> --body <json>   what a task would cost, no call
//   node scripts/lookdev/tripo.mjs run --endpoint generation/multiview-to-model --body body.json --out <dir> --name t1
//        [--cap 150] [--dry-run] [--note "why"]
//   node scripts/lookdev/tripo.mjs task <task_id> [--out <dir> --name n]   re-read a task and (re)download its outputs
//
// --body is a JSON file. Any string value "@file:<path>" is uploaded first (POST /v3/files) and replaced by its
// file_token; any "@task:<name>" is replaced by the task_id the log holds for that run name. Every output URL in the
// finished task (model_url, pbr_model_url, rendered_image_url, ...) is downloaded at once into --out: the URLs are
// signed and temporary, so only the files are kept (the log records the file names, never the URLs' signatures).
//
// Spend: a task is refused before any network call when its estimate (PRICES, the published table) is over --cap, or
// when the log's total plus the estimate would pass EXPERIMENT_CAP. The balance is read before and after; the log
// records credits_consumed as Tripo reports it, the balance delta, and the estimate. Failed tasks are refunded by Tripo.
//
// The key is TRIPO_API_KEY, read at run time from THIS checkout's untracked .env. It is never printed, logged or
// written anywhere; neither is the authorization header. Everything that reaches stdout or the log passes redact().
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'docs/concepts/vr-light-table/lookdev');
const LOG = path.join(DIR, 'tripo-log.jsonl');
const ENV_FILE = path.join(ROOT, '.env');
const API = 'https://openapi.tripo3d.ai/v3';
const EXPERIMENT_CAP = 1000; // of the owner's 1,500 credits for the 2026-10-25 experiment
const DEFAULT_RUN_CAP = 150;
const POLL_MS = 3000;
const POLL_LIMIT_MS = 15 * 60 * 1000;

// Published credit prices (developers.tripo3d.ai/en/pricing and /en/docs/changelog, read 2026-10-25). 1 credit = $0.01.
export const PRICES = {
  h: { 'text-to-model': [10, 20], 'image-to-model': [20, 30], 'multiview-to-model': [20, 30] }, // [no texture, texture]
  hAddons: { textureDetailed: 10, textureExtreme: 20, geometryDetailed: 20, quad: 5, smartLowPoly: 10, generateParts: 20 },
  p: { none: 100, standard: 110, detailed: 120, extreme: 130 }, // P2-20260801 (changelog); P1 assumed the same
  decimate: { 'v3.0': 35, 'v3.0-quad': 40, 'v2.0': 30, 'v1.0': 10 },
  'mesh/segment': 40, 'mesh/complete': 50, 'mesh/uv': 20, 'mesh/smartsegment': { image: 85, model: 55 },
  'models/convert': 10, 'models/texture': { standard: 10, fast: 10, detailed: 20, extreme: 30 },
  'generation/text-to-image': 10, 'generation/image-to-image': 10, 'generation/image-to-multiview': 10,
};

/** The credits a task should cost by the published table; a deliberately high figure for anything unlisted. */
export function estimate(endpoint, body = {}) {
  const ep = endpoint.replace(/^\/?(v3\/)?/, '');
  const m = /^generation\/((?:text|image|multiview)-to-model)$/.exec(ep);
  if (m) {
    const textured = body.texture !== false || body.pbr === true; // texture and pbr both default to true
    const tq = body.texture_quality ?? 'standard';
    if (/^P\d/.test(body.model ?? '')) return textured ? PRICES.p[tq] ?? PRICES.p.extreme : PRICES.p.none;
    const a = PRICES.hAddons;
    let c = PRICES.h[m[1]][textured ? 1 : 0];
    if (textured && tq === 'detailed') c += a.textureDetailed;
    if (textured && tq === 'extreme') c += a.textureExtreme;
    if (body.geometry_quality === 'detailed') c += a.geometryDetailed;
    if (body.quad) c += a.quad;
    if (body.smart_low_poly) c += a.smartLowPoly;
    if (body.generate_parts) c += a.generateParts;
    return c;
  }
  if (ep === 'mesh/decimate') {
    const v = body.model ?? 'v2.0';
    return v === 'v3.0' ? PRICES.decimate[body.quad ? 'v3.0-quad' : 'v3.0'] : PRICES.decimate[v] ?? 40;
  }
  if (ep === 'mesh/smartsegment') return PRICES[ep][body.seg_type] ?? 85;
  if (ep === 'models/texture') return PRICES[ep][body.texture_quality ?? 'standard'] ?? 30;
  if (typeof PRICES[ep] === 'number') return PRICES[ep];
  return 150;
}

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i > 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(`--${name}`);

/** `text` with every copy of the key replaced: every API reply passes through here before it is parsed. */
export const unkey = (text, key) => (key ? String(text).replaceAll(key, '[redacted]') : String(text));
/** What may reach stdout or the log: no key, and no signed-URL query (a temporary download credential). */
export const redact = (text, key) => unkey(text, key).replace(/(https:\/\/[^\s"'?]+)\?[^\s"']*/g, '$1?[signed]');

const readLog = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
/** Credits the log has spent: Tripo's own figure where it gave one, else the balance delta, else the estimate. */
export const spent = (log) => log.filter((e) => !e.dryRun).reduce((n, e) => n + (Number(e.credits) || 0), 0);

function readKey() {
  const m = fs.readFileSync(ENV_FILE, 'utf8').match(/^\s*TRIPO_API_KEY\s*=\s*(.+?)\s*$/m);
  if (!m) throw new Error(`TRIPO_API_KEY not found in this checkout's .env`);
  return m[1].replace(/^['"]|['"]$/g, '');
}

async function call(key, method, url, body, form) {
  const res = await fetch(url, {
    method,
    headers: { accept: 'application/json', authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = unkey(await res.text(), key);
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  if (!res.ok || (json.code !== undefined && json.code !== 0)) throw new Error(redact(`${method} ${url.replace(API, '')} -> HTTP ${res.status}: ${JSON.stringify(json).slice(0, 500)}`, key));
  return json.data ?? json;
}

async function balance(key) {
  try { const b = await call(key, 'GET', `${API}/account/balance`); return { balance: Number(b.balance), frozen: Number(b.frozen) }; } catch { return null; }
}

async function upload(key, file) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
  const d = await call(key, 'POST', `${API}/files`, null, form);
  if (!d.file_token) throw new Error(`no file_token for ${path.basename(file)}`);
  return d.file_token;
}

/** Walks the body, uploading every "@file:" and resolving every "@task:"; returns the resolved copy and what it did. */
async function resolveBody(key, body, dry) {
  const uploads = [];
  const log = readLog();
  const walk = async (v) => {
    if (typeof v === 'string' && v.startsWith('@file:')) {
      const f = path.resolve(v.slice(6));
      if (!fs.existsSync(f)) throw new Error(`no such file ${f}`);
      const token = dry ? `dry_${path.basename(f)}` : await upload(key, f);
      uploads.push({ file: path.basename(f), token });
      return token;
    }
    if (typeof v === 'string' && v.startsWith('@task:')) {
      const hit = log.filter((e) => e.name === v.slice(6) && e.taskId && e.status === 'success').pop();
      if (!hit) throw new Error(`no successful run named ${v.slice(6)} in the log`);
      return hit.taskId;
    }
    if (Array.isArray(v)) return Promise.all(v.map(walk));
    if (v && typeof v === 'object') return Object.fromEntries(await Promise.all(Object.entries(v).map(async ([k, x]) => [k, await walk(x)])));
    return v;
  };
  return { resolved: await walk(body), uploads };
}

/** Downloads every *_url (and nested url) of a finished task's output; returns [{field, file, bytes}]. */
async function downloadOutputs(output, outDir, name) {
  const files = [];
  const urls = [];
  const collect = (o, pre) => {
    for (const [k, v] of Object.entries(o ?? {})) {
      if (typeof v === 'string' && /^https?:\/\//.test(v)) urls.push([pre + k, v]);
      else if (v && typeof v === 'object') collect(v, `${pre}${k}.`);
    }
  };
  collect(output, '');
  fs.mkdirSync(outDir, { recursive: true });
  for (const [field, url] of urls) {
    const ext = (path.extname(new URL(url).pathname) || '.bin').toLowerCase();
    const dest = path.join(outDir, `${name}--${field.replace(/[^\w.-]/g, '_')}${ext}`);
    // A short retry for a transient CDN error; the URL itself must be the unredacted signed one (redact() strips it).
    let res;
    for (let i = 0; i < 6; i++) { res = await fetch(url); if (res.ok) break; await sleep(5000); }
    if (!res.ok) { files.push({ field, error: `HTTP ${res.status}` }); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    files.push({ field, file: path.basename(dest), bytes: buf.length });
  }
  return files;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(key, taskId) {
  const t0 = Date.now();
  for (;;) {
    const t = await call(key, 'GET', `${API}/tasks/${taskId}`);
    if (['success', 'failed', 'cancelled', 'banned', 'expired'].includes(t.status)) return t;
    if (Date.now() - t0 > POLL_LIMIT_MS) return { ...t, status: 'TIMEOUT' };
    await sleep(POLL_MS);
  }
}

async function run() {
  const endpoint = opt('endpoint');
  const bodyFile = opt('body');
  const name = opt('name');
  const outDir = opt('out');
  const cap = Number(opt('cap', DEFAULT_RUN_CAP));
  const dry = flag('dry-run');
  if (!endpoint || !bodyFile || !name || !outDir) throw new Error('run needs --endpoint --body --name --out');
  const body = JSON.parse(fs.readFileSync(bodyFile, 'utf8'));
  const est = estimate(endpoint, body);
  const before = spent(readLog());
  if (est > cap) { console.error(`REFUSED: estimate ${est} is over the run cap ${cap}`); process.exit(2); }
  if (before + est > EXPERIMENT_CAP) { console.error(`REFUSED: logged ${before} + estimate ${est} would pass the experiment cap ${EXPERIMENT_CAP}`); process.exit(2); }
  const entry = { time: new Date().toISOString(), name, endpoint, note: opt('note') ?? null, params: body, estimate: est, dryRun: dry, taskId: null, status: 'ERROR', credits: 0, creditsSource: null, balanceBefore: null, balanceAfter: null, outDir: outDir.split(path.sep).join('/'), files: [] };
  let key = null;
  try {
    if (dry) {
      const { resolved, uploads } = await resolveBody(null, body, true);
      Object.assign(entry, { status: 'dry-run', resolved, uploads });
    } else {
      key = readKey();
      entry.balanceBefore = await balance(key);
      const { resolved, uploads } = await resolveBody(key, body, false);
      entry.uploads = uploads;
      const created = await call(key, 'POST', `${API}/${endpoint.replace(/^\/?(v3\/)?/, '')}`, resolved);
      entry.taskId = created.task_id ?? null;
      if (!entry.taskId) throw new Error(`no task_id: ${JSON.stringify(created).slice(0, 300)}`);
      const t = await poll(key, entry.taskId);
      entry.status = t.status;
      entry.type = t.type ?? null;
      entry.seconds = t.completed_at && t.created_at ? (Date.parse(t.completed_at) - Date.parse(t.created_at)) / 1000 : null;
      if (t.error_code) entry.error = `${t.error_code} ${t.error_message ?? ''}`;
      entry.outputFields = Object.keys(t.output ?? {});
      if (t.status === 'success') entry.files = await downloadOutputs(t.output, outDir, name);
      if (t.credits_consumed != null) { entry.credits = Number(t.credits_consumed); entry.creditsSource = 'api'; }
    }
  } catch (e) {
    entry.error = redact(e.message ?? e, key).slice(0, 600);
  }
  if (!dry && key) {
    entry.balanceAfter = await balance(key);
    const delta = entry.balanceBefore && entry.balanceAfter ? +(entry.balanceBefore.balance + entry.balanceBefore.frozen - entry.balanceAfter.balance - entry.balanceAfter.frozen).toFixed(2) : null;
    entry.balanceDelta = delta;
    if (entry.creditsSource == null) {
      if (delta != null && delta > 0) { entry.credits = delta; entry.creditsSource = 'balance'; }
      else if (entry.taskId && entry.status !== 'failed') { entry.credits = est; entry.creditsSource = 'estimate'; }
      else entry.creditsSource = 'none';
    }
  }
  fs.mkdirSync(DIR, { recursive: true });
  const line = redact(JSON.stringify(entry), key);
  fs.appendFileSync(LOG, line + '\n');
  console.log(redact(`${entry.status} ${name} ${endpoint} est=${est} credits=${entry.credits} (${entry.creditsSource}) logged=${spent(readLog())}/${EXPERIMENT_CAP} balance=${entry.balanceAfter?.balance ?? '-'} task=${entry.taskId ?? '-'} files=${entry.files.map((f) => f.file ?? f.error).join(',') || '-'}${entry.error ? ` error=${entry.error}` : ''}`, key));
  if (!['success', 'dry-run'].includes(entry.status)) process.exit(1);
}

async function task() {
  const id = args[1];
  if (!/^[\w-]{6,80}$/.test(id ?? '')) throw new Error('task <task_id>');
  const key = readKey();
  const t = await call(key, 'GET', `${API}/tasks/${id}`);
  const out = { task_id: t.task_id, type: t.type, status: t.status, progress: t.progress, credits_consumed: t.credits_consumed, created_at: t.created_at, completed_at: t.completed_at, outputFields: Object.keys(t.output ?? {}) };
  if (opt('out') && t.status === 'success') out.files = await downloadOutputs(t.output, opt('out'), opt('name', id));
  console.log(redact(JSON.stringify(out, null, 2), key));
}

const isMain = !!process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    if (cmd === 'balance') { const k = readKey(); console.log(JSON.stringify(await balance(k))); }
    else if (cmd === 'total') console.log(JSON.stringify({ logged: spent(readLog()), cap: EXPERIMENT_CAP, runs: readLog().filter((e) => !e.dryRun).length }));
    else if (cmd === 'estimate') console.log(estimate(opt('endpoint'), JSON.parse(fs.readFileSync(opt('body'), 'utf8'))));
    else if (cmd === 'run') await run();
    else if (cmd === 'task') await task();
    else { console.error('usage: balance | total | estimate | run | task (see the header)'); process.exit(1); }
  } catch (e) {
    console.error(redact(e.message ?? e, null));
    process.exit(1);
  }
}
