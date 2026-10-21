// The release train's server side: every triage and release write goes through lens-scan's own store.mjs (the single
// owner of the transition rules; the blueprint never re-implements them), and the reads a release needs from git and
// gh. Every child is started with execFile and an argument array, never a shell string:
//   store.mjs   `node <lens-scan>/scripts/store.mjs --db <store> <command> ...`; <lens-scan> is BP_LENS_SCAN_DIR when it
//               is set (then it is the ONLY place looked: an explicit setting must fail visibly, not fall through to
//               another install), else ~/.claude/skills/lens-scan and then `<registry.local>/skills/lens-scan` for the
//               registry `.ai/manifest.yaml` declares — all through realpath. It prints JSON on stdout; exit 2 = bad
//               input, 1 = refused.
//   gh          `gh api user --jq .login` once per server process (who triages: `user:<login>`, else `user:blueprint`),
//               and `gh auth status` before a release job starts. BP_GH_BIN overrides the binary (a .mjs runs on this
//               Node: the checks' fake).
//   git         `git tag --list v* --sort=-v:refname` in the product root, for the version suggestion; `git show` of one
//               item commit (message + stat, numstat, the patch cut at 2000 lines) for the commits route.
// Server-only: route handlers import it.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommitDiff, TriageBody, TriageResult } from '../scan/types';

if (typeof window !== 'undefined') throw new Error('release.server.ts is server-only');

const STORE_MS = 30000, GH_MS = 5000, GIT_MS = 10000;
/** Most ids one triage or release-add call may name. */
export const MAX_TRIAGE = 200;
export const FALLBACK_BY = 'user:blueprint';

interface Out { code: number; stdout: string; stderr: string; missing?: boolean }
/** execFile, never rejecting: the exit code (-1 when it could not start or timed out) and both streams. */
function run(file: string, args: string[], opts: { cwd?: string; timeout: number }): Promise<Out> {
  return new Promise((resolve) => {
    execFile(file, args, { cwd: opts.cwd, timeout: opts.timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null;
      const code = !e ? 0 : typeof e.code === 'number' ? e.code : -1;
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || (e && typeof e.code !== 'number' ? e.message : ''), missing: e?.code === 'ENOENT' });
    });
  });
}

// ------------------------------------------------------------------------------------- store.mjs
const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The blueprint's own root: the nearest ancestor of this module holding `.ai/manifest.yaml`. Found from the module,
 * not from `process.cwd()`, because a check or a CLI may run with any working directory.
 */
function blueprintRoot(): string | null {
  for (let d = HERE, prev = ''; d !== prev; prev = d, d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.ai', 'manifest.yaml'))) return d;
  }
  return null;
}

/**
 * The registry `.ai/manifest.yaml` declares (`registry:` / `  local: <path>`, resolved against the blueprint root),
 * or null when the file is absent or declares none. Read line-wise: the declaration is two keys deep and the repo
 * carries no YAML parser.
 */
