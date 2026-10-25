#!/usr/bin/env node
// P2 look-dev: one Leonardo generation per call, logged. Dependency-free (Node's fetch and fs only).
// Every prompt is the state text (docs/concepts/vr-light-table/lookdev/states.json) plus the full style
// block (lookdev/style-block.json), so the block is restated in every call (art-breakdown.md, 'The style block').
//
//   node scripts/lookdev/leonardo.mjs gen --state 03-scan-sweeping --variant a --seed 101 --quality LOW [--out name.png] [--stop-at 230]
//   node scripts/lookdev/leonardo.mjs total          the night's running credit total from log.jsonl
//   node scripts/lookdev/leonardo.mjs prompt --state 00-hero --variant b    print the composed prompt, no call
//
// Prop mode (P4 concept sheets, TRELLIS input): prompts come from lookdev/props.json, one entry per asset id and variant.
//   node scripts/lookdev/leonardo.mjs gen --prop lamp-agent --variant A --seed 11 --quality LOW --size 1024x1024 --stop-at 160
//   node scripts/lookdev/leonardo.mjs prompt --prop lamp-agent --variant A
// The frame lands in the temp folder unless --out names a file under apps/vr/ArtSource/ (ArtSource has no 400 KB limit).
//   --ref <repo-relative image>  uploads it as an init image and sends it as guidances.image_reference (gpt-image takes no
//                                strength); the log records the path. --model picks one of MODELS (default the first).
// A prop entry may carry its own `sheet` (the view rules), which replaces the shared sheet rules for that prop only.
//
// Spend window (App Master decision 2026-10-21): the operator's 400 credits per night are counted per night, a night being
// 08:00 UTC on day D to 08:00 UTC on day D+1. Only log.jsonl entries whose `time` falls in the window holding the current
// time count toward `total`, HARD_CAP and --stop-at. PRIOR_SPEND belongs to the 2026-10-20 window alone.
//
// The key is LEONARDO_API_KEY, read at run time from the main checkout's untracked .env. It is never printed,
// logged or written anywhere; neither is the authorization header. Every call is "public": false.
// One JSON line per call goes to lookdev/log.jsonl. The window's total may never pass
// HARD_CAP; --stop-at only lowers it (the exploration stop).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'docs/concepts/vr-light-table/lookdev');
const LOG = path.join(DIR, 'log.jsonl');
const EXPLORE = path.join(DIR, 'explore');
const OVERSIZE = path.join(os.tmpdir(), 'bp-lookdev'); // exploration frames too big to commit: URL and id stay in the log
const ENV_FILE = path.join(ROOT, '.env'); // THIS checkout's untracked .env, never another one's (check-leonardo guards it)
const API = 'https://cloud.leonardo.ai/api/rest';
// Sunburst first: the owner judged it above flare and nano-banana on the same prompt (2026-10-25); flare stays callable.
const MODELS = ['openai/gpt-image-2.5-sunburst', 'openai/gpt-image-2.5-flare', 'nano-banana-2'];
const MODEL = MODELS[0];
const STYLE_ID = '111dc692-d470-4eec-b791-3475abac4c46';
const ART = path.join(ROOT, 'apps/vr/ArtSource');
const WIDTH = 1376;
const HEIGHT = 768;
const HARD_CAP = 390; // of the operator's 400 per night
const PRIOR_SPEND = 6; // the Director's LOW test call on 2026-10-20 about 20:58Z, made before this log existed
const PRIOR_WINDOW = '2026-10-20T08:00:00.000Z'; // the window PRIOR_SPEND belongs to
const WINDOW_START_HOUR = 8; // UTC
const LOW_FALLBACK = 8; // the worst measured LOW cost (6 at 1376x768 and 1024x1024, 8 at 2048x768); a cap takes the worst
const PROBE_ESTIMATE = { MEDIUM: 40, HIGH: 120 }; // a deliberately high guess, used only to gate the first probe
const COMMIT_LIMIT = 400 * 1024;
const POLL_MS = 5000;
const POLL_LIMIT_MS = 180000;

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i > 0 && i + 1 < args.length ? args[i + 1] : dflt;
};

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const style = readJson(path.join(DIR, 'style-block.json'));
const states = readJson(path.join(DIR, 'states.json'));
const propsFile = path.join(DIR, 'props.json');
const props = fs.existsSync(propsFile) ? readJson(propsFile) : { sheet: '', props: {} };

