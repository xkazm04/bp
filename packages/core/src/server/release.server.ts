// The release train's server side: every triage and release write goes through lens-scan's own store.mjs (the single
// owner of the transition rules; the blueprint never re-implements them), and the reads a release needs from git and
// gh. Every child is started with execFile and an argument array, never a shell string:
//   store.mjs   `node <lens-scan>/scripts/store.mjs --db <store> <command> ...`; <lens-scan> is BP_LENS_SCAN_DIR when it
//               is set (then it is the ONLY place looked: an explicit setting must fail visibly, not fall through to
//               another install), else ~/.claude/skills/lens-scan, then `<registry.local>/skills/lens-scan` for the
//               registry `.ai/manifest.yaml` declares, then that registry as seen from the main git checkout when this
//               is a linked worktree (lensScanDirs()) — all through realpath. It prints JSON on stdout; exit 2 = bad
//               input, 1 = refused.
//   gh          `gh api user --jq .login` once per server process (who triages: `user:<login>`, else `user:blueprint`),
//               and `gh auth status` before a release job starts. BP_GH_BIN overrides the binary (a .mjs runs on this
//               Node: the checks' fake).
//   git         `git tag --list v* --sort=-v:refname` in the product root, for the version suggestion; `git show` of one
//               item commit (message + stat, numstat, the patch cut at 2000 lines) for the commits route.
// Server-only: route handlers import it.
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommitDiff, TriageBody, TriageResult } from '../scan/types';
import { MAX_TRIAGE } from '../scan/types';

if (typeof window !== 'undefined') throw new Error('release.server.ts is server-only');

const STORE_MS = 30000, GH_MS = 5000, GIT_MS = 10000;
/** Most ids one triage or release-add call may name (scan/types.ts owns the value; the routes import it from here). */
export { MAX_TRIAGE };
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
 * The registry `.ai/manifest.yaml` declares (`registry:` / `  local: <path>`), as written: a path relative to the
 * blueprint root (or absolute), or null when the file is absent or declares none. Read line-wise: the declaration is
 * two keys deep and the repo carries no YAML parser.
 */
