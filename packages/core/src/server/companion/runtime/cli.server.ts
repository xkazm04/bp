// The companion's model door to the Claude Code CLI (`claude -p -`, stream-json on stdout, the prompt on stdin), ported from
// athena's harness (cli_harness.py: argv, decode, failure classes; transports.py: child_env, the subprocess lifecycle).
//   argv     a turn: --tools "" (no built-in tool at all: no file, shell or web) and ONLY the bp MCP server
//            (--strict-mcp-config --mcp-config <file>, --allowedTools mcp__bp__*, --permission-mode dontAsk so anything else
//            is denied instead of prompting nobody). A utility or sleep leg: no tools, no MCP server, no session kept.
//   env      the parent's, minus every *_API_KEY (model runs go through the CLI on the person's plan, never a paid key) and a
//            parent Claude Code session's markers (CLAUDECODE, CLAUDE_CODE_SESSION_ID, ...), which would make the child
//            think it is a nested session.
//   bin      BP_CLAUDE_BIN, else `claude` on PATH (as jobs.server.ts). On Windows a .exe runs directly; an npm `claude.cmd`
//            shim is read for the cli.js it starts, which then runs on this Node (no cmd.exe, so no re-parsed arguments);
//            a .js/.mjs BP_CLAUDE_BIN runs on this Node too (the checks' stand-ins).
//   decode   system -> the session id; assistant text -> text; tool_use named mcp__bp__<wire> -> tool (other tools are not
//            the companion's and are dropped, with their results); user tool_result of a kept call -> tool_result with ok
//            and a one-line summary; result -> the verdict and total_cost_usd (null when absent). Unknown lines are skipped.
//   verdict  done only on exit 0 with a non-error result record; anything else is classified from stderr and the result.
// The transport is injectable (setTransport) so the checks replay a recorded transcript with no CLI; every exit path kills
// the child's tree.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { MCP_SERVER_NAME, type FailureClass, type TurnEvent } from '../../../companion/contract.ts';
import { toolByWire } from '../../../companion/catalog.ts';

if (typeof window !== 'undefined') throw new Error('cli.server.ts is server-only');

// ------------------------------------------------------------------------------------------ argv
const BASE = ['-p', '-', '--output-format', 'stream-json', '--verbose'];
/** Nothing that prompts: built-ins off, skills and slash commands off, denials instead of questions. */
const QUIET = ['--tools', '', '--disable-slash-commands', '--permission-mode', 'dontAsk'];

export function turnArgs(o: { model: string; mcpConfig: string; resume?: string; promptFile?: string }): string[] {
  return [
    ...BASE, ...(o.resume ? ['--resume', o.resume] : []), '--model', o.model, ...QUIET,
    '--strict-mcp-config', '--mcp-config', o.mcpConfig, '--allowedTools', `mcp__${MCP_SERVER_NAME}__*`,
    ...(o.promptFile ? ['--system-prompt-file', o.promptFile] : []),
  ];
}

export function legArgs(o: { model: string; promptFile?: string }): string[] {
  return [...BASE, '--model', o.model, ...QUIET, '--strict-mcp-config', '--no-session-persistence', ...(o.promptFile ? ['--system-prompt-file', o.promptFile] : [])];
}

// ------------------------------------------------------------------------------------------- env
/** A parent Claude Code session's identity (athena transports.py SESSION_MARKERS, claude 2.1). Not a CLAUDE_CODE_* prefix:
 *  that would also drop real configuration (CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_CODE_GIT_BASH_PATH). */
const SESSION_MARKERS = new Set(['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_ENTRYPOINT']);

export function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    const K = k.toUpperCase();
    if (v === undefined || K.endsWith('_API_KEY') || SESSION_MARKERS.has(K)) continue;
    out[k] = v;
  }
  return out as NodeJS.ProcessEnv;
}

// ------------------------------------------------------------------------------------------- bin
export const CLI_MISSING = 'Claude Code CLI not found (set BP_CLAUDE_BIN)';

function winLookup(bin: string): string | null {
  const exts = path.extname(bin) ? [''] : ['.exe', '.com', '.cmd', '.bat'];
  const dirs = /[\\/]/.test(bin) ? [''] : (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) for (const e of exts) {
    const f = d ? path.join(d, bin + e) : path.resolve(bin + e);
    try { if (fs.statSync(f).isFile()) return f; } catch { /* not here */ }
  }
  return null;
}

