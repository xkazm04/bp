#!/usr/bin/env node
// A stand-in for the Claude Code CLI, for scripts/check-scan-jobs.ts (BP_CLAUDE_BIN points here; the registry runs a
// .mjs on this Node). It reads its prompt from stdin, prints `argv [...]`, `pid <n>` and `stdin <prompt>`, then acts
// on the prompt text:
//   --lens slow     sleeps until killed (cancel)          --lens wait    sleeps 1.5 s, then succeeds (queue cap)
//   --lens fail     prints `boom: failed on purpose` on stderr, exits 3
//   --lens refuse   prints `lens-scan refused: unknown slug`, exits 0 without a run (a headless refusal)
//   Make the <lens> lens measurable ...   a prepare job: appends `## Probes` to <cwd>/.claude/lens-scan/config.md (a cwd named
//                   *prep-refuse* answers `lens-scan refused: ...`, one named *prep-noop* claims success and writes nothing)
//   --lens mdrefuse the refusal as a markdown reply writes it (`**lens-scan refused: ...**`, more lines after), exits 0
//   --lens absent   answers as a CLI without the skill did (`/lens-scan` isn't installed ... a closing question), exits 0
//   /lens-scan release --id rel-<v> [--finish]   acts on the release as store.mjs would (lens-scan references/release.md):
//                   a cut moves it draft|failed -> building, writes the release-head measure run (note
//                   `bp-job:<BP_JOB_ID> · release rel-<v> at <sha>`), then -> pr-open with a PR url; a version with `-fail`
//                   in it ends failed instead (`lens-scan release failed: gate ...`). --finish moves pr-open -> merged ->
//                   tagged (tag v<v>), its accepted items -> released and every pack left with only settled items
//                   (released, descoped, declined, or a rework whose rebuild is settled) -> closed, with no run. An unknown release: `lens-scan refused: ...`, exit 0.
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

// Flags are read as flags, as the CLI does: `--output-format json` (or `=json`) takes the JSON branch, never the bare word `json`
// (a lens named json beside `--output-format text` stays a run), and `--resume` needs a value or the call is refused.
const flag = (name) => { const i = argv.findIndex((a) => a === name || a.startsWith(name + '=')); if (i < 0) return undefined; return argv[i].includes('=') ? argv[i].slice(name.length + 1) : argv[i + 1]; };
if (flag('--output-format') === 'json') {
  const ri = argv.indexOf('--resume');
  if (ri >= 0 && (argv[ri + 1] === undefined || argv[ri + 1].startsWith('-'))) { console.error("error: option '--resume <session>' argument missing"); process.exit(2); }
  const resume = ri >= 0 ? argv[ri + 1] : 'none';
  const onboard = /^\/lens-scan onboard --draft-only(?: --temporary)?\r?\n/.test(input);
  const temp = /^\/lens-scan onboard --draft-only --temporary\r?\n/.test(input) || input.includes('TEMPORARY');
  const draft = temp ? { ...VALID, id: 'tmp.money-migration' } : VALID;
  const tag = `onboard:${onboard ? 'yes' : 'no'} kind:${temp ? 'temporary' : 'project'} resume:${resume}`;
  let result = `Which features does the migration touch? (${tag})`;
  if (input.includes('DRAFT-VALID')) result = `Here is the lens. (${tag})\n\n\`\`\`lens-manifest\n${JSON.stringify(draft, null, 2)}\n\`\`\`\n`;
  if (input.includes('DRAFT-INVALID')) result = `Here is the lens. (${tag})\n\n\`\`\`lens-manifest\n${JSON.stringify({ ...VALID, id: 'money' })}\n\`\`\``;
  // DRAFT-BIG: a valid JSON answer longer than the route's 4 MiB stdout cap; DRAFT-SLOW: never answers (abort / timeout)
  if (input.includes('DRAFT-BIG')) result = 'x'.repeat(5 << 20);
  if (input.includes('DRAFT-SLOW')) await sleep(120000);
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, session_id: 'abcdef12-3456-7890' }));
  process.exit(0);
}