export function styleText(s = style) {
  const palette = s.palette.map((p) => `${p.role}: ${p.name} ${p.hex.join(' to ')}`).join('; ');
  return [
    `Style block. Technique: ${s.technique}.`,
    `Subject treatment: ${s.subject}.`,
    `Subject lock: ${s.subjectLock}.`,
    `Palette with roles: ${palette}.`,
    `Finish: ${s.finish}.`,
    `Never: ${s.never.join(', ')}.`,
  ].join(' ');
}

export function composePrompt(stateId, variant) {
  const st = states.states.find((x) => x.id === stateId);
  if (!st) throw new Error(`unknown state ${stateId}; known: ${states.states.map((x) => x.id).join(', ')}`);
  if (variant === 'a') return `${st.text} ${styleText()}`;
  if (variant === 'b') return `Style frame of one state: ${st.focus}. ${states.pose}. ${st.text} ${styleText()}`;
  throw new Error(`unknown variant ${variant} (a or b)`);
}

/** A prop prompt: the TRELLIS sheet rules (or, for an entry with `rules`, its own scene-strip rules), the prop's variant text, and the style block's palette and materials (no scene framing). */
export function composePropPrompt(propId, variant, p = props, s = style) {
  const prop = p.props[propId];
  if (!prop) throw new Error(`unknown prop ${propId}; known: ${Object.keys(p.props).join(', ')}`);
  const v = prop.variants[variant];
  if (!v) throw new Error(`unknown variant ${variant} for ${propId}; known: ${Object.keys(prop.variants).join(', ')}`);
  const palette = s.palette.map((x) => `${x.role}: ${x.name} ${x.hex.join(' to ')}`).join('; ');
  // A modelling reference (prop.reference) is a neutral clay multi-view sheet for Blender: the scene's palette and its
  // bloom-and-haze finish would paint lighting into what must read as pure form, so only the Never list is restated.
  if (prop.reference) return [`Modelling reference sheet of one object, ${prop.name}. ${v}`, `Sheet rules: ${prop.sheet}`, `Materials: ${prop.materials}.`, `Never: ${s.never.join(', ')}.`].join(' ');
  return [
    prop.rules ? `${prop.name}. ${v}` : `Concept sheet of one prop, ${prop.name}. ${v}`,
    prop.rules ? `Backdrop rules: ${prop.rules}` : `Sheet rules: ${prop.sheet ?? p.sheet}`,
    `Materials: ${prop.materials}.`,
    `Palette with roles: ${palette}.`,
    `Finish: ${s.finish}.`,
    `Never: ${s.never.join(', ')}.`,
  ].join(' ');
}

/** Where a prop `--out` writes: a file under apps/vr/ArtSource/, or an error before any call is made. */
export function artFile(name) {
  const dest = path.resolve(ART, name);
  const rel = path.relative(ART, dest);
  if (!name || !rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`--out must name a file under ${path.relative(ROOT, ART)}: ${name}`);
  return dest;
}

/** A `--ref` image: a png or jpg inside this checkout, given repo-relative. */
export function refFile_(rel) {
  const file = path.resolve(ROOT, rel ?? '');
  const r = path.relative(ROOT, file);
  if (!rel || !r || r.startsWith('..') || path.isAbsolute(rel) || !/\.(png|jpe?g)$/i.test(rel) || !fs.existsSync(file)) throw new Error(`--ref must name an existing png or jpg inside the checkout, repo-relative: ${rel}`);
  return file;
}

/** `--size 1024x1024` as [width, height]. */
export function parseSize(text) {
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(text ?? '');
  if (!m) throw new Error(`--size must look like 1024x1024: ${text}`);
  return [Number(m[1]), Number(m[2])];
}

/** Whether a call may go ahead: refused when the night's total plus its expected cost would pass the stop. */
export const withinCap = (total, cost, stopAt = HARD_CAP) => total + cost <= Math.min(HARD_CAP, stopAt);

