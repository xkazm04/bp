#!/usr/bin/env node
// A stand-in for the Claude Code CLI, for scripts/check-scan-jobs.ts (BP_CLAUDE_BIN points here; the registry runs a
// .mjs on this Node). It reads its prompt from stdin, prints `argv [...]`, `pid <n>` and `stdin <prompt>`, then acts
// on the prompt text:
//   --lens slow     sleeps until killed (cancel)          --lens wait    sleeps 1.5 s, then succeeds (queue cap)
//   --lens fail     prints `boom: failed on purpose` on stderr, exits 3
//   --lens refuse   prints `lens-scan refused: unknown slug`, exits 0 without a run (a headless refusal)
//   anything else   writes a run with note `bp-job:<BP_JOB_ID>` into <cwd>/.ai/lens-scan/scan.db, exits 0
// With `--output-format json` it answers like `claude -p --output-format json` running `/lens-scan onboard --draft-only`
// (the lens-draft chat):
//   DRAFT-VALID / DRAFT-INVALID in the prompt -> a reply with a valid / invalid ```lens-manifest block; else a question.
//   The drafted id is the project lens `com.example.money`, or `tmp.money-migration` when the first line carries
//   `--temporary` (a first turn) or the prompt says TEMPORARY (a later turn); the invalid block's id is `money`.
// The reply says `onboard:yes|no` (whether the prompt opened with `/lens-scan onboard --draft-only`),
// `kind:project|temporary` and `resume:<session|none>`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VALID = {
  $schema: 'lens-manifest/1', id: 'com.example.money', version: '1.0.0', name: 'Money migration', short: 'MIG',
  description: 'How much of each feature still uses the old money type.', reader: { role: 'tech lead', density: 'simple' },
  fields: [{ key: 'oldMoneySites', label: 'Old money sites', type: 'integer', headline: true, metric: { better: 'down', method: 'judgement' } }],
  health: { rules: [{ when: { field: 'oldMoneySites', gt: 0 }, health: 'watch', reason: '{oldMoneySites} sites left' }], default: 'good', rollup: { method: 'worst-of' } },
  presentation: { glyph: 'brackets', line: 'comb', measures: 'oldMoneySites', evidence: ['oldMoneySites'] },
  scan: { method: 'judgement', instructions: 'Count the call sites that still use the old Money type; features without money are no impact.' },
};

if (argv.includes('json')) {
  const resume = argv.includes('--resume') ? argv[argv.indexOf('--resume') + 1] : 'none';
  const onboard = /^\/lens-scan onboard --draft-only(?: --temporary)?\r?\n/.test(input);
  const temp = /^\/lens-scan onboard --draft-only --temporary\r?\n/.test(input) || input.includes('TEMPORARY');
  const draft = temp ? { ...VALID, id: 'tmp.money-migration' } : VALID;
  const tag = `onboard:${onboard ? 'yes' : 'no'} kind:${temp ? 'temporary' : 'project'} resume:${resume}`;
  let result = `Which features does the migration touch? (${tag})`;
  if (input.includes('DRAFT-VALID')) result = `Here is the lens. (${tag})\n\n\`\`\`lens-manifest\n${JSON.stringify(draft, null, 2)}\n\`\`\`\n`;
  if (input.includes('DRAFT-INVALID')) result = `Here is the lens. (${tag})\n\n\`\`\`lens-manifest\n${JSON.stringify({ ...VALID, id: 'money' })}\n\`\`\``;
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, session_id: 'abcdef12-3456-7890' }));
  process.exit(0);
}

console.log('argv ' + JSON.stringify(argv));
console.log('pid ' + process.pid);
console.log('stdin ' + input.trim());
if (input.includes('--lens slow')) { await sleep(120000); process.exit(0); }
if (input.includes('--lens fail')) { console.error('working...'); console.error('boom: failed on purpose'); process.exit(3); }
if (input.includes('--lens refuse')) { console.log('lens-scan refused: unknown slug'); process.exit(0); }
if (input.includes('--lens wait')) await sleep(1500);
const dir = path.join(process.cwd(), '.ai', 'lens-scan');
fs.mkdirSync(dir, { recursive: true });
// lens-scan's openStore sequence (store.mjs 1.2.3): the check starts 3 fakes on a new store at once; the WAL switch can
// answer SQLITE_BUSY without the busy handler, and the DDL sets user_version before its tables
const db = new DatabaseSync(path.join(dir, 'scan.db'), { timeout: 5000 });
for (let i = 0; ; i++) {
  try { db.exec('PRAGMA journal_mode = WAL'); break; } catch (e) { if (e.errcode !== 5 || i >= 100) throw e; await sleep(20 + Math.random() * 30); }
}
db.exec('BEGIN IMMEDIATE');
if (db.prepare('PRAGMA user_version').get().user_version === 0) db.exec(fs.readFileSync(path.join(ROOT, 'docs/standard/lens-scan-store.sql'), 'utf8'));
db.exec('COMMIT');
const now = new Date().toISOString(), id = 'run-' + process.env.BP_JOB_ID;
db.prepare("INSERT INTO runs (id, started_at, updated_at, ended_at, phase, status, lenses, note) VALUES (?, ?, ?, ?, ?, 'done', '[]', ?)")
  .run(id, now, now, now, input.includes('execute') ? 'execute' : 'measure', 'bp-job:' + process.env.BP_JOB_ID + ' · fake');
db.close();
console.log('done ' + id);