console.log('argv ' + JSON.stringify(argv));
console.log('pid ' + process.pid);
console.log('stdin ' + input.trim());
if (input.includes('--lens slow')) { await sleep(120000); process.exit(0); }
if (input.includes('--lens fail')) { console.error('working...'); console.error('boom: failed on purpose'); process.exit(3); }
if (input.includes('--lens refuse')) { console.log('lens-scan refused: unknown slug'); process.exit(0); }
if (input.includes('--lens mdrefuse')) {
  console.log('**lens-scan refused: the performance lens has nothing it can measure in this repo.** No run started.\n\n| a | b |\n\nI didn\'t write a run log line.');
  process.exit(0);
}
// a prepare job (jobs.server.ts preparePrompt): writes a `## Probes` section into the repo's overlay; a repo whose directory
// name holds `prep-refuse` refuses instead, and one holding `prep-noop` claims success but writes nothing
const prep = /^Make the (\S+) lens measurable/.exec(input);
if (prep) {
  const base = path.basename(process.cwd());
  if (base.includes('prep-refuse')) { console.log('lens-scan refused: no production build can start here'); process.exit(0); }
  if (base.includes('prep-noop')) { console.log('lens-scan prepared: everything'); process.exit(0); }
  const ov = path.join(process.cwd(), '.claude', 'lens-scan', 'config.md');
  fs.mkdirSync(path.dirname(ov), { recursive: true });
  const was = fs.existsSync(ov) ? fs.readFileSync(ov, 'utf8') : '---\nproject_slug: x\n---\n';
  fs.writeFileSync(ov, was + '\n## Probes\na blockingMs: node scripts/probes/perf.mjs --feature a --metric blockingMs\n');
  console.log('lens-scan prepared: one probe (a blockingMs)');
  process.exit(0);
}
if (input.includes('--lens absent')) {
  console.log("`/lens-scan` isn't installed in this session, so it didn't run and I haven't measured anything.\n\nTwo questions before I start:\n- Should the report go in `tasks/` or in the release log?");
  process.exit(0);
}
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
const rel = /^\/lens-scan release --id (\S+)( --finish)?\s*$/m.exec(input);
if (rel) {
  const [, rid, fin] = rel, at = () => new Date().toISOString();
  const r = db.prepare('SELECT * FROM releases WHERE id = ?').get(rid);
  // each move a compare-and-set on the status read, as store.mjs release-update makes it
  const move = (to, from, extra = {}) => {
    const cols = Object.keys(extra).map((k) => `, ${k} = ?`).join('');
    if (!db.prepare(`UPDATE releases SET status = ?, updated_at = ?${cols} WHERE id = ? AND status = ?`).run(to, at(), ...Object.values(extra), rid, from).changes) throw new Error(`${rid} moved on`);
  };
  if (!r) { console.log(`lens-scan refused: release ${rid} does not exist`); db.close(); process.exit(0); }
  if (fin) {
    if (r.status !== 'pr-open' && r.status !== 'merged') { console.log(`lens-scan refused: ${rid} is ${r.status}`); db.close(); process.exit(0); }
    if (r.status === 'pr-open') move('merged', 'pr-open');
    db.exec('BEGIN IMMEDIATE');
    move('tagged', 'merged', { tag: 'v' + r.version });
    const items = db.prepare("SELECT id, pack_id FROM proposals WHERE release_id = ? AND status = 'accepted'").all(rid);
    db.prepare("UPDATE proposals SET status = 'released', updated_at = ? WHERE release_id = ? AND status = 'accepted'").run(at(), rid);
    // store.mjs closePacks: a rework item counts as settled once its rebuild (attempt_of = it) is, and the packs looked
    // at include those of the items the released ones rebuild
    const row = db.prepare('SELECT id, pack_id, attempt_of FROM proposals WHERE id = ?');
    const kids = db.prepare('SELECT id, status FROM proposals WHERE attempt_of = ?');
    const settled = (p, d = 0) => ['released', 'descoped', 'declined'].includes(p.status) || (p.status === 'rework' && d < 32 && kids.all(p.id).some((c) => settled(c, d + 1)));
    const packsOf = new Set();
    for (const it of items) for (let p = row.get(it.id), i = 0; p && i < 32; i += 1, p = p.attempt_of ? row.get(p.attempt_of) : undefined) if (p.pack_id) packsOf.add(p.pack_id);
    for (const k of packsOf) {
      if (db.prepare('SELECT id, status FROM proposals WHERE pack_id = ?').all(k).every((p) => settled(p))) {
        db.prepare("UPDATE packs SET status = 'closed', updated_at = ? WHERE id = ? AND status IN ('open', 'triaged')").run(at(), k);
      }
    }
    db.exec('COMMIT');
    console.log(`lens-scan release ${rid} tagged v${r.version}`);
  } else {
    if (r.status !== 'draft' && r.status !== 'failed') { console.log(`lens-scan refused: ${rid} is ${r.status}`); db.close(); process.exit(0); }
    move('building', r.status);
    const sha = 'f'.repeat(40);
    db.prepare("INSERT INTO runs (id, started_at, updated_at, ended_at, phase, status, lenses, note) VALUES (?, ?, ?, ?, 'measure', 'done', '[]', ?)")
      .run(id, now, now, now, `bp-job:${process.env.BP_JOB_ID} · release ${rid} at ${sha}`);
    if (r.version.includes('-fail')) {
      move('failed', 'building', { error: 'gate npm test: 1 failing' });
      console.log('lens-scan release failed: gate npm test: 1 failing');
    } else {
      move('pr-open', 'building', { pr_url: `https://github.com/example/prod/pull/${r.version.replace(/\D/g, '')}` });
      console.log(`lens-scan release ${rid} pr-open`);
    }
  }
  db.close();
  process.exit(0);
}
db.prepare("INSERT INTO runs (id, started_at, updated_at, ended_at, phase, status, lenses, note) VALUES (?, ?, ?, ?, ?, 'done', '[]', ?)")
  .run(id, now, now, now, input.includes('execute') ? 'execute' : 'measure', 'bp-job:' + process.env.BP_JOB_ID + ' · fake');
db.close();
console.log('done ' + id);
