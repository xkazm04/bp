// The Backlog bench's rules (apps/web/src/components/ledger/backlog/bench-rules.ts), held against the store's own steps
// (packages/core/src/scan/waves.ts createIn, patchIn, removeIn; what a live product and the Kettle sim both apply):
//   1. a move between drafts, in either order, is never refused as taken;
//   2. drafts that swap findings: part of them, ALL of them (nothing left to patch to), and a three-way cycle;
//   3. a deleted draft whose finding moved to another; a package left empty is not written;
//   4. a seeded sweep of random transitions: every plan applies without a refusal and ends on exactly the target;
//   5. a draft the copy never knew joins it, one deleted here stays deleted however late the list;
//   6. an undo takes back this bench's waves and restores a deleted one, and NEVER drops a draft from elsewhere, the one way an
//      undo could delete another's work;
//   7. placing: a move empties and removes a package and a wave, one left empty on purpose stays, a target the move itself emptied
//      comes back, a full wave keeps its package count.
// Run: node scripts/check-wave-bench.ts   (Node's type stripping; scripts/overlays-loader.mjs resolves the src). Exit 1 on any failure.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: [] } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const S = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/scan/waves.ts')).href) as Any;
const R = await import(pathToFileURL(path.join(SRC, 'components/ledger/backlog/bench-rules.ts')).href) as Any;

let passed = 0;
const failures: string[] = [];
const ok = (c: boolean, what: string) => { if (c) passed++; else failures.push(what); };

const pk = (name: string, ids: string[], id = 'pk-' + name) => ({ id, name, model: 'opus', effort: 'high', ids });
const wave = (id: string, ...packages: Any[]) => ({ id, name: 'W ' + id, status: 'draft', created_at: '2026-11-07T10:00:00.000Z', packages });
const one = (id: string, ids: string[]) => wave(id, pk('P', ids));

/** Apply a plan with the store's own steps. Returns what the store ended holding, or the refusal. */
function apply(start: Any[], plan: Any[]): { waves: Any[] } | { refused: string } {
  let waves: Any[] = start.map((w) => ({ ...w, packages: S.withPackageIds(w.packages) }));
  let n = 0;
  for (const w of plan) {
    const r = w.kind === 'remove' ? S.removeIn(waves, w.id) : w.kind === 'patch' ? S.patchIn(waves, w.id, w.body) : S.createIn(waves, w.body, '2026-11-07T10:00:00.000Z', 'w-new-' + ++n);
    if (!r.ok) return { refused: w.kind + ' ' + w.id + ': ' + r.error };
    waves = r.waves;
  }
  return { waves };
}
/** What a wave says, whatever id the store gave it. */
const content = (ws: Any[]) => ws.filter(R.hasIds).map((w: Any) => R.sig(w)).sort().join('\n');
function reaches(what: string, from: Any[], to: Any[]) {
  const out = apply(from, R.planWrites(from, to));
  if ('refused' in out) { ok(false, what + ': refused, ' + out.refused); return; }
  ok(content(out.waves) === content(to), what + ': ended on\n' + content(out.waves) + '\n  not\n' + content(to));
}

// ------------------------------------------------------------------------------------------- 1. moves
reaches('a finding moved A -> B', [one('a', ['1', '2']), one('b', ['3'])], [one('a', ['1']), one('b', ['3', '2'])]);
reaches('a finding moved B -> A', [one('a', ['1']), one('b', ['2', '3'])], [one('a', ['1', '3']), one('b', ['2'])]);
reaches('a new wave takes a finding from a draft', [one('a', ['1', '2'])], [one('a', ['1']), one('tmp-x', ['2'])]);
ok(R.planWrites([one('a', ['1'])], [one('a', ['1'])]).length === 0, 'nothing changed: no write');

// ------------------------------------------------------------------------------------------- 2. swaps
reaches('a partial swap', [one('a', ['1', '2']), one('b', ['3', '4'])], [one('a', ['1', '4']), one('b', ['3', '2'])]);
reaches('two drafts swap their ONLY findings', [one('a', ['1']), one('b', ['2'])], [one('a', ['2']), one('b', ['1'])]);
reaches('a three-way cycle of whole drafts', [one('a', ['1']), one('b', ['2']), one('c', ['3'])], [one('a', ['2']), one('b', ['3']), one('c', ['1'])]);
reaches('a swap beside a rename', [{ ...one('a', ['1']), name: 'old' }, one('b', ['2'])], [{ ...one('a', ['2']), name: 'new' }, one('b', ['1'])]);

// ------------------------------------------------------------------------------------------- 3. deletes and empties
reaches('a draft deleted, its finding moved on', [one('a', ['1']), one('b', ['2'])], [one('b', ['2', '1'])]);
reaches('every draft deleted', [one('a', ['1']), one('b', ['2'])], []);
{
  const to = [wave('a', pk('full', ['1']), pk('empty', []))];
  reaches('a package left empty is not the store\'s', [one('a', ['1'])], to);
  const writes = R.planWrites([], to);
  ok(writes.length === 1 && S.checkWaveBody(writes[0].body).ok, 'a new wave with an empty package still passes the store\'s check');
}

