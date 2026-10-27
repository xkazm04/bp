#!/usr/bin/env node
// The web mount binds loopback by SOCKET. The API handlers' guards (packages/core/src/scan/local-only.ts) read only the
// Host and X-Forwarded-For headers, and a LAN client sets both: Next fills X-Forwarded-For with `??=` (a client-sent hop
// survives) and hides the socket from route handlers. So the boundary is which interface Next listens on, and Next's own
// default is every interface (0.0.0.0). This gate refuses any tracked way of starting Next without a loopback host:
//   launchers     every package.json script whose command runs `next dev|start` (derived, never a hand list of names)
//                 must pass `-H|--hostname <loopback>` (127.x.x.x, ::1 or localhost, the shared isLoopbackAddr)
//   instructions  every `next dev|start` in a tracked instruction file under scripts/** or README.md (prose, Python,
//                 shell: everything but JS/TS sources, whose launchers would be spawn arrays) likewise, by file:line
//   one rule      apps/server/src/mount.ts declares no loopback regex of its own; its peer check calls isLoopbackAddr
// Seeded in-memory controls run first, so the gate cannot pass by matching nothing.
// Run: node scripts/check-web-bind.mjs   Exit 1 on any failure or violation.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isLoopbackAddr } from '../packages/core/src/scan/local-only.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };

const LAUNCH = /\bnext\s+(dev|start)\b/g;
/** Why one `next dev|start` command (the text after the match, up to a shell or quote boundary) is refused, or null. */
function refusal(rest) {
  const args = rest.split(/&&|\|\||[;|`'"#\n]/)[0].trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < args.length; i++) {
    const m = /^(?:-H|--hostname)(?:=(.*))?$/.exec(args[i]);
    if (!m) continue;
    const host = m[1] ?? args[i + 1] ?? '';
    return isLoopbackAddr(host) ? null : `binds ${JSON.stringify(host)}, not a loopback host`;
  }
  return 'binds every interface (no -H/--hostname; Next defaults to 0.0.0.0)';
}
/** Every refused launch in one text: [{ at, cmd, why }]. */
function launches(text) {
  const out = [];
  for (const m of text.matchAll(LAUNCH)) {
    const why = refusal(text.slice(m.index + m[0].length));
    if (why) out.push({ index: m.index, cmd: `next ${m[1]}`, why });
  }
  return out;
}
/** The violations of one tree: scripts (package.json's map) and files ({ rel: text }). */
export function violations(scripts, files) {
  const v = [];
  for (const [name, cmd] of Object.entries(scripts)) for (const l of launches(cmd)) v.push(`package.json script "${name}": \`${cmd}\` ${l.why}`);
  for (const [rel, text] of Object.entries(files)) {
    text.split('\n').forEach((line, i) => { for (const l of launches(line)) v.push(`${rel}:${i + 1}: \`${line.trim()}\` ${l.why}`); });
  }
  return v;
}

// --- seeded controls (in memory) ---
const before = violations({ dev: 'next dev apps/web', build: 'next build apps/web', start: 'next start apps/web' }, {});
check('the pre-bind package.json scripts: two violations, dev and start, each binding every interface',
  before.length === 2 && /"dev"/.test(before[0]) && /"start"/.test(before[1]) && before.every((s) => /every interface/.test(s)), before.join(' | '));
for (const cmd of ['next dev apps/web -H 127.0.0.1', 'next start apps/web --hostname=localhost', 'next dev apps/web -H ::1', 'next start apps/web --hostname 127.0.0.1 -p 3123'])
  check(`accepted: ${cmd}`, violations({ s: cmd }, {}).length === 0, violations({ s: cmd }, {}).join(' | '));
for (const host of ['0.0.0.0', '::', '192.168.1.5']) {
  const v = violations({ s: `next dev apps/web -H ${host}` }, {});
  check(`refused with the host named: -H ${host}`, v.length === 1 && v[0].includes(JSON.stringify(host)), v.join(' | '));
}
const seeded = violations({ dev: 'next dev apps/web -H 127.0.0.1', preview: 'next start apps/web' }, {});
check('a new launcher script ("preview": "next start apps/web") is caught by its command, not its name',
  seeded.length === 1 && seeded[0].includes('"preview"'), seeded.join(' | '));
const line = 'npx next dev -p 3321';
const doc = violations({}, { 'scripts/x/README.md': `# run\n\n${line}\n` });
check('a tracked instruction `npx next dev -p 3321` is caught with file:line', doc.length === 1 && doc[0].startsWith('scripts/x/README.md:3:'), doc.join(' | '));
check('the same instruction with -H 127.0.0.1 is accepted', violations({}, { 'README.md': `${line} -H 127.0.0.1\n` }).length === 0);
check('a quoted instruction stops at the quote (`npx next dev` running, then -H later on the line is not its host)',
  violations({}, { 'README.md': 'needs `npx next dev` running; see -H 127.0.0.1\n' }).length === 1);

// --- the tree ---
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const launchers = Object.entries(pkg.scripts).filter(([, c]) => /\bnext\s+(dev|start)\b/.test(c)).map(([n]) => n);
check('package.json has launchers to gate (dev and start at least)', launchers.includes('dev') && launchers.includes('start'), launchers.join(','));
const ls = spawnSync('git', ['ls-files', '-z', '--', 'scripts', 'README.md'], { cwd: ROOT, encoding: 'utf8' });
const tracked = ls.status === 0 ? ls.stdout.split('\0').filter(Boolean) : [];
const files = {};
for (const rel of tracked) {
  if (/\.(m?js|cjs|ts|tsx)$/.test(rel)) continue;
  let buf;
  try { buf = fs.readFileSync(path.join(ROOT, rel)); } catch { continue; } // deleted in the worktree
  if (buf.includes(0)) continue; // binary
  files[rel] = buf.toString('utf8');
}
check('tracked instruction files were read (scripts/** and README.md)', Object.keys(files).length > 10 && 'README.md' in files, `${Object.keys(files).length} files`);
const v = violations(pkg.scripts, files);
for (const s of v) console.log(`  ${s}`);
check(`every tracked way of starting the web mount binds loopback (${launchers.length} launcher scripts, ${Object.keys(files).length} instruction files)`, v.length === 0, `${v.length} violations`);

const mount = fs.readFileSync(path.join(ROOT, 'apps/server/src/mount.ts'), 'utf8');
const literals = mount.match(/127\(\?:/g) ?? [];
check('apps/server/src/mount.ts declares no loopback regex of its own', literals.length === 0, `${literals.length} 127-octet regex literals`);
check('apps/server/src/mount.ts peer check calls the shared isLoopbackAddr',
  /import\s*\{[^}]*\bisLoopbackAddr\b[^}]*\}\s*from\s*'@bp\/core\/scan\/local-only'/.test(mount) && /isLoopbackAddr\(req\.socket\.remoteAddress/.test(mount));

console.log(`web-bind: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