/** How to start the CLI: `{ file, pre }` (pre = arguments ahead of ours), or the reason it cannot be. */
export function resolveBin(): { file: string; pre: string[] } | { error: string; missing: boolean } {
  const bin = process.env.BP_CLAUDE_BIN || 'claude';
  if (/\.(mjs|cjs|js)$/i.test(bin)) return fs.existsSync(bin) ? { file: process.execPath, pre: [bin] } : { error: CLI_MISSING, missing: true };
  if (process.platform !== 'win32') return { file: bin, pre: [] };
  const f = winLookup(bin);
  if (!f) return { error: CLI_MISSING, missing: true };
  if (!/\.(cmd|bat)$/i.test(f)) return { file: f, pre: [] };
  // npm's shim: `"%_prog%" "%dp0%\node_modules\@anthropic-ai\claude-code\cli.js" %*`. Run its script on this Node instead
  // of through cmd.exe, which would re-parse every argument (the prompt stays on stdin either way).
  try {
    const m = /"%~?dp0%?\\?([^"]+\.(?:c|m)?js)"/i.exec(fs.readFileSync(f, 'utf8'));
    const js = m ? path.join(path.dirname(f), m[1]) : '';
    if (js && fs.existsSync(js)) return { file: process.execPath, pre: [js] };
  } catch { /* unreadable: below */ }
  return { error: `cannot read the script ${path.basename(f)} starts; set BP_CLAUDE_BIN to claude.exe or its cli.js`, missing: false };
}

// ------------------------------------------------------------------------------------- transport
export interface CliRequest { args: string[]; stdin: string; cwd: string; env: NodeJS.ProcessEnv }
export interface CliExit { code: number | null; stderr: string; error?: string; missing?: boolean }
/** One CLI run: its stdout lines, its exit, and a kill that takes the whole process tree. */
export interface CliRun { lines: AsyncIterable<string>; exit: Promise<CliExit>; kill(): void }
export type Transport = (req: CliRequest) => CliRun;

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  const fallback = () => { try { child.kill('SIGKILL'); } catch { /* gone */ } };
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', fallback); } catch { fallback(); }
    return;
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch { fallback(); }
}

const noRun = (exit: CliExit): CliRun => ({ lines: (async function* () { /* nothing ran */ })(), exit: Promise.resolve(exit), kill: () => {} });