const readLog = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

/** The spend window holding `now`: 08:00 UTC to 08:00 UTC the next day. */
export function spendWindow(now = new Date()) {
  const t = new Date(now);
  const start = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), WINDOW_START_HOUR);
  const from = new Date(t.getTime() >= start ? start : start - 86400000);
  return { from: from.toISOString(), to: new Date(from.getTime() + 86400000).toISOString() };
}

/** The log entries timed inside the window holding `now`. The ONE definition of "inside": every report uses it. */
export function inWindow(log, now = new Date()) {
  const w = spendWindow(now);
  const from = Date.parse(w.from), to = Date.parse(w.to);
  return log.filter((e) => { const t = new Date(e.time).getTime(); return t >= from && t < to; });
}

/** The credits PRIOR_SPEND adds to the window holding `now` - its own window only. */
export const priorSpend = (now = new Date()) => (spendWindow(now).from === PRIOR_WINDOW ? PRIOR_SPEND : 0);

/** Credits in the window holding `now`: the log entries timed inside it, plus PRIOR_SPEND in its own window. */
export function nightTotal(log = readLog(), now = new Date()) {
  return priorSpend(now) + inWindow(log, now).reduce((n, e) => n + (Number(e.credits) || 0), 0);
}

/**
 * What `total` prints. The breakdown has to add up to the figure the cap uses, or the report explains a number other
 * than the one that refuses a call: `byQuality` once used a string comparison on `time` where nightTotal parsed it,
 * and left PRIOR_SPEND out entirely, so in the 2026-10-20 window it summed to 384 against a nightTotal of 390 - which
 * is HARD_CAP exactly, so the breakdown showed 6 credits of headroom that did not exist.
 */
export function windowReport(log = readLog(), now = new Date()) {
  const byQuality = {};
  // Spend the log did not measure (a TIMEOUT or a lost balance read records the pre-call estimate): it is inside
  // nightTotal, which gates the next call, so the report must say how much of that figure is a guess.
  const unverified = { calls: 0, credits: 0 };
  for (const e of inWindow(log, now)) if (e.creditsSource === 'fallback') { unverified.calls++; unverified.credits += Number(e.credits) || 0; }
  for (const e of inWindow(log, now)) { const q = (byQuality[e.quality] ??= { calls: 0, credits: 0 }); q.calls++; q.credits += Number(e.credits) || 0; }
  return {
    window: spendWindow(now), byQuality, unverified, priorSpend: priorSpend(now),
    allTimeLogCredits: log.reduce((n, e) => n + (Number(e.credits) || 0), 0),
    nightTotal: nightTotal(log, now), cap: HARD_CAP,
  };
}

/**
 * What a call at this quality may cost: the WORST credit figure the log has measured at that quality, not the first
 * one. A cap has to be fed the worst case or it is not a cap - cost also rises with size (measured at LOW: 6 credits
 * at 1376x768 and 1024x1024, 8 at 2048x768; at MEDIUM: 14 and 20), and `--size` is not a field this function sees.
 * LOW falls back to its worst measured figure; MEDIUM and HIGH to a deliberately high guess that gates the first probe.
 */
export function expectedCost(quality, log) {
  const measured = log.filter((e) => e.quality === quality && e.creditsSource !== 'fallback' && Number(e.credits) > 0);
  if (measured.length) return { cost: Math.max(...measured.map((e) => Number(e.credits))), measured: true };
  if (quality === 'LOW') return { cost: LOW_FALLBACK, measured: true };
  return { cost: PROBE_ESTIMATE[quality], measured: false };
}

/**
 * What the committed log records for a saved frame. A repo path is portable; an OVERSIZE frame lives under os.tmpdir(),
 * which the OS clears and which exists on one machine, so it logs only its basename and a note (the generation id and
 * urls in the same entry are how it is recovered). Older lines that carry the absolute path are append-only history.
 */
export function loggedFile(dest, committed) {
  if (committed) return { file: path.relative(ROOT, dest).replaceAll('\\', '/') };
  return { file: path.basename(dest), fileNote: 'not committed: written under the OS temp dir (bp-lookdev) and recoverable from urls' };
}

