#!/usr/bin/env node
// The onboarding test bed (spark onboarding-vr): a REAL server writes a REAL build-up journal over ~2-3 min, with no model.
// It clones dowser at a fixed commit into a scratch dir, registers the clone in a TEMP registry file the server under test
// reads (BP_PRODUCTS_FILE), and POSTs /onboard; the server's adopt job then runs this same file as its CLI (BP_CLAUDE_BIN),
// which hands over to scripts/fixtures/fake-adopt.mjs with the run's speed and mode. It never touches the source repo or
// the real bp.products.local.json: the registry it writes is its own, and a server that does not read it is refused.
//
//   node scripts/buildup/fake-onboard.mjs env [--dir <scratch>]
//        print the env the server under test needs (and create the empty temp registry); start the server with it
//   node scripts/buildup/fake-onboard.mjs --port <n> [--speed 1] [--slug dowser-fake] [--dir <scratch>] [--synthetic]
//        [--fail <step>] [--no-wait]
//        a fresh clone, registered, onboarded; prints the slug, the job id and the env, then follows the job to its end
//        (phase by phase) unless --no-wait. --speed 1 = 150 s of fake run (2 = 75 s ...). --synthetic: fake-adopt's
//        hermetic one-domain run instead of the real adopt.mjs steps over the clone. --fail <step>: fake-adopt's
//        FAKE_ADOPT_FAIL (supplement, seed, outline, tree, events, batches, judge).
//   (as BP_CLAUDE_BIN, called by the server with `-p --output-format stream-json --verbose`: the CLI hand-over)
//
// Default scratch dir: <os tmp>/bp-fake-onboard (registry products.json, clones under it). A server started without this
// file as BP_CLAUDE_BIN would run the REAL claude on the clone: the runner watches the job's first session line and cancels
// a job whose CLI is not fake-adopt.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const FAKE_ADOPT = path.resolve(HERE, '..', 'fixtures', 'fake-adopt.mjs');
const SOURCE = 'C:/Users/kazda/kiro/dowser', COMMIT = '414e6ed';
const RUN_MS = 150_000;
const SETTINGS = (root) => path.join(root, '.git', 'bp-fake-onboard.json');
const argv = process.argv.slice(2);
const fwd = (p) => p.replace(/\\/g, '/');

// ------------------------------------------------------------------------------------------------ the CLI hand-over
if (argv.includes('--output-format')) {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SETTINGS(process.cwd()), 'utf8')); } catch { /* not a fake-onboard clone: fake-adopt's own defaults */ }
  const env = { ...process.env };
  if (s.ms) env.FAKE_ADOPT_MS = String(s.ms);
  if (s.real) env.FAKE_ADOPT_REAL = '1'; else delete env.FAKE_ADOPT_REAL;
  if (s.fail) env.FAKE_ADOPT_FAIL = s.fail; else delete env.FAKE_ADOPT_FAIL;
  const c = spawn(process.execPath, [FAKE_ADOPT, ...argv], { stdio: 'inherit', env, windowsHide: true });
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { try { c.kill(sig); } catch { /* gone */ } });
  c.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  c.on('error', (e) => { process.stderr.write(`fake-onboard: ${e.message}\n`); process.exit(1); });
} else {
  await run();
}

// ------------------------------------------------------------------------------------------------ the runner
function opt(k, d) { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; }
function die(msg, code = 1) { process.stderr.write(`fake-onboard: ${msg}\n`); process.exit(code); }

/** The adopt-bp skill a server running from a mirror (lens-serve) cannot find by walking up: bp's own, from this file. */
function skillDir() {
  for (let d = HERE; ; d = path.dirname(d)) {
    const c = path.join(d, '.claude', 'skills', 'adopt-bp');
    if (fs.existsSync(path.join(c, 'SKILL.md')) && fs.existsSync(path.join(c, 'scripts', 'adopt.mjs'))) return c;
    if (path.dirname(d) === d) return null;
  }
}

function envLines(registry) {
  const skill = skillDir();
  return [`BP_PRODUCTS_FILE=${fwd(registry)}`, `BP_CLAUDE_BIN=${fwd(SELF)}`, ...(skill ? [`BP_ADOPT_SKILL=${fwd(skill)}`] : [])];
}