export const spawnTransport: Transport = (req) => {
  const bin = resolveBin();
  if ('error' in bin) return noRun({ code: null, stderr: '', error: bin.error, missing: bin.missing });
  let child: ChildProcess;
  try {
    child = spawn(bin.file, [...bin.pre, ...req.args], { cwd: req.cwd, env: req.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === 'ENOENT';
    return noRun({ code: null, stderr: '', error: missing ? CLI_MISSING : (e as Error).message, missing });
  }
  let stderr = '';
  child.stderr?.on('data', (d: Buffer) => { stderr = (stderr + d.toString('utf8')).slice(-8192); });
  const exit = new Promise<CliExit>((resolve) => {
    child.on('error', (e: NodeJS.ErrnoException) => resolve({ code: null, stderr, error: e.code === 'ENOENT' ? CLI_MISSING : e.message, missing: e.code === 'ENOENT' }));
    child.on('close', (code) => resolve({ code, stderr }));
  });
  child.stdin?.on('error', () => { /* it exited before reading: its exit says why */ });
  child.stdin?.end(req.stdin);
  return { lines: readline.createInterface({ input: child.stdout!, crlfDelay: Infinity }), exit, kill: () => killTree(child) };
};

const g = globalThis as unknown as { __bpCompanionTransport?: Transport };
/** The checks' seam: replace the transport (null restores the real CLI). */
export function setTransport(t: Transport | null): void { g.__bpCompanionTransport = t ?? undefined; }
export const transport = (): Transport => g.__bpCompanionTransport ?? spawnTransport;

// ---------------------------------------------------------------------------------------- decode
export interface ResultRecord { isError: boolean; costUsd: number | null; subtype: string; said: string }
export type Decoded = { kind: 'session'; id: string } | { kind: 'event'; event: TurnEvent } | { kind: 'result'; result: ResultRecord };

type Block = { type?: unknown; text?: unknown; id?: unknown; name?: unknown; input?: unknown; tool_use_id?: unknown; content?: unknown; is_error?: unknown };
const blocks = (rec: Record<string, unknown>): Block[] => {
  const c = (rec.message as { content?: unknown } | undefined)?.content;
  return Array.isArray(c) ? (c as Block[]).filter((b) => b && typeof b === 'object') : [];
};
const BP_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

/** The first line of a tool result, at most 160 characters. */
export function summarize(content: unknown): string {
  const text = typeof content === 'string' ? content
    : Array.isArray(content) ? content.map((c) => (c && typeof c === 'object' && typeof (c as Block).text === 'string' ? (c as Block).text as string : '')).join(' ')
    : '';
  const line = text.trim().split(/\r?\n/).find((l) => l.trim()) ?? '';
  return line.length > 160 ? line.slice(0, 159) + '…' : line;
}

/** One stdout line -> what it means. `calls` carries the ids of the bp tool calls seen so far (their results are kept). */
export function decodeLine(line: string, calls: Set<string>): Decoded[] {
  let rec: Record<string, unknown>;
  try { const j = JSON.parse(line); if (!j || typeof j !== 'object' || Array.isArray(j)) return []; rec = j; } catch { return []; }
  if (rec.type === 'system') return typeof rec.session_id === 'string' && rec.session_id ? [{ kind: 'session', id: rec.session_id }] : [];
  if (rec.type === 'assistant') {
    const out: Decoded[] = [];
    for (const b of blocks(rec)) {
      if (b.type === 'text' && typeof b.text === 'string' && b.text) out.push({ kind: 'event', event: { type: 'text', delta: b.text } });
      else if (b.type === 'tool_use' && typeof b.name === 'string' && b.name.startsWith(BP_PREFIX) && typeof b.id === 'string') {
        const wire = b.name.slice(BP_PREFIX.length);
        calls.add(b.id);
        out.push({ kind: 'event', event: { type: 'tool', name: toolByWire(wire)?.name ?? wire, args: b.input ?? {}, callId: b.id } });
      }
    }
    return out;
  }
  if (rec.type === 'user') {
    return blocks(rec).filter((b) => b.type === 'tool_result' && typeof b.tool_use_id === 'string' && calls.has(b.tool_use_id))
      .map((b) => ({ kind: 'event', event: { type: 'tool_result', callId: b.tool_use_id as string, ok: b.is_error !== true, summary: summarize(b.content) } }));
  }
  if (rec.type === 'result') {
    const isError = rec.is_error === true || (typeof rec.subtype === 'string' && rec.subtype !== 'success');
    const cost = rec.total_cost_usd;
    return [{ kind: 'result', result: {
      isError, costUsd: typeof cost === 'number' && Number.isFinite(cost) ? cost : null,
      subtype: typeof rec.subtype === 'string' ? rec.subtype : '',
      said: isError ? (typeof rec.result === 'string' ? rec.result : Array.isArray(rec.errors) ? rec.errors.join(' ') : '') : '',
    } }];
  }
  return [];
}

// -------------------------------------------------------------------------------------- classify
/** claude 2.x, as of 2026-10 (athena CLAUDE_SIGNATURES). gone and poisoned first: "prompt is too long" can arrive inside an
 *  "API Error: 400" line, and it is the thread, not the service, that has to change. */
export const SIGNATURES: readonly (readonly [string, FailureClass])[] = [
  ['no conversation found with session id', 'gone'],
  ['prompt is too long', 'poisoned'],
  ['exceed context limit', 'poisoned'],
  ['invalid api key', 'auth'],
  ['please run /login', 'auth'],
  ['oauth token has expired', 'auth'],
  ['authentication_error', 'auth'],
  ['not logged in', 'auth'],
  ['usage limit', 'limit'],
  ['rate_limit_error', 'limit'],
  ['overloaded', 'transient'],
  ['api error: 5', 'transient'],
  ['connection error', 'transient'],
  ['econnreset', 'transient'],
  ['etimedout', 'transient'],
];

/** null = done (exit 0 and a non-error result); else the failure's class. */
export function classify(exit: CliExit, result: ResultRecord | null): FailureClass | null {
  if (exit.code === 0 && result && !result.isError) return null;
  const hay = `${exit.stderr}\n${result?.said ?? ''}\n${result?.subtype ?? ''}\n${exit.error ?? ''}`.toLowerCase();
  for (const [sig, cls] of SIGNATURES) if (hay.includes(sig)) return cls;
  return 'unknown';
}