/** `text` with every copy of the key replaced: whatever goes to log.jsonl (committed) or stdout passes through here. */
export const redact = (text, key) => (key ? String(text).replaceAll(key, '[redacted]') : String(text));

/** Where `--out` writes: a path under lookdev/, or an error before any call is made. */
export function outFile(name) {
  const dest = path.resolve(DIR, name);
  const rel = path.relative(DIR, dest);
  if (!name || !rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`--out must name a file under ${path.relative(ROOT, DIR)}: ${name}`);
  return dest;
}

function readKey() {
  const m = fs.readFileSync(ENV_FILE, 'utf8').match(/^\s*LEONARDO_API_KEY\s*=\s*(.+?)\s*$/m);
  if (!m) throw new Error(`LEONARDO_API_KEY not found in ${ENV_FILE}`);
  return m[1].replace(/^['"]|['"]$/g, '');
}

export async function call(key, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { accept: 'application/json', authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  // Redacted before anything parses or cuts it: a reply that echoes the key, cut through the key, leaves a prefix
  // that redact() can no longer match (gen()'s 'no generationId' message cuts the reply at 300 characters).
  const text = redact(await res.text(), key);
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  if (!res.ok) throw new Error(`${method} ${url} -> HTTP ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  return json;
}

/** Sum of every numeric token pool on the account; the difference across a call is what it cost. */
async function balance(key) {
  try {
    const me = await call(key, 'GET', `${API}/v1/me`);
    const u = me.user_details?.[0] ?? {};
    return Object.entries(u).filter(([k, v]) => /tokens$/i.test(k) && typeof v === 'number').reduce((n, [, v]) => n + v, 0);
  } catch {
    return null;
  }
}

/** A cost the API reports itself, if it does: any numeric field named like cost or credit. */
function reportedCost(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (/cost|credit/i.test(k)) {
      if (typeof v === 'number') return v;
      if (v && typeof v === 'object' && typeof v.amount === 'number') return v.amount;
    }
  }
  for (const v of Object.values(obj)) {
    const c = reportedCost(v, depth + 1);
    if (c != null) return c;
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gen() {
  const prop = opt('prop');
  const state = prop ? null : opt('state');
  const variant = opt('variant', prop ? 'A' : 'a');
  const [width, height] = prop ? parseSize(opt('size', '1024x1024')) : [WIDTH, HEIGHT];
  const seed = Number(opt('seed', '1'));
  const quality = opt('quality', 'LOW').toUpperCase();
  const stopAt = Math.min(HARD_CAP, Number(opt('stop-at', HARD_CAP)));
  if (!['LOW', 'MEDIUM', 'HIGH'].includes(quality)) throw new Error(`quality must be LOW, MEDIUM or HIGH`);
  if (!Number.isInteger(seed)) throw new Error('seed must be an integer');
  const prompt = prop ? composePropPrompt(prop, variant) : composePrompt(state, variant);
  if (opt('out') !== undefined) (prop ? artFile : outFile)(opt('out')); // a bad --out stops here, before any credit is spent
  const model = opt('model', MODEL);
  if (!MODELS.includes(model)) throw new Error(`--model must be one of ${MODELS.join(', ')}`);
  const refRel = opt('ref');
  const refFile = refRel === undefined ? null : refFile_(refRel); // a bad --ref stops here too

  const log = readLog();
  const total = nightTotal(log);
  const { cost, measured } = expectedCost(quality, log);
  if (!withinCap(total, cost, stopAt)) {
    console.error(`REFUSED: window total ${total} + expected ${cost}${measured ? '' : ' (unmeasured guess)'} at ${quality} would pass ${stopAt}`);
    process.exit(2);
  }

  const key = readKey();
  const before = await balance(key);
  const body = {
    model,
    public: false,
    parameters: { width, height, prompt_enhance: 'OFF', quality, quantity: 1, seed, style_ids: [STYLE_ID], prompt },
  };
  const entry = { time: new Date().toISOString(), ...(prop ? { prop } : { state }), variant, model, prompt, seed, quality, width, height, ...(refFile ? { reference: path.relative(ROOT, refFile).split(path.sep).join('/') } : {}), generationId: null, status: 'ERROR', credits: 0, creditsSource: null, file: null, urls: [], committed: false };
  let created = null;
  let reported = null;
  try {
    if (refFile) {
      const init = (await call(key, 'POST', `${API}/v1/init-image`, { extension: path.extname(refFile).slice(1).toLowerCase() })).uploadInitImage;
      const form = new FormData();
      for (const [k, v] of Object.entries(typeof init.fields === 'string' ? JSON.parse(init.fields) : init.fields)) form.append(k, v);
      form.append('file', new Blob([fs.readFileSync(refFile)]));
      const up = await fetch(init.url, { method: 'POST', body: form });
      if (!up.ok) throw new Error(`reference upload -> HTTP ${up.status}`);
      body.parameters.guidances = { image_reference: [{ image: { id: init.id, type: 'UPLOADED' } }] };
      entry.referenceId = init.id;
    }
    created = await call(key, 'POST', `${API}/v2/generations`, body);
    entry.generationId = created.generate?.generationId ?? created.generationId ?? null;
    reported = reportedCost(created);
    if (!entry.generationId) throw new Error(`no generationId in response: ${JSON.stringify(created).slice(0, 300)}`);
    const t0 = Date.now();
    let g;
    for (;;) {
      await sleep(POLL_MS);
      g = (await call(key, 'GET', `${API}/v1/generations/${entry.generationId}`)).generations_by_pk;
      entry.status = g?.status ?? 'UNKNOWN';
      if (entry.status === 'COMPLETE' || entry.status === 'FAILED') break;
      if (Date.now() - t0 > POLL_LIMIT_MS) { entry.status = 'TIMEOUT'; break; }
    }
    reported ??= reportedCost(g);
    entry.urls = (g?.generated_images ?? []).map((i) => i.url);
    if (entry.status === 'COMPLETE' && entry.urls.length) {
      const url = entry.urls[0];
      const ext = (path.extname(new URL(url).pathname) || '.png').toLowerCase();
      const name = opt('out') ?? `explore/${prop ?? state}-${variant}-s${seed}-${quality.toLowerCase()}${ext}`;
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      const explore = name.startsWith('explore/');
      const dest = prop ? (opt('out') !== undefined ? artFile(name) : path.join(OVERSIZE, path.basename(name))) : explore && buf.length > COMMIT_LIMIT ? path.join(OVERSIZE, path.basename(name)) : outFile(name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      entry.committed = dest.startsWith(DIR) || dest.startsWith(ART);
      Object.assign(entry, loggedFile(dest, entry.committed));
      entry.bytes = buf.length;
    }
  } catch (e) {
    entry.error = redact(e.message ?? e, key).slice(0, 500);
  }
  const after = await balance(key);
  if (reported != null) { entry.credits = reported; entry.creditsSource = 'api'; }
  else if (before != null && after != null && before - after > 0) { entry.credits = before - after; entry.creditsSource = 'balance'; }
  else if (entry.generationId) { entry.credits = cost; entry.creditsSource = 'fallback'; }
  else { entry.credits = 0; entry.creditsSource = 'no-generation'; }
  fs.mkdirSync(DIR, { recursive: true });
  fs.appendFileSync(LOG, JSON.stringify(entry) + '\n');
  console.log(`${entry.status} ${prop ?? state} ${variant} s${seed} ${quality} credits=${entry.credits} (${entry.creditsSource}) total=${nightTotal()} file=${entry.file ?? '-'}${entry.error ? ` error=${entry.error}` : ''}`);
  if (entry.status !== 'COMPLETE') process.exit(1);
}

if (cmd === 'gen') await gen();
else if (cmd === 'total') console.log(JSON.stringify(windowReport(), null, 2));
else if (cmd === 'prompt') console.log(opt('prop') ? composePropPrompt(opt('prop'), opt('variant', 'A')) : composePrompt(opt('state'), opt('variant', 'a')));
else if (cmd) { console.error(`unknown command ${cmd}`); process.exit(1); }
else if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) { console.error('usage: gen | total | prompt (see the header)'); process.exit(1); }
