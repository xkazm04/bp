#!/usr/bin/env node
// The shared focus's golden file: fixed inputs and the exact answers packages/core/src/session/focus.ts gives for the
// rules a port must follow (readFocusPlace, sameSpot, toApply, levelOf, followingWords, and a run of focusStep moves
// from an empty record with the view after each, history and back / forward included). It is the sync contract outside bp: Personas' follower (or any port
// of focus.ts) runs the same inputs and must produce these bytes (docs/standard/contract-1.md). bp's side is held by
// check:shared-focus, which fails when the committed file is not what focus.ts computes now; check:contract holds its
// hash in packages/schema/contract.json.
//   node scripts/focus-golden.ts           print whether the committed file is current (exit 1 when not)
//   node scripts/focus-golden.ts --write   rewrite packages/schema/golden/shared-focus.json
import fs from 'node:fs';
import path from 'node:path';
import { EMPTY_RECORD, focusStep, followingWords, levelOf, readFocusPlace, sameSpot, toApply, viewOf, type FocusMove, type FocusPlace, type SharedView } from '../packages/core/src/session/focus.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
export const FOCUS_GOLDEN = path.join(ROOT, 'packages/schema/golden/shared-focus.json');

const T0 = Date.parse('2026-10-30T07:00:00.000Z');
const kettle = (kind: 'feature' | 'room' | 'wing' | 'site', id: string, extra: Partial<FocusPlace> = {}): FocusPlace => ({ product: 'kettle', target: { kind, id }, ...extra });

const bodies: [string, unknown][] = [
  ['a room', { product: 'kettle', target: { kind: 'room', id: 'billing' }, level: 'L2' }],
  ['the site, every optional field', { product: 'kettle-web', level: 'L0', hash: '#at=bkg&lens=perf', say: 'Good morning.' }],
  ['an empty hash and say are dropped', { product: 'kettle', hash: '', say: '' }],
  ['unknown keys are dropped', { product: 'kettle', target: { kind: 'feature', id: 'kettle-boil', extra: 1 }, color: 'red' }],
  ['not an object', 'kettle'],
  ['a slug with capitals', { product: 'Kettle' }],
  ['a slug of 64 characters', { product: 'k'.repeat(64) }],
  ['a target of an unknown kind', { product: 'kettle', target: { kind: 'decision', id: 'd1' } }],
  ['a target with an empty id', { product: 'kettle', target: { kind: 'room', id: '' } }],
  ['level L5', { product: 'kettle', level: 'L5' }],
  ['a hash without #', { product: 'kettle', hash: 'at=x' }],
  ['say over 280 characters', { product: 'kettle', say: 'x'.repeat(281) }],
];
const pairs: [string, FocusPlace | undefined, FocusPlace | undefined][] = [
  ['the same room', kettle('room', 'billing'), kettle('room', 'billing')],
  ['the words never make it another place', kettle('room', 'billing', { say: 'one' }), kettle('room', 'billing', { say: 'two' })],
  ['another product', kettle('room', 'billing'), { product: 'kettle-web', target: { kind: 'room', id: 'billing' } }],
  ['another target', kettle('room', 'billing'), kettle('room', 'stock')],
  ['two levels both said', kettle('room', 'billing', { level: 'L2' }), kettle('room', 'billing', { level: 'L3' })],
  ['a level said on one side only', kettle('room', 'billing', { level: 'L2' }), kettle('room', 'billing')],
  ["two bays of a room differ only in the hash's at", kettle('room', 'billing', { hash: '#at=bay-1' }), kettle('room', 'billing', { hash: '#at=bay-2' })],
  ['the same at, other hash keys', kettle('room', 'billing', { hash: '#at=bay-1&lens=perf' }), kettle('room', 'billing', { hash: '#lens=dev&at=bay-1' })],
  ['a hash on one side only', kettle('room', 'billing', { hash: '#at=bay-1' }), kettle('room', 'billing')],
  ['the site against a room', { product: 'kettle' }, kettle('room', 'billing')],
  ['nothing on one side', kettle('room', 'billing'), undefined],
];