async function run() {
  const dir = path.resolve(opt('--dir', path.join(os.tmpdir(), 'bp-fake-onboard')));
  const registry = path.join(dir, 'products.json');
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(registry)) fs.writeFileSync(registry, JSON.stringify({ products: [] }, null, 2) + '\n');
  if (argv[0] === 'env') { console.log(envLines(registry).join('\n')); return; }

  const port = Number(opt('--port', ''));
  if (!Number.isInteger(port) || port <= 0) die('--port <n> is required (the server under test)', 2);
  const speed = Number(opt('--speed', '1'));
  if (!(speed > 0)) die('--speed must be a positive number', 2);
  const slug = opt('--slug', 'dowser-fake');
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug) || slug === 'kettle') die(`bad slug ${slug}`, 2);
  const fail = opt('--fail', '');
  const base = `http://127.0.0.1:${port}`;
  const api = async (p, init) => {
    const r = await fetch(base + p, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    const t = await r.text();
    let body; try { body = JSON.parse(t); } catch { body = t; }
    return { status: r.status, body };
  };

  // the server must be up before anything is cloned
  try { await api('/api/products'); } catch (e) { die(`no server on ${base} (${e.cause?.code ?? e.message}); start it with:\n  ${envLines(registry).join(' ')}`); }

  // a fresh clone at the fixed commit (never the source itself)
  const root = path.join(dir, slug);
  if (path.resolve(root).toLowerCase() === path.resolve(SOURCE).toLowerCase()) die('the clone would be the source', 2);
  const cur = await api(`/api/products/${slug}/onboarding`);
  if (cur.status === 200 && (cur.body?.job?.status === 'running' || cur.body?.job?.status === 'queued')) die(`${slug} is onboarding already (job ${cur.body.job.id}); wait for it or cancel it first`);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  execFileSync('git', ['clone', '-q', '--no-hardlinks', '--no-checkout', SOURCE, root], { stdio: ['ignore', 'ignore', 'inherit'] });
  execFileSync('git', ['-C', root, 'checkout', '-q', '--detach', COMMIT], { stdio: ['ignore', 'ignore', 'inherit'] });
  fs.writeFileSync(SETTINGS(root), JSON.stringify({ ms: Math.round(RUN_MS / speed), real: !argv.includes('--synthetic'), fail: fail || null }) + '\n');

  // registered in the temp registry, and the server must be reading that file
  let reg = { products: [] };
  try { reg = JSON.parse(fs.readFileSync(registry, 'utf8')); } catch { /* rewritten below */ }
  const products = (Array.isArray(reg.products) ? reg.products : []).filter((p) => p?.slug !== slug);
  products.push({ slug, name: 'Dowser (fake onboarding)', root: fwd(root) });
  fs.writeFileSync(registry + '.tmp', JSON.stringify({ products }, null, 2) + '\n');
  fs.renameSync(registry + '.tmp', registry);
  const seen = await api('/api/products');
  const mine = Array.isArray(seen.body) ? seen.body.find((p) => p.slug === slug) : null;
  if (!mine || path.resolve(mine.root).toLowerCase() !== path.resolve(root).toLowerCase()) {
    die(`the server on ${base} does not read ${fwd(registry)}; restart it with:\n  ${envLines(registry).join(' ')}`);
  }

  const ob = await api(`/api/products/${slug}/onboard`, { method: 'POST', body: '{}' });
  if (ob.status !== 202) die(`onboard answered ${ob.status}: ${JSON.stringify(ob.body)}`);
  const job = ob.body.job;
  console.log(`slug ${slug}`);
  console.log(`job ${job.id}`);
  console.log(`root ${fwd(root)} (dowser@${COMMIT}, ${argv.includes('--synthetic') ? 'synthetic' : 'real adopt.mjs steps'}, ~${Math.round(RUN_MS / speed / 1000)} s)`);
  console.log(`env ${envLines(registry).join(' ')}`);
  console.log(`feed ${base}/api/products/${slug}/onboarding/feed?after=0&layout=islands`);

  // the CLI the server started must be the fake: a real one on the clone is cancelled at its first session line
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const t0 = Date.now();
  let verified = false, phase = null;
  for (;;) {
    await sleep(1000);
    const g = await api(`/api/products/${slug}/onboarding`).catch(() => null);
    const j = g?.body?.job;
    if (!j || j.id !== job.id) continue;
    if (!verified && /# session/.test(j.log_tail ?? '')) {
      if (!/# session · fake-adopt/.test(j.log_tail)) {
        await api(`/api/products/${slug}/scans/${job.id}`, { method: 'DELETE' }).catch(() => null);
        die(`the server ran a CLI that is not fake-adopt (cancelled ${job.id}); restart it with:\n  ${envLines(registry).join(' ')}`);
      }
      verified = true;
      if (argv.includes('--no-wait')) return;
    }
    if (j.adopt_phase !== phase) { phase = j.adopt_phase; console.log(`${String(Math.round((Date.now() - t0) / 1000)).padStart(4)} s  phase ${phase}`); }
    if (j.status !== 'running' && j.status !== 'queued') {
      console.log(`${String(Math.round((Date.now() - t0) / 1000)).padStart(4)} s  ${j.status}${j.error ? ': ' + j.error : ''}`);
      process.exit(j.status === 'done' ? 0 : 1);
    }
    if (!verified && Date.now() - t0 > 120_000) die('no session line from the CLI in 120 s');
  }
}
