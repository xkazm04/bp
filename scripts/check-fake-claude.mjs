// Pins how scripts/fixtures/fake-claude.mjs reads its argv. It stands in for the Claude Code CLI under check:scan-jobs,
// check:live-steer, check:live-tracks and check:waves, so a stand-in that parses arguments differently from the CLI
// makes those checks green about the wrong thing. Two rules, from the file's own header:
//   - the JSON (draft-chat) branch is taken by `--output-format json` READ AS A FLAG, not by the bare word `json`
//     anywhere in argv (a lens or scope named `json` next to `--output-format text` must stay on the text branch);
//   - `--resume` takes a value: a trailing `--resume` (or one followed by another flag) is refused, never answered as
//     the session `undefined`.
// Each row runs the fake as a child, in a throwaway cwd (the text branch writes a scan store there).
// Run: node scripts/check-fake-claude.mjs   (exit 1 on any failure)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAKE = path.join(ROOT, 'scripts/fixtures/fake-claude.mjs');
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-fake-claude-'));
let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } };

// expect: 'json' = the draft-chat JSON reply (with its `resume:` tag), 'text' = the run-writing branch, 'refused' = non-zero exit
const rows = [
  { argv: ['-p', '--output-format', 'json'], expect: 'json', resume: 'none' },
  { argv: ['-p', '--output-format', 'json', '--resume', 'sess-1'], expect: 'json', resume: 'sess-1' },
  { argv: ['-p', '--output-format=json'], expect: 'json', resume: 'none' },
  { argv: ['-p', '--output-format', 'text'], expect: 'text' },
  { argv: ['-p', '--output-format', 'text', '--lens', 'json'], expect: 'text' },
  { argv: ['json'], expect: 'text' },
  { argv: ['-p', '--output-format', 'json', '--resume'], expect: 'refused' },
  { argv: ['-p', '--output-format', 'json', '--resume', '--dangerously-skip-permissions'], expect: 'refused' },
];

let seq = 0;
for (const row of rows) {
  const name = row.argv.join(' ');
  const r = spawnSync(process.execPath, [FAKE, ...row.argv], { cwd, input: 'hello', encoding: 'utf8', timeout: 30000, env: { ...process.env, BP_JOB_ID: 'fake-argv-' + seq++ } });
  const out = r.stdout ?? '';
  if (row.expect === 'refused') {
    check(`${name}: refused with a non-zero exit`, r.status !== 0 && r.status !== null, `exit ${r.status}`);
    check(`${name}: never answers resume:undefined`, !out.includes('resume:undefined'), out);
  } else if (row.expect === 'json') {
    let reply = null;
    try { reply = JSON.parse(out); } catch { /* reported below */ }
    check(`${name}: takes the JSON branch`, reply?.type === 'result', out.slice(0, 80));
    check(`${name}: tags resume:${row.resume}`, !!reply && String(reply.result).includes(`resume:${row.resume}`), String(reply?.result));
  } else {
    check(`${name}: takes the text branch`, r.status === 0 && out.startsWith('argv '), `exit ${r.status} ${out.slice(0, 80)}`);
  }
}

fs.rmSync(cwd, { recursive: true, force: true });
console.log(`\ncheck-fake-claude: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
