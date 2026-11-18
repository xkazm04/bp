// Films one web take for the demo video unattended (docs/concepts/demo-video/shots/s1-web-cold-open.md): the page's
// viewport only (headless Chromium: no browser chrome, no cursor, no address bar, no autocomplete), the dark theme, no
// intro, actions on cue by real clicks on the real places, then a constant-30 fps H.264 mp4 at 1920x1080 whose frame 0 is
// the plan at rest, and a JSON sidecar with the action times (seconds from the clip start) for the edit.
//
//   node apps/vr/tools/film/web-take.mjs [--scene s1] [--out <file.mp4>] [--base http://127.0.0.1:3010]
//                                        [--product <slug>] [--theme dark|light] [--realtime] [--rebuild] [--keep-work]
//
// --scene    a row of SCENES below (s1, web-plan-still); --list prints them
// --out      the mp4 (default apps/vr/Saved/demo/web/<scene>-<stamp>.mp4, git-ignored); the sidecar is <out>.json
// --base     the web app; when nothing answers there, a production server is started on its port and stopped after.
//            It runs from its own build dir apps/web/.next-film (NEXT_DIST_DIR, git-ignored), built when missing or
//            older than the app's sources (apps/web/src, packages/core/src, packages/core/data), so a stale shared
//            .next is never filmed and a dev server's .next is never touched
// --product  a live product slug (?product=, needs its data served); default the built-in Kettle sample
// --realtime wall-clock screencast instead of the default frame-stepped capture (web_take.py explains both; stepped is
//            smooth at any machine speed and takes ~0.6 s of wall time per frame, so a 13 s clip films in ~4 min)
// --rebuild  build the film dir even when it looks fresh
// --keep-work keep the frames / webm, job and server logs in <out dir>/.work/<name>
// Needs Python with Playwright (run with -E -P: isolated from env and the cwd, but the user site, where Playwright is
// installed here, stays on the path; -I would drop it) and ffmpeg/ffprobe on PATH. Exit 0 written, 1 a step failed.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// The scenes. kind 'plan' (default): the blueprint, `steps[].at` seconds from the clip's frame 0. kind 'html': a page of
// ours rendered frame by frame (intro.html). kind 'onboard': a new project's "Start onboarding" at `clickAt`, then the
// onboarding screen's build-up (web_take.py run_onboard says how it is staged); there `duration` is the longest it may
// run (trimToEnd ends it `hold` s after the drawing completes). Elsewhere `duration` is the clip's length.
const SCENES = {
  intro: {
    about: "title sequence: Developer's Blueprint, the problem, the answer; ends on the bare grid (intro.html)",
    kind: 'html', html: 'intro.html', duration: 12,
  },
  onboard: {
    about: 'a new project (Kettle) on the projects page, Start onboarding at 6.0 s, then its build-up drawing itself',
    kind: 'onboard', clickAt: 6.0, cut: 0.3, speed: 2.6, hold: 2.0, trimToEnd: true, duration: 40,
  },
  'new-project': {
    about: "the projects page with Kettle not onboarded yet, held 5.5 s (onboard's opening, before the press)",
    kind: 'onboard', clickAt: null, duration: 5.5,
  },
  s1: {
    about: 'S1 cold open: the plan at rest, fly into Studio operations, open Booking and attendance, hold',
    duration: 13,
    steps: [
      { at: 5, do: 'click-wing', name: 'Studio operations' },
      { at: 9, do: 'click-room', name: 'Booking & attendance' },
    ],
  },
  'web-plan-still': {
    about: '8 s of the plan at rest with a slow drift in (an under-caption plate)',
    duration: 8,
    steps: [{ at: 0, do: 'drift', zoom: 1.06, dx: 30, dur: 8 }],
  },
};

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const has = (k) => argv.includes(k);
if (has('--list')) { for (const [k, s] of Object.entries(SCENES)) console.log(`${k.padEnd(16)} ${s.duration}s  ${s.about}`); process.exit(0); }
const sceneId = opt('--scene', 's1'), scene = SCENES[sceneId];
if (!scene) { console.log(`REFUSED: no scene "${sceneId}"; have ${Object.keys(SCENES).join(', ')}`); process.exit(1); }
const base = new URL(opt('--base', 'http://127.0.0.1:3010'));
const theme = opt('--theme', 'dark'), product = opt('--product', ''), mode = has('--realtime') ? 'realtime' : 'stepped';
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const out = path.resolve(opt('--out', path.join(ROOT, 'apps', 'vr', 'Saved', 'demo', 'web', `${sceneId}-${stamp}.mp4`)));
const work = path.join(path.dirname(out), '.work', path.basename(out, '.mp4'));
fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
const log = (s) => console.log(`[web-take] ${s}`);

