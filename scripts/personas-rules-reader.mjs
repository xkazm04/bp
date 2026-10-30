#!/usr/bin/env node
// STAND-IN for Personas' Blueprint rail "Rules" item. This is NOT Personas code, and Personas does not run it. It
// reads a product's standing rules the way docs/concepts/rules-personas-adoption.md proposes Personas would: two
// plain file reads in the lens-scan directory Personas already opens, with no import from packages/, no HTTP and
// no bp server. If it prints the rail, the files alone carry what the rail needs. The contract is
// docs/standard/rules-1.md. Read-only: it writes nothing.
//
//   node scripts/personas-rules-reader.mjs [--dir <product root>] [--now <ISO>]
//
// --dir defaults to .demo/kettle-live under this repo. Reads <dir>/.ai/lens-scan/work/bp-rules.json and
// bp-rules-log.jsonl. Breaches are not printed: they come from scan.db's decided rows, which Personas reads
// separately. Exit 0 with the rail, 1 when bp-rules.json is malformed (with the reason), 2 for bad arguments.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KINDS = ['hold', 'only', 'cap', 'grant'];
const SCOPE_KINDS = ['feature', 'bay', 'room', 'wing', 'all', 'selection'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh'];
const MODELS = ['sonnet', 'opus'];
const TIER_WORD = ['stop-ship', 'urgent', 'normal', 'backlog'];
const LOG_MAX = 2000;

function args(argv) {
  const out = { dir: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.demo', 'kettle-live'), now: Date.now() };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--dir' && v) { out.dir = path.resolve(v); i++; }
    else if (k === '--now' && v && !Number.isNaN(Date.parse(v))) { out.now = Date.parse(v); i++; }
    else { console.error(`usage: node scripts/personas-rules-reader.mjs [--dir <product root>] [--now <ISO>] (bad argument: ${k})`); process.exit(2); }
  }
  return out;
}

const isStr = (x) => typeof x === 'string' && x.length > 0;
const isDate = (x) => isStr(x) && !Number.isNaN(Date.parse(x));
const isStrs = (x) => Array.isArray(x) && x.every((s) => typeof s === 'string');

/** Why this rule breaks rules-1, or null. Checks the Rule interface's required fields and the enums of optional ones. */
function ruleProblem(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'is not an object';
  if (!isStr(r.id) || !/^[OG]-\d{1,6}$/.test(r.id)) return `id ${JSON.stringify(r.id)} is not O-n or G-n`;
  if (!KINDS.includes(r.kind)) return `kind ${JSON.stringify(r.kind)} is not one of ${KINDS.join(', ')}`;
  if ((r.kind === 'grant') !== r.id.startsWith('G-')) return `id ${r.id} does not match kind ${r.kind} (orders are O-n, grants G-n)`;
  for (const k of ['text', 'by']) if (!isStr(r[k])) return `${k} is missing or not a string`;
  if (!isDate(r.at)) return 'at is missing or not a date';
  const s = r.scope;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return 'scope is missing';
  if (!SCOPE_KINDS.includes(s.kind)) return `scope.kind ${JSON.stringify(s.kind)} is not one of ${SCOPE_KINDS.join(', ')}`;
  if (!isStr(s.label)) return 'scope.label is missing';
  if (!isStrs(s.features)) return 'scope.features is not an array of strings';
  if (r.lenses !== undefined && !isStrs(r.lenses)) return 'lenses is not an array of strings';
  if (r.tools !== undefined && !isStrs(r.tools)) return 'tools is not an array of strings';
  if (r.maxEffort !== undefined && !EFFORTS.includes(r.maxEffort)) return `maxEffort ${JSON.stringify(r.maxEffort)} is not one of ${EFFORTS.join(', ')}`;
  if (r.model !== undefined && !MODELS.includes(r.model)) return `model ${JSON.stringify(r.model)} is not one of ${MODELS.join(', ')}`;
  if (r.minTier !== undefined && ![0, 1, 2, 3].includes(r.minTier)) return `minTier ${JSON.stringify(r.minTier)} is not 0..3`;
  for (const k of ['expiresAt', 'revokedAt']) if (r[k] !== undefined && !isDate(r[k])) return `${k} is not a date`;
  return null;
}

/** The rules file, or the reason it is malformed. No file = no rules. */
function readRules(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return { rules: [], absent: true };
    return { error: `cannot read: ${e.message}` };
  }
  let doc;
  try { doc = JSON.parse(text); } catch (e) { return { error: `not JSON: ${e.message.replace(/\s+/g, ' ')}` }; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { error: 'the top level is not an object' };
  if (doc.version !== 1) return { error: `version is ${JSON.stringify(doc.version)}, this reader knows 1` };
  if (!Array.isArray(doc.rules)) return { error: 'no "rules" array' };
  const seen = new Set();
  for (const [i, r] of doc.rules.entries()) {
    const why = ruleProblem(r);
    if (why) return { error: `rules[${i}]${r && isStr(r.id) ? ` (${r.id})` : ''}: ${why}` };
    if (seen.has(r.id)) return { error: `rules[${i}]: id ${r.id} appears twice` };
    seen.add(r.id);
  }
  return { rules: doc.rules };
}