function declaredRegistry(): string | null {
  const root = blueprintRoot();
  if (!root) return null;
  let text: string;
  try { text = fs.readFileSync(path.join(root, '.ai', 'manifest.yaml'), 'utf8'); } catch { return null; }
  let inRegistry = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    if (/^\S/.test(line)) { inRegistry = /^registry:\s*$/.test(line); continue; }
    if (!inRegistry) continue;
    const m = /^\s+local:\s*(.+?)\s*$/.exec(line);
    if (m) { const v = m[1].replace(/^['"]|['"]$/g, '').trim(); return v ? path.resolve(root, v) : null; }
  }
  return null;
}

/**
 * Where a lens-scan install is looked for, in order. BP_LENS_SCAN_DIR, when it is set, is the ONLY place looked: an
 * operator who names a directory must see that name fail, never fall through to a different install. Otherwise:
 * `~/.claude/skills/lens-scan`, then `<registry.local>/skills/lens-scan` for the registry the manifest declares --
 * a skill installed in the declared registry is installed, and a resolver that cannot see the declaration turns
 * every triage and release write into "not installed".
 */
export function lensScanDirs(): string[] {
  const set = process.env.BP_LENS_SCAN_DIR;
  if (set) return [set];
  const out = [path.join(os.homedir(), '.claude', 'skills', 'lens-scan')];
  const reg = declaredRegistry();
  if (reg) out.push(path.join(reg, 'skills', 'lens-scan'));
  return out;
}

/** lens-scan's store.mjs, from the first of lensScanDirs() that holds one; null when none does. */
export function storeScript(): string | null {
  for (const dir of lensScanDirs()) {
    try { const f = path.join(fs.realpathSync(dir), 'scripts', 'store.mjs'); if (fs.existsSync(f)) return f; } catch { /* not installed here */ }
  }
  return null;
}
export const NO_LENS_SCAN = 'lens-scan not found (set BP_LENS_SCAN_DIR, install the skill at ~/.claude/skills/lens-scan, or declare registry.local in .ai/manifest.yaml)';

/** What a store.mjs call came to: its JSON, or why not (`bad` = exit 2, `refused` = exit 1, `error` = it did not run). */
export type StoreAnswer<T> = { ok: true; data: T } | { ok: false; kind: 'bad' | 'refused' | 'error'; error: string };

/** One store.mjs subcommand on the product's store file. */
export async function storeCall<T>(dbFile: string, args: string[]): Promise<StoreAnswer<T>> {
  const script = storeScript();
  if (!script) return { ok: false, kind: 'error', error: NO_LENS_SCAN };
  const r = await run(process.execPath, ['--no-warnings', script, '--db', dbFile, ...args], { cwd: path.dirname(dbFile), timeout: STORE_MS });
  if (r.code === 0) {
    try { return { ok: true, data: JSON.parse(r.stdout) as T }; } catch { return { ok: false, kind: 'error', error: 'store.mjs answered no JSON' }; }
  }
  const why = r.stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).filter((l) => !/ExperimentalWarning|--trace-warnings/.test(l)).pop() ?? `exit ${r.code}`;
  return { ok: false, kind: r.code === 2 ? 'bad' : r.code === 1 ? 'refused' : 'error', error: why.replace(/^store: /, '') };
}

/** A person's triage, through store.mjs `triage` (it owns which statuses may move and settles the packs). */
export function triage(dbFile: string, body: TriageBody, by: string): Promise<StoreAnswer<TriageResult>> {
  const args = ['triage', '--ids', body.ids.join(','), '--decision', body.decision, '--by', by];
  if (body.note !== undefined && body.note.trim()) args.push('--note', body.note);
  return storeCall<TriageResult>(dbFile, args);
}

// ------------------------------------------------------------------------------------- gh
function ghCmd(args: string[]): { file: string; args: string[] } {
  const bin = process.env.BP_GH_BIN || 'gh';
  return /\.(mjs|cjs|js)$/i.test(bin) ? { file: process.execPath, args: [bin, ...args] } : { file: bin, args };
}
const G = globalThis as typeof globalThis & { __bpGhBy?: Promise<string> };
/** Who triages from this blueprint: `user:<gh login>`, asked once per server process; `user:blueprint` when gh is missing or signed out. */
export function triageBy(): Promise<string> {
  return (G.__bpGhBy ??= (async () => {
    const c = ghCmd(['api', 'user', '--jq', '.login']);
    const r = await run(c.file, c.args, { timeout: GH_MS });
    const login = r.code === 0 ? r.stdout.trim() : '';
    return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login) ? 'user:' + login : FALLBACK_BY;
  })());
}
/** Forget the cached login (the checks switch fakes). */
export const resetTriageBy = (): void => { G.__bpGhBy = undefined; };

/** Whether `gh auth status` exits 0 (a release job pushes and opens a PR with the user's own gh login). */
export async function ghAuthed(): Promise<boolean> {
  const c = ghCmd(['auth', 'status']);
  return (await run(c.file, c.args, { timeout: GH_MS })).code === 0;
}

// ------------------------------------------------------------------------------------- git and manifests
/** The most patch lines a CommitDiff carries (`lines` still counts them all). */
export const DIFF_LINES = 2000;
/** What `git show` of one commit came to: the diff, or `missing` (git ran and has no such commit) or `error` (git did not run). */
export type DiffAnswer = { ok: true; data: CommitDiff } | { ok: false; kind: 'missing' | 'error'; error: string };

/**
 * One commit of the repo at `root` as the ledger's compare panel shows it, by three `git show`s (no pager, colour,
 * external diff or textconv; paths unquoted): `--stat=200 --format=%H%n%B%x00` for the full sha, the message and the
 * stat; `--numstat --format=` for the files (a binary file's `-` counts read 0); `--format= --unified=3` for the
 * patch, cut at DIFF_LINES. The caller has already checked `sha` is an item commit of the product's store.
 */