// a morning in moves: web publishes, the table follows whoever moves, an echo, a presence move, a second publisher, a
// follow of one reader, back and forward through the history, an unfollow, a forget of the lead
const web = { reader: 'web-1', surface: 'web' as const, label: 'Web' }, vr = { reader: 'vr:table', surface: 'vr' as const, label: 'VR table' }, phone = { reader: 'phone-1', surface: 'phone' as const, label: 'Phone' };
const moves: [string, number, FocusMove][] = [
  ['web says hello', 0, { kind: 'hello', ...web }],
  ['web publishes a room', 1000, { kind: 'publish', ...web, place: kettle('room', 'billing', { level: 'L2', say: 'Billing is where the failures are' }) }],
  ['the table follows whoever moves', 2000, { kind: 'follow', ...vr, of: '*' }],
  ['the table reports where it landed: an echo, no new rev', 3000, { kind: 'publish', ...vr, place: kettle('room', 'billing', { level: 'L2' }) }],
  ['web says the same spot with new words: no new rev, the words are kept', 4000, { kind: 'publish', ...web, place: kettle('room', 'billing', { level: 'L2', say: 'Billing, again' }) }],
  ['following yourself is refused', 5000, { kind: 'follow', ...vr, of: 'vr:table' }],
  ['following a reader nobody knows is refused', 5500, { kind: 'follow', ...phone, of: 'ghost' }],
  ['the phone publishes a feature: rev 2, the phone leads', 6000, { kind: 'publish', ...phone, place: kettle('feature', 'kettle-boil', { say: 'Boil' }) }],
  ['web follows the phone only', 7000, { kind: 'follow', ...web, of: 'phone-1' }],
  ['the table publishes a wing: rev 3', 8000, { kind: 'publish', ...vr, place: kettle('wing', 'ops') }],
  ['the phone steps back: a publish of the feature before (rev 4), the phone leads, the history is unchanged', 8200, { kind: 'back', ...phone }],
  ['back again: the first room (rev 5)', 8400, { kind: 'back', ...phone }],
  ['back at the start of the history is refused', 8500, { kind: 'back', ...phone }],
  ['forward: the feature again (rev 6)', 8600, { kind: 'forward', ...phone }],
  ['a publish after stepping back drops the places ahead (the wing)', 8800, { kind: 'publish', ...phone, place: kettle('room', 'stock') }],
  ['forward at the end of the history is refused', 8900, { kind: 'forward', ...vr }],
  ['web stops following', 9000, { kind: 'unfollow', reader: 'web-1' }],
  ['the lead (the phone) forgets: it stays as the place author, unseen', 10000, { kind: 'forget', reader: 'phone-1' }],
  ['the table says hello 50 s later: it is live, web is gone from live', 60000, { kind: 'hello', ...vr }],
];

/** The golden document, as focus.ts computes it now. */
export function focusGolden(): string {
  const read = bodies.map(([name, body]) => ({ name, body, answer: readFocusPlace(body) }));
  const same = pairs.map(([name, a, b]) => ({ name, a: a ?? null, b: b ?? null, same: sameSpot(a, b) }));
  const levels = [{ product: 'kettle' }, kettle('wing', 'ops'), kettle('room', 'billing'), kettle('feature', 'kettle-boil'), kettle('site', 'kettle'), kettle('feature', 'kettle-boil', { level: 'L3' })]
    .map((place) => ({ place, level: levelOf(place) }));
  let r = EMPTY_RECORD;
  const steps = moves.map(([name, dt, move]) => {
    const s = focusStep(r, move, T0 + dt);
    r = s.record;
    return { name, at: new Date(T0 + dt).toISOString(), move, status: s.status, ...(s.error ? { error: s.error } : {}), moved: s.moved, view: viewOf(r, T0 + dt) };
  });
  const v = (i: number): SharedView => steps[i].view;
  const apply = [
    ['the table, following *, after the first publish', v(1), 'vr:table', '*', 0],
    ['...a rev it already applied', v(2), 'vr:table', '*', 1],
    ['web never applies its own publish', v(1), 'web-1', '*', 0],
    ['a reader that follows nobody', v(1), 'phone-1', undefined, 0],
    ['web following the phone, when the phone leads', v(8), 'web-1', 'phone-1', 1],
    ['web following the phone, when the table leads', v(9), 'web-1', 'phone-1', 2],
    ['the table, following *, after the phone stepped back', v(10), 'vr:table', '*', 3],
    ['before anyone published', v(0), 'vr:table', '*', 0],
  ].map(([name, view, me, follows, applied]) => ({ name, view, me, follows: follows ?? null, appliedRev: applied, place: toApply(view as SharedView, me as string, follows as string | undefined, applied as number) }));
  const words = [
    ['following *, 2 s after the publish', v(2), '*', T0 + 3000],
    ['following *, 12 s after', v(2), '*', T0 + 13000],
    ['following *, 3 min after', v(2), '*', T0 + 181000],
    ['following one reader that is not the lead', v(9), 'phone-1', T0 + 8500],
    ['following *, before anyone published', v(0), '*', T0 + 500],
    ['not following', v(2), undefined, T0 + 3000],
  ].map(([name, view, follows, now]) => ({ name, view, follows: follows ?? null, now: new Date(now as number).toISOString(), words: followingWords(view as SharedView, follows as string | undefined, now as number) }));
  return JSON.stringify({
    note: 'Generated by scripts/focus-golden.ts --write. Inputs and the exact answers packages/core/src/session/focus.ts gives; a port must reproduce them byte for byte. `null` stands for an absent argument.',
    readFocusPlace: read, sameSpot: same, levelOf: levels, focusStep: steps, toApply: apply, followingWords: words,
  }, null, 2) + '\n';
}

if (import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  const now = focusGolden();
  if (process.argv.includes('--write')) { fs.mkdirSync(path.dirname(FOCUS_GOLDEN), { recursive: true }); fs.writeFileSync(FOCUS_GOLDEN, now); console.log('wrote ' + path.relative(ROOT, FOCUS_GOLDEN)); }
  else {
    const same = fs.existsSync(FOCUS_GOLDEN) && fs.readFileSync(FOCUS_GOLDEN, 'utf8').replace(/\r\n/g, '\n') === now;
    console.log(same ? 'shared-focus.json is current' : 'shared-focus.json is stale: node scripts/focus-golden.ts --write');
    process.exit(same ? 0 : 1);
  }
}