/** The newest LOG_MAX lines of the log, tallied per rule; torn or foreign lines are counted and skipped. */
function readLog(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { tally: {}, lines: 0, skipped: 0, absent: true }; }
  const tally = {};
  let lines = 0, skipped = 0;
  for (const line of text.split('\n').slice(-LOG_MAX - 1)) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { skipped++; continue; }
    if (!e || typeof e.rule !== 'string' || typeof e.at !== 'string' || !Array.isArray(e.ids)) { skipped++; continue; }
    lines++;
    const t = (tally[e.rule] ??= { times: 0, items: 0, refused: 0, last: e.at });
    t.times++; t.items += e.ids.length; if (e.refused === true) t.refused++;
    if (e.at > t.last) t.last = e.at;
  }
  return { tally, lines, skipped };
}

const isLive = (r, now) => !r.revokedAt && (!r.expiresAt || Date.parse(r.expiresAt) > now);
const stamp = (iso) => iso.slice(0, 16).replace('T', ' ');
function timeLeft(r, now) {
  if (!r.expiresAt) return 'until revoked';
  const m = Math.max(0, Math.round((Date.parse(r.expiresAt) - now) / 60000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return (d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`) + ' left';
}
const place = (r) => `${r.scope.label} (${r.scope.kind}${r.scope.kind === 'all' ? '' : `, ${r.scope.features.length} feature${r.scope.features.length === 1 ? '' : 's'}`})`;
function orderTerms(r) {
  if (r.kind === 'only') return `only ${(r.lenses ?? []).join(', ') || 'no lens'}`;
  if (r.kind === 'cap') return `cap ${r.maxEffort ?? '?'}${r.model ? ` on ${r.model}` : ''}`;
  return 'hold';
}
const tierFloor = (r) => (r.minTier === undefined ? 'any tier (stop-ship included)' : `tier ${r.minTier}+ (${TIER_WORD[r.minTier]} or milder)`);

const o = args(process.argv.slice(2));
const work = path.join(o.dir, '.ai', 'lens-scan', 'work');
const rulesPath = path.join(work, 'bp-rules.json'), logPath = path.join(work, 'bp-rules-log.jsonl');
const read = readRules(rulesPath);
console.log('bp standing rules: a stand-in for the Personas Blueprint rail (not Personas code)');
console.log(`product  ${o.dir}`);
if (read.error) {
  console.log(`file     ${rulesPath}`);
  console.error(`malformed bp-rules.json: ${read.error}`);
  process.exit(1);
}
const log = readLog(logPath);
const now = o.now, rules = read.rules;
console.log(`file     ${read.absent ? `${rulesPath} (absent: no rules)` : `${rulesPath} (version 1, ${rules.length} rule${rules.length === 1 ? '' : 's'})`}`);
console.log(`log      ${log.absent ? 'absent (nothing held yet)' : `${log.lines} entr${log.lines === 1 ? 'y' : 'ies'}${log.skipped ? `, ${log.skipped} torn or foreign line${log.skipped === 1 ? '' : 's'} skipped` : ''}`}`);
console.log(`as of    ${new Date(now).toISOString()}`);

const live = rules.filter((r) => isLive(r, now));
const orders = live.filter((r) => r.kind !== 'grant'), grants = live.filter((r) => r.kind === 'grant');
console.log('');
console.log(`ORDERS   ${orders.length} live`);
for (const r of orders) {
  const t = log.tally[r.id];
  const held = t ? `held ${t.items} item${t.items === 1 ? '' : 's'} in ${t.times} act${t.times === 1 ? '' : 's'}${t.refused ? ` (${t.refused} refused)` : ''}, last ${stamp(t.last)}` : 'held nothing yet';
  console.log(`  ${r.id.padEnd(5)} ${orderTerms(r).padEnd(14)} ${place(r)}  ${timeLeft(r, now)}  ${held}`);
  console.log(`        "${r.text}"  set by ${r.by} ${stamp(r.at)}`);
}
console.log(`GRANTS   ${grants.length} live`);
for (const r of grants) {
  console.log(`  ${r.id.padEnd(5)} ${tierFloor(r)}  ${place(r)}  ${timeLeft(r, now)}  tools ${(r.tools ?? ['decision.answer', 'wave.dispatch']).join(', ')}`);
  console.log(`        "${r.text}"  set by ${r.by} ${stamp(r.at)}; its decisions are signed rule:${r.id} in scan.db`);
}
const ended = rules.filter((r) => !isLive(r, now)), revoked = ended.filter((r) => r.revokedAt).length;
console.log(`ENDED    ${ended.length} (${revoked} revoked, ${ended.length - revoked} expired), kept as the record`);
const unknown = Object.keys(log.tally).filter((id) => !rules.some((r) => r.id === id));
if (unknown.length) console.log(`note     the log names rule${unknown.length === 1 ? '' : 's'} not in the file: ${unknown.join(', ')}`);
console.log('breaches are read from scan.db decided rows, not from these files; set, revoke and replay stay in bp');