function declaredRegistry(root: string): string | null {
  let text: string;
  try { text = fs.readFileSync(path.join(root, '.ai', 'manifest.yaml'), 'utf8'); } catch { return null; }
  let inRegistry = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    if (/^\S/.test(line)) { inRegistry = /^registry:\s*$/.test(line); continue; }
    if (!inRegistry) continue;
    const m = /^\s+local:\s*(.+?)\s*$/.exec(line);
    if (m) { const v = m[1].replace(/^['"]|['"]$/g, '').trim(); return v || null; }
  }
  return null;
}

const mainRoots = new Map<string, string | null>();
/**
 * The blueprint root as it sits in the repo's MAIN checkout, when `root` is in a linked git worktree; null in the
 * main checkout itself, outside git, or when git cannot say. Taken from git's own answer, never guessed from the
 * path: `--git-common-dir` is `<main>/.git` in every worktree of a repo (just `.git` in the main one), and the
 * blueprint keeps its place below the top level. Asked once per root.
 */
export function mainCheckoutRoot(root: string): string | null {
  if (mainRoots.has(root)) return mainRoots.get(root) ?? null;
  let found: string | null = null;
  try {
    const [top, common] = execFileSync('git', ['rev-parse', '--show-toplevel', '--git-common-dir'], { cwd: root, encoding: 'utf8', timeout: GIT_MS, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/).map((l) => l.trim());
    const commonDir = common ? path.resolve(root, common) : '';
    if (top && commonDir && path.basename(commonDir) === '.git') {
      const main = path.join(path.dirname(commonDir), path.relative(path.resolve(top), root));
      if (!samePath(main, root)) found = main;
    }
  } catch { /* not a git checkout, or no git: there is no main checkout to look in */ }
  mainRoots.set(root, found);
  return found;
}

const samePath = (a: string, b: string) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

/** What lensScanDirs() decides from; each field is what the live call reads from the environment, the home, the manifest and git. */
export interface LensScanInputs { named: string | undefined; home: string; root: string | null; declared: string | null; mainRoot: string | null }

/**
 * Where a lens-scan install is looked for, in order. BP_LENS_SCAN_DIR, when it is set, is the ONLY place looked: an
 * operator who names a directory must see that name fail, never fall through to a different install. Otherwise:
 *   1. `~/.claude/skills/lens-scan`;
 *   2. `<registry.local>/skills/lens-scan`, registry.local resolved against the blueprint root -- a skill installed in
 *      the declared registry is installed, and a resolver that cannot see the declaration turns every triage and
 *      release write into "not installed";
 *   3. the same declaration resolved against the blueprint root in the repo's MAIN checkout, when this one is a linked
 *      git worktree (mainCheckoutRoot()). A worktree of this repo is the same install as its main checkout, and the
 *      registry is declared relative to that checkout: it sits beside the main checkout, not beside each worktree.
 * Found 2026-10-22: every headless builder worktree (under ~/.personas/headless-masters/worktrees/bp/<id>) resolved
 * `../ai-registry` beside itself, where nothing is installed, so check:store-triage, check:store-compare and
 * check:scan-jobs SKIPped there -- and since a SKIP fails the suite (ed1e8d0) the gate read 3 FAIL on every branch for
 * a reason no branch had, while the main checkout read green. The third candidate comes LAST so that nothing changes
 * where 1 or 2 already finds an install, and it is dropped when it is the same place as 2 (the main checkout itself).
 * A worktree whose main checkout has no registry still finds nothing, and the checks still SKIP and fail.
 */
export function lensScanDirsFor(i: LensScanInputs): string[] {
  if (i.named) return [i.named];
  const out = [path.join(i.home, '.claude', 'skills', 'lens-scan')];
  if (i.root && i.declared) {
    const here = path.join(path.resolve(i.root, i.declared), 'skills', 'lens-scan');
    out.push(here);
    if (i.mainRoot) {
      const main = path.join(path.resolve(i.mainRoot, i.declared), 'skills', 'lens-scan');
      if (!samePath(main, here)) out.push(main);
    }
  }
  return out;
}

/** lensScanDirsFor() on this process: BP_LENS_SCAN_DIR, the home, this blueprint's manifest and git's main checkout. */
export function lensScanDirs(): string[] {
  const named = process.env.BP_LENS_SCAN_DIR;
  if (named) return [named];
  const root = blueprintRoot(), declared = root ? declaredRegistry(root) : null;
  return lensScanDirsFor({ named, home: os.homedir(), root, declared, mainRoot: root && declared ? mainCheckoutRoot(root) : null });
}

/** lens-scan's store.mjs, from the first of lensScanDirs() that holds one; null when none does. */
export function storeScript(): string | null { return storeScriptIn(lensScanDirs()); }
/** store.mjs from the first of `dirs` that holds one (through realpath); null when none does. */
export function storeScriptIn(dirs: string[]): string | null {
  for (const dir of dirs) {
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
    // An exit-0 answer that is not JSON is the one failure here with no other witness: store.mjs said nothing on
    // stderr and the job wrote nothing, so without the text the operator has only 'no JSON' to go on. Carry the
    // first line of what it did say (200 chars; a store answer is one JSON object, so a line is enough to name it).
    try { return { ok: true, data: JSON.parse(r.stdout) as T }; } catch {
      const said = r.stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean)?.slice(0, 200);
      return { ok: false, kind: 'error', error: 'store.mjs answered no JSON' + (said ? `: ${said}` : ' and no output') };
    }
  }
  const why = r.stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).filter((l) => !/ExperimentalWarning|--trace-warnings/.test(l)).pop() ?? `exit ${r.code}`;
  return { ok: false, kind: r.code === 2 ? 'bad' : r.code === 1 ? 'refused' : 'error', error: why.replace(/^store: /, '') };
}

/**
 * A free-text value for a store.mjs flag. store.mjs's parseArgs reads a next argv entry that starts with `--` as a flag
 * of its own (and has no `--key=value` form), so a note like `--- see PR 12` would turn `--note` into `true` and the
 * person's text into a stray flag. One leading space keeps such a value a value (subprocess-lifecycle/spawn-contract:
 * a value is never promoted to an option); any other text passes unchanged.
 */
export function valueArg(v: string): string {
  return v.startsWith('--') ? ' ' + v : v;
}

/** A person's triage, through store.mjs `triage` (it owns which statuses may move and settles the packs). */
export function triage(dbFile: string, body: TriageBody, by: string): Promise<StoreAnswer<TriageResult>> {
  const args = ['triage', '--ids', body.ids.join(','), '--decision', body.decision, '--by', by];
  if (body.note !== undefined && body.note.trim()) args.push('--note', valueArg(body.note));
  return storeCall<TriageResult>(dbFile, args);
}

// ------------------------------------------------------------------------------------- gh
function ghCmd(args: string[]): { file: string; args: string[] } {
  const bin = process.env.BP_GH_BIN || 'gh';
  return /\.(mjs|cjs|js)$/i.test(bin) ? { file: process.execPath, args: [bin, ...args] } : { file: bin, args };
}
/** How long a `user:blueprint` answer is kept before gh is asked again: a `gh auth login` after the server started reaches the next decision. */
export const FALLBACK_RETRY_MS = 60000;
const G = globalThis as typeof globalThis & { __bpGhBy?: Promise<string>; __bpGhByAt?: number };
/** Who triages from this blueprint: `user:<gh login>`, asked once per server process; `user:blueprint` when gh is missing or signed out, asked again after FALLBACK_RETRY_MS. */
export function triageBy(): Promise<string> {
  if (G.__bpGhByAt !== undefined && Date.now() - G.__bpGhByAt >= FALLBACK_RETRY_MS) G.__bpGhBy = undefined;
  return (G.__bpGhBy ??= (async () => {
    G.__bpGhByAt = undefined;
    const c = ghCmd(['api', 'user', '--jq', '.login']);
    const r = await run(c.file, c.args, { timeout: GH_MS });
    const login = r.code === 0 ? r.stdout.trim() : '';
    if (/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)) return 'user:' + login;
    G.__bpGhByAt = Date.now();
    return FALLBACK_BY;
  })());
}
/** Forget the cached login (the checks switch fakes). */
export const resetTriageBy = (): void => { G.__bpGhBy = undefined; G.__bpGhByAt = undefined; };

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
 * git's own refusals that mean "this repository has no such object". Matched on the message, not the exit code: git
 * exits 128 for a bad rev AND for `not a git repository`, a dubious-ownership refusal and a broken index, so the code
 * alone cannot tell "no such commit" (the route's 404: stop looking) from "this root is not usable" (its 503: fix the
 * product's root and retry). Anything git says that is not on this list is the second kind.
 */
const NO_SUCH_OBJECT = /\b(bad object|unknown revision or path not in the working tree|not a valid object name|bad revision|no such path)\b/i;

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
    const gone = !bad.missing && bad.code !== -1 && NO_SUCH_OBJECT.test(bad.stderr);
    return { ok: false, kind: gone ? 'missing' : 'error', error: why };
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