const answers = async (u) => { try { const r = await fetch(u, { signal: AbortSignal.timeout(3000) }); return r.status < 500; } catch { return false; } };

// ---- the server: reuse what answers, else start `next start` from the film build dir (built if missing or stale)
const DIST = '.next-film', distAbs = path.join(ROOT, 'apps', 'web', DIST);
const newest = (dir) => {
  let t = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else t = Math.max(t, fs.statSync(p).mtimeMs);
  } };
  if (fs.existsSync(dir)) walk(dir);
  return t;
};
const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
let server = null;
async function ensureServer() {
  if (await answers(base.href)) { log(`using the app already at ${base.origin}`); return; }
  const idFile = path.join(distAbs, 'BUILD_ID');
  const src = Math.max(...['apps/web/src', 'packages/core/src', 'packages/core/data'].map((d) => newest(path.join(ROOT, d))));
  const built = fs.existsSync(idFile) ? fs.statSync(idFile).mtimeMs : 0;
  if (has('--rebuild') || built < src) {
    log(built ? 'the film build is older than the sources: building' : 'no film build: building (apps/web/.next-film)');
    const b = spawnSync(process.execPath, [nextBin, 'build', 'apps/web'], { cwd: ROOT, env: { ...process.env, NEXT_DIST_DIR: DIST }, encoding: 'utf8' });
    fs.writeFileSync(path.join(work, 'build.log'), (b.stdout || '') + (b.stderr || ''));
    if (b.status !== 0) { log(`FAILED: next build exit ${b.status}; log ${path.join(work, 'build.log')}\n${(b.stderr || b.stdout || '').split('\n').slice(-25).join('\n')}`); process.exit(1); }
  } else log('film build is fresh');
  const port = base.port || '80', host = base.hostname === 'localhost' ? '127.0.0.1' : base.hostname;
  log(`starting next start on ${host}:${port}`);
  server = spawn(process.execPath, [nextBin, 'start', 'apps/web', '-p', port, '-H', host], { cwd: ROOT, env: { ...process.env, NEXT_DIST_DIR: DIST }, stdio: ['ignore', fs.openSync(path.join(work, 'server.log'), 'w'), fs.openSync(path.join(work, 'server.err.log'), 'w')] });
  const t = Date.now();
  while (Date.now() - t < 60000) {
    if (server.exitCode !== null) { log(`FAILED: the server exited ${server.exitCode}; see ${work}\\server.err.log`); process.exit(1); }
    if (await answers(base.href)) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  log('FAILED: the server did not answer in 60 s'); stopServer(); process.exit(1);
}
function stopServer() {
  if (!server || server.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill('SIGTERM');
  server = null; log('stopped the server it started');
}
process.on('exit', stopServer);
process.on('SIGINT', () => process.exit(130));

// ---- the take
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
const probe = (f) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,avg_frame_rate,r_frame_rate,nb_frames,codec_name,pix_fmt:format=duration', '-of', 'json', f], { encoding: 'utf8' }));

await ensureServer();
const q = new URLSearchParams({ intro: '0', theme });
if (product) q.set('product', product);
const url = new URL('/?' + q, base).href;
const FPS = 30;
if (scene.kind && mode === 'realtime') { log(`REFUSED: scene ${sceneId} is frame-stepped only`); stopServer(); process.exit(1); }
const job = { ...scene, url, base: base.origin, workDir: work, mode, width: 1920, height: 1080, fps: FPS, settle: 2.5, steps: scene.steps ?? [],
  ...(scene.html ? { html: path.join(import.meta.dirname, scene.html) } : {}) };
fs.writeFileSync(path.join(work, 'job.json'), JSON.stringify(job, null, 2));
log(`scene ${sceneId} (${scene.kind ?? 'plan'}, ${scene.duration}s, ${mode})${scene.kind ? '' : ': ' + url}`);
const py = spawnSync(process.env.PYTHON || 'python', ['-E', '-P', path.join(import.meta.dirname, 'web_take.py'), path.join(work, 'job.json')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], timeout: 1800000 });
stopServer();
if (py.status !== 0) { log(`FAILED: the browser take exited ${py.status}${py.error ? ' (' + py.error.message + ')' : ''}`); process.exit(1); }
const res = JSON.parse(py.stdout.trim().split('\n').pop());
const N = res.count ?? Math.round(scene.duration * FPS);
if (res.pageErrors.length) log(`page errors during the take: ${res.pageErrors.join(' | ')}`);
for (const e of res.events) if (/^click-(wing|room)$/.test(e.do) && (!e.flew || e.settled == null)) { log(`FAILED: ${e.do} ${e.name}: flew=${e.flew} settled=${e.settled}`); process.exit(1); }

// stepped: the PNG frames are already one per 1/30 s. realtime: Playwright's webm is variable-rate, so cut the load at
// the head and resample to a constant 30 fps (tpad clones the last frame so the count is exact). H.264, high quality.
fs.mkdirSync(path.dirname(out), { recursive: true });
const enc = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-frames:v', String(N), '-movflags', '+faststart', '-an', out];
if (res.frames) ff(['-framerate', String(FPS), '-i', res.frames, '-vf', 'setsar=1', ...enc]);
else ff(['-ss', String(res.head), '-i', res.webm, '-vf', `fps=${FPS},scale=1920:1080:flags=lanczos,tpad=stop_mode=clone:stop_duration=1,setsar=1`, ...enc]);
const pr = probe(out), st = pr.streams[0];
const sidecar = {
  scene: sceneId, about: scene.about, file: path.basename(out),
  ...(scene.kind ? { kind: scene.kind } : { url: url.replace(base.origin, ''), product: product || 'kettle sample' }),
  ...(scene.kind === 'onboard' ? { staged: "projects list and onboard call answered by the capture (nothing registered, no model run); the build-up is the onboarding screen's own preset replay of the Kettle plan", buildupSpeed: scene.speed } : {}),
  theme, mode, width: st.width, height: st.height, fps: FPS, duration: +(+pr.format.duration).toFixed(3), frames: +st.nb_frames,
  recordedAt: new Date().toISOString(), ...(res.webm ? { headCutSeconds: res.head } : {}),
  // t: seconds from frame 0 (frame = t * 30). Clicks: when it landed (a flight starts there); settled: the camera at rest.
  // onboard: click-onboard is the press, cut the hard cut to the onboarding screen, buildup-settled the drawing complete.
  actions: res.events.map((e) => ({ do: e.do, name: e.name, cue: e.cue, t: e.t, frame: Math.round(e.t * FPS), settled: e.settled ?? undefined, x: e.x, y: e.y })),
  ...(res.pageErrors.length ? { pageErrors: res.pageErrors } : {}),
};
fs.writeFileSync(out.replace(/\.mp4$/, '') + '.json', JSON.stringify(sidecar, null, 2) + '\n');
if (!has('--keep-work')) fs.rmSync(work, { recursive: true, force: true });
log(`wrote ${out} (${st.width}x${st.height} ${st.avg_frame_rate} fps, ${sidecar.duration}s, ${sidecar.frames} frames) and its .json`);
for (const a of sidecar.actions) log(`  ${a.t.toFixed(2)}s  ${a.do} ${a.name ?? ''}${a.settled ? `  (settled ${a.settled.toFixed(2)}s)` : ''}`);
