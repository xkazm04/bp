// A companion card's summary names every arg the approval will send (DW-107). A GATED tool call becomes a pending card
// (door.server.ts fileCard); the person reads only card.summary (the Glim lamp shows nothing else) before Approve, and the
// approved request carries ALL args (tool-call.ts toolRequest: path params into the path, every other key into the body,
// declared or not). It proves, in process with a temp BP_HOME and no grant (so nothing is fetched):
//   keys      decision.answer with a 2000-char note FIRST still shows decision/approve, id/p-1, the note key and the product
//   extra     a key the schema does not declare (extra zzz-marker) is shown with its value, and decision decline too
//   bounded   a long value is shortened, never the key list: the full note is not in the summary, which stays <= 600 chars
//   order     the same args in one insertion order and its reverse show every key either way
//   policy    policy.propose with a long tools array first still shows hours, minTier and tools
// rule.propose has its own summary path and is not asserted here.
// Run: node scripts/check-companion-card-summary.ts   Exit 1 on any failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = './lib/src-hooks.mjs';
((await import(HOOKS)) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-check-companion-card-summary-'));
process.env.BP_HOME = tmp;
const { fileCard } = await import('../packages/core/src/server/api/companion/door.server.ts');
const { TOOLS } = await import('../packages/core/src/companion/catalog.ts');

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };
const ORIGIN = { origin: 'http://127.0.0.1:1' };

async function summary(tool: string, args: Record<string, unknown>): Promise<string> {
  const r = await fileCard(tool, args, ORIGIN);
  if (!r.ok) { check(`${tool} files a card`, false, r.error); return ''; }
  check(`${tool} files a pending card`, r.card.state === 'pending', r.card.state);
  // The tool's own description says words like "decline": take it out so a value is only found where the args are shown.
  const d = TOOLS.find((t) => t.name === tool)?.description.replace(/\.$/, '') ?? '';
  return d ? r.card.summary.split(d).join('') : r.card.summary;
}
const has = (name: string, s: string, needles: string[]) => {
  for (const n of needles) check(`${name}: summary contains ${JSON.stringify(n)}`, s.includes(n), `summary: ${s.slice(0, 200)}...`);
};

try {
  // keys + bounded: a long note first
  const note = 'n'.repeat(1999) + 'Q';
  const s1 = await summary('decision.answer', { note, slug: 'kettle', id: 'p-1', decision: 'approve' });
  has('keys', s1, ['decision', 'approve', 'id', 'p-1', 'note', 'kettle']);
  check('bounded: the full 2000-char note is not in the summary', !s1.includes(note), `length ${s1.length}`);
  check('bounded: the summary stays <= 600 chars', s1.length <= 600, `length ${s1.length}`);

  // extra: an undeclared key
  const s2 = await summary('decision.answer', { slug: 'kettle', id: 'p-1', note: 'x'.repeat(2000), decision: 'decline', extra: 'zzz-marker' });
  has('extra', s2, ['extra', 'zzz-marker', 'decline', 'kettle']);
  check('extra: the summary stays <= 600 chars', s2.length <= 600, `length ${s2.length}`);

  // order: the same args (the long note in the middle) in one insertion order and its reverse
  const fwd: [string, unknown][] = [['id', 'p-1'], ['note', note], ['decision', 'approve'], ['slug', 'kettle']];
  for (const [label, entries] of [['order (forward)', fwd], ['order (reverse)', [...fwd].reverse()]] as const) {
    const s3 = await summary('decision.answer', Object.fromEntries(entries));
    has(label, s3, ['decision', 'approve', 'id', 'p-1', 'note', 'kettle']);
    check(`${label}: the summary stays <= 600 chars`, s3.length <= 600, `length ${s3.length}`);
  }

  // policy: a long tools array first
  const tools = ['wave.dispatch', 'decision.answer', ...Array.from({ length: 40 }, (_, i) => `some.very.long.tool.name.number.${i}.that.pads`)];
  const s4 = await summary('policy.propose', { tools, hours: 1, product: 'kettle', minTier: 3 });
  has('policy', s4, ['hours', 'minTier', 'tools', 'kettle']);
  check('policy: the summary stays <= 600 chars', s4.length <= 600, `length ${s4.length}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
