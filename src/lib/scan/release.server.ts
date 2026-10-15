// The release train's server side: every triage and release write goes through lens-scan's own store.mjs (the single
// owner of the transition rules; the blueprint never re-implements them), and the reads a release needs from git and
// gh. Every child is started with execFile and an argument array, never a shell string:
//   store.mjs   `node <lens-scan>/scripts/store.mjs --db <store> <command> ...`; <lens-scan> is BP_LENS_SCAN_DIR, else
//               ~/.claude/skills/lens-scan, through realpath. It prints JSON on stdout; exit 2 = bad input, 1 = refused.
//   gh          `gh api user --jq .login` once per server process (who triages: `user:<login>`, else `user:blueprint`),
//               and `gh auth status` before a release job starts. BP_GH_BIN overrides the binary (a .mjs runs on this
//               Node: the checks' fake).
//   git         `git tag --list v* --sort=-v:refname` in the product root, for the version suggestion.
// Server-only: route handlers import it.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TriageBody, TriageResult } from './types';

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
/** lens-scan's store.mjs, or null when the skill is not installed where it is looked for. */
export function storeScript(): string | null {
  const dir = process.env.BP_LENS_SCAN_DIR || path.join(os.homedir(), '.claude', 'skills', 'lens-scan');
  try { const f = path.join(fs.realpathSync(dir), 'scripts', 'store.mjs'); return fs.existsSync(f) ? f : null; } catch { return null; }
}
export const NO_LENS_SCAN = 'lens-scan not found (set BP_LENS_SCAN_DIR or install the skill at ~/.claude/skills/lens-scan)';

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
