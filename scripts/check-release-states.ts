// The Release tab's reader-facing words (apps/web/src/components/ledger/train/release): a reader gets words, not enum
// values. STEP_WORD says "PR open" in the stepper; STATUS_WORD (releaseState.ts) is the same promise for every other
// place a release's status is read out, so no JSX in this context prints `rel.status` directly.
//   - STATUS_WORD names every ReleaseStatus (types.ts) and nothing else;
//   - no source line in the context reads a Release's `.status` except through STATUS_WORD[..], RELEASE_STATE[..],
//     a comparison, or a prop hand-off (comments blanked, so a line that only talks about the rule does not satisfy it).
// Run: node scripts/check-release-states.ts   Exit 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { blankComments } from './lib/source.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'apps/web/src/components/ledger/train/release');
let passed = 0, failed = 0;
const expect = (ok: boolean, what: string) => { if (ok) passed++; else { failed++; console.error('FAIL ' + what); } };

const types = blankComments(fs.readFileSync(path.join(ROOT, 'packages/core/src/scan/types.ts'), 'utf8'));
const union = /export type ReleaseStatus\s*=([^;]+);/.exec(types)?.[1] ?? '';
const statuses = [...union.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort();
expect(statuses.length === 6, `ReleaseStatus read from types.ts: ${statuses.join(',') || 'nothing'}`);

const state = blankComments(fs.readFileSync(path.join(DIR, 'releaseState.ts'), 'utf8'));
const table = /export const STATUS_WORD[^=]*=\s*\{([^}]*)\}/.exec(state)?.[1];
expect(table !== undefined, 'releaseState.ts exports STATUS_WORD');
const keys = [...(table ?? '').matchAll(/(?:^|[,{\s])'?([a-z-]+)'?\s*:/g)].map((m) => m[1]).sort();
expect(keys.join() === statuses.join(), `STATUS_WORD keys [${keys.join(',')}] are exactly the ReleaseStatus values [${statuses.join(',')}]`);

const READ = /\b(?:rel|r|m\.rel)\??\.status\b/g;
for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.tsx')).sort()) {
  const src = blankComments(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const m of src.matchAll(READ)) {
    const before = src.slice(Math.max(0, m.index - 16), m.index), after = src.slice(m.index + m[0].length, m.index + m[0].length + 8);
    const line = src.slice(0, m.index).split('\n').length;
    const ok = /(?:STATUS_WORD|RELEASE_STATE)\[\s*$/.test(before) || /^\s*[!=]==/.test(after) || /status=\{\s*$/.test(before);
    expect(ok, `${f}:${line}: ${m[0]} is read raw - say it through STATUS_WORD[..]`);
  }
}

// The stepper's elapsed line: read once per render, and ticking while a job is active.
{
  const st = blankComments(fs.readFileSync(path.join(DIR, 'Stepper.tsx'), 'utf8'));
  expect((st.match(/\belapsed\(/g) ?? []).length === 1, 'Stepper.tsx calls elapsed() once per render (it printed a second clock reading)');
  expect(/setInterval\(.*,\s*1000\)/.test(st) && /clearInterval\(/.test(st), 'Stepper.tsx ticks every second and clears the interval');
  expect(/if\s*\(!on\)\s*return;/.test(st) && /\[on\]\)/.test(st), 'Stepper.tsx ticks only while the job is active (effect gated on the flag)');
  expect(/useNow\(running\)/.test(st), 'Stepper.tsx drives the tick from isActive(last)');
}

// The version suggestion's three outcomes are each recoverable: a retry that re-runs the request, and a deadline.
{
  const vb = blankComments(fs.readFileSync(path.join(DIR, 'VersionBox.tsx'), 'utf8'));
  expect(/\[ctx,\s*key,\s*round\]/.test(vb) && /setRound\(/.test(vb), 'VersionBox.tsx: the suggestion effect re-runs on a retry round, not only on ctx/key');
  expect(/setTimeout\([\s\S]*?\},\s*SUGGEST_DEADLINE_MS\)/.test(vb) && (vb.match(/clearTimeout\(late\)/g) ?? []).length >= 3, 'VersionBox.tsx: a pending suggestion has a deadline, cleared on settle and on cleanup');
  expect(/sug\.err\b[^\n]*onClick=\{sug\.retry\}/.test(vb), 'VersionBox.tsx: the refusal line offers a retry');
}

// The sample toggles show the sim's switches, not a copy of them: read through the sim's subscription.
{
  const sw = blankComments(fs.readFileSync(path.join(DIR, 'SampleToggles.tsx'), 'utf8'));
  expect(/useSyncExternalStore\(\s*sim\.subscribe\s*,\s*\(\)\s*=>\s*sim\.trainToggles/.test(sw), 'SampleToggles.tsx reads trainToggles through sim.subscribe');
  expect(!/useState\b/.test(sw), 'SampleToggles.tsx keeps no React copy of the sim\'s switches');
}

console.log(`release-states: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
