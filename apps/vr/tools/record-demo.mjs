// Records one demo take with ffmpeg gdigrab, for the demo video (docs/concepts/recording/plan.md).
//   node apps/vr/tools/record-demo.mjs --name s1-table [--window "<exact title>" | --desktop] [--fps 30] [--secs 60] [--out <dir>]
//   node apps/vr/tools/record-demo.mjs --stack <a.mp4> <b.mp4> --name s3-sync     (side by side, each scaled to 960 wide -> 1920 wide)
// A take writes <out>/<name>-<UTC stamp>.mp4 plus a .json sidecar (start epoch ms, so a second capture can be aligned by
// its own start). Stop early with q in the terminal. The default out dir is the git-ignored apps/vr/Saved/demo.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes(k);
const out = path.resolve(opt('--out', path.join(import.meta.dirname, '..', 'Saved', 'demo')));
const name = opt('--name', 'take');
fs.mkdirSync(out, { recursive: true });

if (flag('--stack')) {
  const [a, b] = argv.slice(argv.indexOf('--stack') + 1).filter((x) => !x.startsWith('--') && x.endsWith('.mp4'));
  if (!a || !b) { console.error('--stack needs two .mp4 paths'); process.exit(2); }
  const dest = path.join(out, `${name}-stack.mp4`);
  const f = '[0:v]scale=960:-2[l];[1:v]scale=960:-2[r];[l][r]hstack=inputs=2[v]';
  const p = spawn('ffmpeg', ['-hide_banner', '-y', '-i', a, '-i', b, '-filter_complex', f, '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-shortest', dest], { stdio: 'inherit' });
  p.on('exit', (c) => { console.log(c === 0 ? `wrote ${dest}` : `ffmpeg exit ${c}`); process.exit(c ?? 1); });
} else {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const dest = path.join(out, `${name}-${stamp}.mp4`);
  const input = flag('--desktop') || !opt('--window') ? 'desktop' : `title=${opt('--window')}`;
  const args = ['-hide_banner', '-y', '-f', 'gdigrab', '-framerate', opt('--fps', '30'), '-draw_mouse', flag('--no-mouse') ? '0' : '1', '-i', input];
  if (opt('--secs')) args.push('-t', opt('--secs'));
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', dest);
  fs.writeFileSync(dest.replace(/\.mp4$/, '.json'), JSON.stringify({ name, input, startedAtMs: Date.now() }));
  console.log(`recording ${input} -> ${dest} (q to stop)`);
  const p = spawn('ffmpeg', args, { stdio: ['inherit', 'inherit', 'inherit'] });
  p.on('exit', (c) => process.exit(c === 0 || c === 255 ? 0 : c ?? 1));
}
