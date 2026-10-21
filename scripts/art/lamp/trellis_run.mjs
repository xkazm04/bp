// Runs the lamp TRELLIS.2 job on the local ComfyUI (one job at a time, waits for an empty queue first).
//   node scripts/art/lamp/trellis_run.mjs <seed> [target_face_count]
// Input: apps/vr/ArtSource/lamp-agent/options/A.png. Workflow: lynx-bench media/3d-trellis-api.json with the decimate
// target lowered (DecimateMesh runs before UnwrapMesh and BakeTextureFromVoxel in that graph). Output GLB is copied to
// lynx-bench/bp/lamp-agent/raw_seed<seed>.glb (outside the repo).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const URL_ = process.env.BP_COMFY_URL || 'http://127.0.0.1:8188'; // a test points this at a loopback stub, never at a live ComfyUI
// The three tools live outside the repo, so each location is a named setting. The defaults are the owner's layout under the
// home directory (no machine path is spelled out here); another machine sets the variable, or gets the message below.
const HOME = os.homedir();
const WF = process.env.BP_TRELLIS_WORKFLOW || path.join(HOME, 'ai', 'lynx-bench', 'media', '3d-trellis-api.json');
const OUT = process.env.BP_TRELLIS_OUT || path.join(HOME, 'ai', 'lynx-bench', 'bp', 'lamp-agent');
const COMFY_OUT = process.env.BP_COMFY_OUT || path.join(HOME, 'ai', 'ComfyUI', 'ComfyUI', 'output');
const seed = Number(process.argv[2]), faces = Number(process.argv[3] || 28000);
// Same refusal as scripts/lookdev/leonardo.mjs: a NaN seed would reach four workflow nodes, the filename prefix and the output name of a 10-40 minute GPU job.
if (!(process.argv[2] ?? '').trim() || !Number.isInteger(seed)) { console.error('seed must be an integer: node scripts/art/lamp/trellis_run.mjs <seed> [target_face_count]'); process.exit(2); }
if (!fs.existsSync(WF)) { console.error(`workflow not found: ${WF} (set BP_TRELLIS_WORKFLOW to the 3d-trellis-api.json of your ComfyUI setup)`); process.exit(2); }
if (!fs.existsSync(COMFY_OUT)) { console.error(`ComfyUI output folder not found: ${COMFY_OUT} (set BP_COMFY_OUT; BP_TRELLIS_OUT sets where raw_seed<seed>.glb is copied)`); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (p, o) => (await fetch(URL_ + p, o)).json();

const t0 = Date.now();
for (;;) {
  const q = await j('/queue');
  if (!q.queue_running.length && !q.queue_pending.length) break;
  if (Date.now() - t0 > 90 * 60 * 1000) { console.error('BLOCKED: queue never emptied in 90 min'); process.exit(2); }
  console.log('queue busy, waiting 60 s');
  await sleep(60000);
}
fs.mkdirSync(OUT, { recursive: true });
const img = fs.readFileSync(path.join(ROOT, 'apps/vr/ArtSource/lamp-agent/options/A.png'));
const fd = new FormData();
fd.append('image', new Blob([img], { type: 'image/png' }), 'bp_lamp_A.png');
fd.append('overwrite', 'true');
await j('/upload/image', { method: 'POST', body: fd });
const p = JSON.parse(fs.readFileSync(WF, 'utf8'));
p['122'].inputs.image = 'bp_lamp_A.png';
p['186'].inputs.target_face_count = faces;
for (const id of ['3', '12', '18', '23']) p[id].inputs.seed = seed;
const prefix = `bp_lamp/seed${seed}`;
p['322'].inputs.filename_prefix = prefix;
const r = await j('/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: p, client_id: 'bp-lamp' }) });
if (r.error) { console.error(JSON.stringify(r).slice(0, 2000)); process.exit(1); }
const pid = r.prompt_id;
let h;
// The job poll is bounded like the queue wait above: a ComfyUI that restarted or lost the prompt answers {} for ever.
// 120 min is generous for a TRELLIS.2 job (10 to 40 min); both numbers can be shrunk for a test.
const POLL_MS = Number(process.env.BP_TRELLIS_POLL_MS) || 10000, JOB_MS = Number(process.env.BP_TRELLIS_JOB_MS) || 120 * 60 * 1000;
const tJob = Date.now();
for (;;) {
  await sleep(POLL_MS);
  const all = await j('/history/' + pid);
  h = all[pid];
  if (h && h.status && (h.status.completed || h.status.status_str === 'error')) break;
  if (Date.now() - tJob > JOB_MS) { console.error(`BLOCKED: prompt ${pid} neither completed nor failed in ${Math.round(JOB_MS / 60000)} min (ComfyUI restarted or the job was cancelled? /history/${pid} stays empty)`); process.exit(2); }
}
if (h.status.status_str === 'error') { console.error('ERROR', JSON.stringify(h.status.messages.slice(-2)).slice(0, 1500)); process.exit(1); }
const files = Object.values(h.outputs).flatMap((o) => Object.values(o).flat()).filter((x) => x && x.filename && x.type === 'output' && /\.glb$/i.test(x.filename));
console.log('outputs', JSON.stringify(files), 'secs', ((Date.now() - t0) / 1000) | 0);
const f = files.at(-1);
const src = path.join(COMFY_OUT, f.subfolder || '', f.filename), dst = path.join(OUT, `raw_seed${seed}.glb`);
fs.copyFileSync(src, dst);
console.log(dst, fs.statSync(dst).size, crypto.createHash('sha256').update(fs.readFileSync(dst)).digest('hex'));