// ------------------------------------------------------------------------------------------- 4. the sweep
{
  let seed = 20261107;
  const rnd = (n: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
  const ids = Array.from({ length: 12 }, (_, i) => 'f' + i);
  const shape = (names: string[]) => {
    const ws = new Map<string, string[][]>(names.map((n) => [n, [[], []]]));
    for (const id of ids) { if (rnd(4) === 0) continue; const w = ws.get(names[rnd(names.length)])!; w[rnd(2)].push(id); }
    return [...ws].map(([n, [a, b]]) => wave(n, ...(a.length ? [pk('A', a)] : []), ...(b.length ? [pk('B', b)] : []))).filter((w) => w.packages.length);
  };
  let bad = 0, first = '';
  const N = 500;
  for (let i = 0; i < N; i++) {
    const from = shape(['a', 'b', 'c', 'd']), to = shape(['b', 'c', 'd', 'e']);
    const out = apply(from, R.planWrites(from, to));
    const miss = 'refused' in out ? out.refused : content(out.waves) === content(to) ? '' : 'ended elsewhere';
    if (miss) { bad++; first ||= miss + ' from ' + JSON.stringify(from) + ' to ' + JSON.stringify(to); }
  }
  ok(bad === 0, bad + ' of ' + N + ' random transitions failed; first: ' + first);
}

// ------------------------------------------------------------------------------------------- 5. drafts from elsewhere
{
  const mine = [one('a', ['1'])], late = one('z', ['9']), sent = { ...one('s', ['8']), status: 'dispatched' };
  ok(R.foreignDrafts(mine, [one('a', ['1']), late, sent], new Set()).map((w: Any) => w.id).join() === 'z', 'a draft never known joins; a known one and a dispatched one do not');
  ok(R.foreignDrafts([], [late], new Set()).length === 1, 'an empty copy (the list had not answered) still takes the draft in: "not loaded" is not "none"');
  ok(R.foreignDrafts(mine, [late], new Set(['z'])).length === 0, 'a draft deleted here stays deleted, however late the list');
}

// ------------------------------------------------------------------------------------------- 6. undo
{
  const before = [one('a', ['1'])], known = new Set(['a']);
  const foreign = one('z', ['9']), made = one('w-mine', ['2']);
  const back = R.undoTo(before, known, [one('a', ['1']), made, foreign], new Map(), new Set(['w-mine']));
  ok(back.some((w: Any) => w.id === 'z'), 'an undo keeps a draft from elsewhere');
  ok(!back.some((w: Any) => w.id === 'w-mine'), 'an undo takes back the wave this bench made');
  const plan = R.planWrites([one('a', ['1']), made, foreign], back);
  ok(!plan.some((w: Any) => w.kind === 'remove' && w.id === 'z'), 'and the drain sends no delete for the foreign draft');
  const aliased = R.undoTo([one('tmp-1', ['1'])], new Set(['tmp-1']), [one('w-real', ['1', '2'])], new Map([['tmp-1', 'w-real']]), new Set(['tmp-1', 'w-real']));
  ok(aliased.length === 1 && aliased[0].id === 'w-real' && aliased[0].packages[0].ids.join() === '1', 'a snapshot of a wave the store has since named comes back under the store\'s id');
  const restored = R.undoTo([one('a', ['1']), one('d', ['2'])], new Set(['a', 'd']), [one('a', ['1'])], new Map(), new Set());
  ok(restored.some((w: Any) => w.id === 'd'), 'an undo of a delete brings the wave back');
  reaches('and the store takes it again', [one('a', ['1'])], restored);
}

// ------------------------------------------------------------------------------------------- 7. placing
{
  const at = '2026-11-07T10:00:00.000Z';
  const a = wave('a', pk('X', ['1']), pk('Y', ['2'])), b = one('b', ['3']);
  let p = R.placeIn([a, b], ['1'], { wave: 'b' }, [], 2, at);
  ok(p.next.find((w: Any) => w.id === 'a').packages.length === 1, 'a move removes the package it empties');
  ok(p.next.find((w: Any) => w.id === 'b').packages[0].ids.join() === '3,1', 'the finding lands in the target');
  p = R.placeIn([one('a', ['1']), b], ['1'], { wave: 'b' }, [], 2, at);
  ok(!p.next.some((w: Any) => w.id === 'a'), 'a move removes the wave it empties');
  p = R.placeIn([wave('a', pk('X', ['1']), pk('E', []))], ['2'], { wave: 'a' }, [], 1, at);
  ok(p.next[0].packages.some((q: Any) => q.name === 'E' && !q.ids.length), 'a package left empty on purpose stays');
  p = R.placeIn([one('a', ['1'])], ['1'], { wave: 'a' }, [], 1, at);
  ok(p.next.length === 1 && p.next[0].id === 'a' && p.next[0].packages[0].ids.join() === '1', 'a target the move itself emptied comes back');
  p = R.placeIn([one('a', ['1'])], ['1'], { wave: null }, [], 1, at);
  ok(p.next.length === 0, 'out of its wave');
  p = R.placeIn([one('a', ['1'])], ['2'], { wave: 'new' }, ['Wave 2'], 1, at);
  ok(p.made && p.next.at(-1).name === 'Wave 3' && p.where === 'Wave 3', 'a new wave takes a free name (' + (p.next.at(-1)?.name) + ')');
  ok(R.placeIn([one('a', ['1'])], ['2'], { wave: 'gone' }, [], 1, at) === null, 'no such wave: nothing is placed');
  const full = wave('a', ...Array.from({ length: S.MAX_PACKAGES }, (_, i) => pk('P' + i, ['x' + i])));
  p = R.placeIn([full], ['n'], { wave: 'a', pkg: 'new' }, [], 1, at);
  ok(p.next[0].packages.length === S.MAX_PACKAGES && S.checkWaveBody(R.bodyOf(p.next[0])).ok, 'a full wave keeps within the store\'s package limit');
}

for (const f of failures) console.log('FAIL ' + f);
console.log('check-wave-bench: ' + passed + ' held, ' + failures.length + ' failed');
process.exit(failures.length ? 1 : 0);
