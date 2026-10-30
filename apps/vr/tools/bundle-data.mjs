#!/usr/bin/env node
// Save one product's server answers into the VR build (docs/concepts/vr-light-table/standalone-plan.md): the headset with no
// PC reads them through BpLink's bundle path (FBpLinkClient::ReadBundle) instead of asking apps/server.
//
//   node apps/vr/tools/bundle-data.mjs [--product <slug>] [--url http://127.0.0.1:3100] [--briefs]
//
// Without --url it starts apps/server itself (`--port 0` in an empty cwd, as run-bplink does) and stops it afterwards. It
// writes apps/vr/Content/BpData/<slug>/: structure.json, plan.json (the islands layout the table draws), scans.json,
// scan.json, waves.json (the scan side: pins, the scan line, the wrist's waves) and bundle.json (when and from where).
// --briefs (ROADMAP F2) adds briefs.json: { <proposal id>: <the brief route's body> } for every open proposal in scan.json,
// so the offline table's decision card draws the same brief lines (BpLink FetchBrief reads it). Opt-in: the committed Kettle
// bundle rides in the competition APK, and whether the brief does is the owner's call (ROADMAP section 6); without the flag
// an existing briefs.json is left as it is.
// Each file is the route's body exactly as the server answered. Config/DefaultGame.ini stages the BpData directory into
// the pak as UFS files. Only Kettle (the sample) is committed; a live product's bundle stays local (.gitignore).
// Exit 0 written, 1 a route failed, 2 refused.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VR = path.resolve(HERE, '..');
const REPO = path.resolve(VR, '..', '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const slug = opt('--product', 'kettle');
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) { console.log(`REFUSED: ${slug} is not a product slug`); process.exit(2); }

// [file, route]: the routes BpLink reads (BpLink.cpp FetchProduct and PollScan)
const PARTS = [
  ['structure.json', '/structure'],
  ['plan.json', '/plan?layout=islands'],
  ['scans.json', '/scans'],
  ['scan.json', '/scan'],
  ['waves.json', '/waves'],
];

let server = null, url = opt('--url');
if (!url) {
  const cwd = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP ?? process.env.TMPDIR ?? '/tmp'), 'bp-bundle-'));
  const products = path.join(REPO, 'bp.products.local.json');
  if (slug !== 'kettle' && fs.existsSync(products)) fs.copyFileSync(products, path.join(cwd, 'bp.products.local.json'));
  server = spawn(process.execPath, ['--import', pathToFileURL(path.join(REPO, 'packages/core/register.mjs')).href,
    path.join(REPO, 'apps/server/src/main.ts'), '--port', '0'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const port = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(0), 20000);
    const look = (d) => { out += d; const m = /listening on http:\/\/[^:]+:(\d+)/.exec(out); if (m) { clearTimeout(t); resolve(Number(m[1])); } };
    server.stdout.on('data', look); server.stderr.on('data', (d) => (out += d));
    server.on('exit', () => { clearTimeout(t); resolve(0); });
  });
  if (!port) { stop(); console.log(`REFUSED: apps/server did not print its port within 20 s:\n${out.slice(-800)}`); process.exit(2); }
  url = `http://127.0.0.1:${port}`;
}
function stop() { if (server && server.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(server.pid), '/T', '/F']); }

const dir = path.join(VR, 'Content', 'BpData', slug);
fs.mkdirSync(dir, { recursive: true });
let failed = 0, rev = null;
for (const [file, route] of PARTS) {
  const res = await fetch(`${url}/api/products/${slug}${route}`).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
  const body = await res.text();
  if (!res.ok) { failed++; console.log(`FAIL  ${route}: ${res.status} ${body.slice(0, 200)}`); continue; }
  fs.writeFileSync(path.join(dir, file), body);
  if (file === 'structure.json') rev = JSON.parse(body).rev ?? null;
  console.log(`ok    ${route} -> ${path.relative(REPO, path.join(dir, file)).replace(/\\/g, '/')} (${(body.length / 1024).toFixed(1)} KB)`);
}
if (args.includes('--briefs') && !failed) {
  const open = (JSON.parse(fs.readFileSync(path.join(dir, 'scan.json'), 'utf8')).proposals ?? []).filter((p) => p.status === 'proposed').map((p) => p.id);
  const briefs = {};
  for (const id of open) {
    const res = await fetch(`${url}/api/products/${slug}/proposals/${encodeURIComponent(id)}/brief`).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
    const body = await res.text();
    if (!res.ok) { failed++; console.log(`FAIL  brief ${id}: ${res.status} ${body.slice(0, 200)}`); continue; }
    briefs[id] = JSON.parse(body);
  }
  const text = JSON.stringify(briefs);
  fs.writeFileSync(path.join(dir, 'briefs.json'), text);
  const repeats = Object.values(briefs).filter((b) => b.advice?.say === 'withdraw').length;
  console.log(`ok    ${open.length} briefs -> ${path.relative(REPO, path.join(dir, 'briefs.json')).replace(/\\/g, '/')} (${(text.length / 1024).toFixed(1)} KB, ${repeats} repeat${repeats === 1 ? '' : 's'})`);
}
stop();
fs.writeFileSync(path.join(dir, 'bundle.json'), JSON.stringify({ product: slug, savedAt: new Date().toISOString(), rev, from: server ? 'apps/server (started by bundle-data.mjs)' : url }, null, 2) + '\n');
console.log(failed ? `\n${failed} route(s) failed; the bundle is incomplete` : `\nbundled ${slug} (rev ${rev}); rebuild the app to stage it`);
process.exit(failed ? 1 : 0);
