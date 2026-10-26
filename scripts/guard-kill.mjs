#!/usr/bin/env node
// PreToolUse guard (.claude/settings.json, Bash|PowerShell): refuses a command that kills processes by NAME or wholesale,
// because this machine runs several Claude sessions, dev servers and editors at once and a broad kill takes theirs down
// (companion-upgrade, 2026-10-26: a builder ran `taskkill /IM node.exe` with a window-title filter; it matched nothing,
// by luck). A session kills only what it started: by the PID it holds, or the owner of a port it opened
// (`node scripts/kill-port.mjs <port>`). Reads the hook JSON on stdin; prints a deny decision, or nothing to allow.
// Self-test: node scripts/guard-kill.mjs --test
import { fileURLToPath } from 'node:url';

// A kill word counts only in command position - the start of a line, or after ; & | ( a backtick, $( or a quote (a
// `powershell -c "..."` body) - so prose that merely names a command (a doc edit, a commit message) is not refused.
const AT = String.raw`(?:^|[;&|(\n\x60"']|\$\()\s*(?:sudo\s+|cmd(?:\.exe)?\s+\/c\s+)?`;
const rule = (body, flags, why) => [new RegExp(AT + body, flags + 'm'), why];
const RULES = [
  rule(String.raw`taskkill(?:\.exe)?\b(?=[^\n;&|]*\/IM\b)`, 'i', 'taskkill /IM kills every process of that image, other sessions\' included'),
  rule(String.raw`taskkill(?:\.exe)?\b(?![^\n;&|]*\/PID\b)`, 'i', 'taskkill without /PID'),
  rule(String.raw`Stop-Process\b(?![^\n;|]*-Id\b)`, 'i', 'Stop-Process without -Id (by name, or fed by Get-Process)'),
  rule(String.raw`spps\b(?![^\n;|]*-Id\b)`, 'i', 'spps (Stop-Process) without -Id'),
  rule(String.raw`(?:pkill|killall)\b`, 'i', 'pkill / killall match by name'),
  rule(String.raw`kill\s+(?:-\S+\s+)*(?:-1|0)(?:\s|$)`, '', 'kill -1 / kill 0 signal every process the user owns or the whole group'),
  rule(String.raw`wmic\b[^\n]*\bprocess\b[^\n]*\b(?:delete|terminate)\b`, 'i', 'wmic process delete/terminate by query'),
  rule(String.raw`[^\n]*\bInvoke-CimMethod\b[^\n]*\bTerminate\b`, 'i', 'CIM Terminate by query'),
];

/** The reason a command is refused, or null. */
export function refuse(command) {
  for (const [re, why] of RULES) if (re.test(command)) return why;
  return null;
}

function test() {
  const deny = ['taskkill /IM node.exe /F', 'taskkill //F //IM node.exe', 'taskkill /F /FI "WINDOWTITLE eq x*"', 'Stop-Process -Name node -Force',
    'Get-Process node | Stop-Process', 'pkill -f next', 'killall node', 'kill -9 -1', 'kill 0', 'wmic process where name="node.exe" delete',
    'echo x; taskkill /im claude.exe', 'powershell -c "Stop-Process -Name node"', 'cmd /c taskkill /IM node.exe', 'npm stop && pkill node',
    'x=$(pkill -f vite)', '  Get-Process node |  Stop-Process -Force'];
  const allow = ['taskkill //F //PID 1234', 'taskkill /PID 99 /T /F', 'Stop-Process -Id 4321 -Force', 'kill 12345', 'kill -9 12345',
    'node scripts/kill-port.mjs 3150', 'git log --oneline', 'echo the word taskkill is fine in prose',
    'git commit -m "docs: never use a broad taskkill /IM here"', "python - <<'EOF'\ns = 'a rule: no taskkill /IM, no pkill'\nEOF"];
  let bad = 0;
  for (const c of deny) if (!refuse(c)) { bad++; console.log(`FAIL  should deny: ${c}`); }
  for (const c of allow) if (refuse(c)) { bad++; console.log(`FAIL  should allow: ${c} (${refuse(c)})`); }
  console.log(bad ? `guard-kill: ${bad} failed` : `guard-kill: ${deny.length} denied, ${allow.length} allowed`);
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--test')) test();
  let raw = '';
  process.stdin.on('data', (d) => { raw += d; });
  process.stdin.on('end', () => {
    let command = '';
    try { command = String(JSON.parse(raw)?.tool_input?.command ?? ''); } catch { return; }
    const why = refuse(command);
    if (!why) return;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Refused: ${why}. Other Claude sessions and their servers share this machine. Kill only what you started: `
          + 'by its PID (taskkill //F //PID <pid>, Stop-Process -Id <pid>), or the owner of a port you opened: node scripts/kill-port.mjs <port>.',
      },
    }));
  });
}