export async function commitDiff(root: string, sha: string): Promise<DiffAnswer> {
  const git = (args: string[]) => run('git', ['-c', 'core.quotepath=off', '--no-pager', 'show', '--no-color', '--no-ext-diff', '--no-textconv', ...args, sha], { cwd: root, timeout: GIT_MS });
  const [head, num, diff] = await Promise.all([git(['--stat=200', '--format=%H%n%B%x00']), git(['--numstat', '--format=']), git(['--format=', '--unified=3'])]);
  const bad = [head, num, diff].find((r) => r.code !== 0);
  if (bad) {
    const why = bad.stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] ?? `exit ${bad.code}`;
    return { ok: false, kind: bad.missing || bad.code === -1 ? 'error' : 'missing', error: why };
  }
  // head: <full sha>\n<message>\0\n\n<stat>
  const cut = head.stdout.indexOf('\0');
  const top = cut < 0 ? head.stdout : head.stdout.slice(0, cut), nl = top.indexOf('\n');
  const full = (nl < 0 ? top : top.slice(0, nl)).trim();
  const message = nl < 0 ? '' : top.slice(nl + 1).replace(/\s+$/, '');
  const stat = cut < 0 ? '' : head.stdout.slice(cut + 1).replace(/^\s*\n/, '').replace(/\s+$/, '');
  const files: CommitDiff['files'] = [];
  for (const line of num.stdout.split(/\r?\n/)) {
    const m = /^(-|\d+)\t(-|\d+)\t(.+)$/.exec(line);
    if (m) files.push({ path: m[3], add: m[1] === '-' ? 0 : Number(m[1]), del: m[2] === '-' ? 0 : Number(m[2]) });
  }
  const all = diff.stdout.replace(/^\n+/, '').replace(/\n$/, '');
  const lines = all ? all.split('\n') : [];
  const truncated = lines.length > DIFF_LINES;
  return { ok: true, data: { sha: full, message, stat, files, patch: (truncated ? lines.slice(0, DIFF_LINES) : lines).join('\n'), lines: lines.length, truncated } };
}

/** `git tag --list 'v*' --sort=-v:refname` in the repo, newest first; [] when it is not a git repo or has none. */
export async function versionTags(root: string): Promise<string[]> {
  const r = await run('git', ['tag', '--list', 'v*', '--sort=-v:refname'], { cwd: root, timeout: GIT_MS });
  return r.code === 0 ? r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
}

/** Where a manifest version is looked for, in order: the root, src-tauri, app, desktop, then each `apps/<x>` (and its src-tauri). */
function appDirs(root: string): string[] {
  const out = ['', 'src-tauri', 'app', 'desktop'];
  try {
    for (const e of fs.readdirSync(path.join(root, 'apps'), { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) out.push('apps/' + e, 'apps/' + e + '/src-tauri');
  } catch { /* no apps dir */ }
  return out;
}
/**
 * The product's manifest version as it stands: `package.json` `version`, else `Cargo.toml` `[package]` (or
 * `[workspace.package]`) `version`, else `tauri.conf.json` `version` (each looked for at the root and then in the app
 * dirs). undefined when none states one.
 */
export function manifestVersion(root: string): { version: string; file: string } | undefined {
  const read = (rel: string): string | undefined => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return undefined; } };
  const kinds: [string, (t: string) => unknown][] = [
    ['package.json', (t) => (JSON.parse(t) as { version?: unknown }).version],
    ['Cargo.toml', (t) => /^\[(?:workspace\.)?package\][^[]*?^\s*version\s*=\s*"([^"]+)"/m.exec(t)?.[1]],
    ['tauri.conf.json', (t) => { const j = JSON.parse(t) as { version?: unknown; package?: { version?: unknown } }; return j.version ?? j.package?.version; }],
  ];
  const dirs = appDirs(root);
  for (const [name, get] of kinds) for (const d of dirs) {
    const rel = d ? d + '/' + name : name, text = read(rel);
    if (text === undefined) continue;
    let v: unknown;
    try { v = get(text); } catch { continue; }
    if (typeof v === 'string' && v) return { version: v, file: rel };
  }
  return undefined;
}
