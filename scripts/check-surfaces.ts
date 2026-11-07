// check:surfaces - one surface stack (apps/web/src/engine/surfaces.ts): the plan's dismissable surfaces (scan menu,
// morning card, timeline panel, rail flyout, the ledger page, feature page, decision card, track record, "What is going
// on?", preview, selection, blast, readiness, legend key, compare) are declared ONCE, top first. Esc closes the top one
// (escTarget), the Callout paints its seat's occupant (calloutSeat), and an opener closes what shares its seat
// (openPatch). Before this list the order was written three times (Engine.goUp's `if (S.x)` ladder, the Callout's
// if/else chain, the harness's named rungs) and the exclusions ten times; they disagreed: with a selection's "What is
// going on?" open, a click on a track chip painted the track record over it and the first Esc cleared the hidden info.
//
// 1. calloutSeat and escTarget agree on {selection, info, track}: the track (painted) is what Esc closes; the real
//    Engine.goUp closes the track and leaves info.
// 2. Property, every pair of registered surfaces open together: escTarget(S) is what topSurface(S) paints (null behind a
//    barrier), and the real Engine.goUp closes exactly that one and leaves the other open. Pairs that share a seat are
//    not a reachable state (case 3/4), so they are driven through the real openers instead.
// 3. openPatch('track') closes info (one occupant of the callout seat); openPatch('blast') closes the readiness mode
//    (guard: toggleBlast's exclusion). Engine.openTrack and Engine.toggleBlast do it.
// 4. openPatch('dtab') closes the timeline; openPatch('tl') closes the flyout (guard: setTimeline / setDockTab).
// 5. The Esc order is exactly ESC_ORDER below. It differs from the pre-surfaces ladder
//    (menu > tl > morning > whoMenu > dtab > info > [ledger] > open > dec > track > prev > tgt > blast > ga > key > cmpA)
//    in exactly the six pairs in CHANGED, and the old unreachable blast+ga rung is replaced by the openers of case 3.
// 6. On the ledger Esc reaches nothing behind it (guard).
// 7. Source guard: Engine.goUp holds no `if (S.<field>)` ladder, the Callout no `s.track && ... else if (s.info` chain,
//    the openers no hand-written exclusion patch, and the engine harness no hand list of rungs.
// Run: node scripts/check-surfaces.ts   Exit 1 when any expectation fails.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { installEngineDom } from './lib/engine-dom.ts';
import { ALL_CLOSED, openStates } from './lib/surface-states.ts';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_ENGINE_MUTATE || '[]') } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };
const imp = (p: string): Promise<Any> => import(pathToFileURL(path.join(SRC, p)).href);
const impCore = (p: string): Promise<Any> => import(pathToFileURL(path.join(ROOT, 'packages/core', p)).href);

/** The Esc order after the change, top first (case 5). `ledger` is the barrier: Esc stops there. */
const ESC_ORDER = ['menu', 'morning', 'whoMenu', 'tl', 'dtab', 'ledger', 'open', 'dec', 'track', 'info', 'prev', 'tgt', 'blast', 'ga', 'key', 'cmpA'];
/** goUp's hand ladder before the change (Engine.ts at 52808cf3), the ledger stop written as its row. */
const BEFORE = ['menu', 'tl', 'morning', 'whoMenu', 'dtab', 'info', 'ledger', 'open', 'dec', 'track', 'prev', 'tgt', 'blast', 'ga', 'key', 'cmpA'];
/**
 * The pairs whose Esc order changed, each with why (the first named now closes first):
 * - morning|tl, whoMenu|tl: the timeline and the rail flyout share one seat, so their rows sit together; the morning card
 *   (z 40, a centred card) is painted over the timeline panel (z 8), so it now closes first.
 * - ledger|info, open|info, dec|info, track|info: info is a body of the callout seat (z 4) under the ledger (z 20), the
 *   feature page (z 30) and the decision card (z 8), and the track record paints over it; it closed first while hidden.
 */
const CHANGED = ['morning|tl', 'whoMenu|tl', 'ledger|info', 'open|info', 'dec|info', 'track|info'];

let SF: Any = null;
try { SF = await imp('engine/surfaces.ts'); } catch (e) { failures.push('apps/web/src/engine/surfaces.ts does not load (' + String((e as Error).message).split('\n')[0] + ')'); }
const ok = (fn: () => boolean, what: string) => { let r = false; try { r = !!SF && fn(); } catch (e) { what += ' [threw ' + (e as Error).message + ']'; } expect(r, what); };

// ---------------------------------------------------------------------------------------------- the engine under test
const dom = installEngineDom();
const { buildModel } = await impCore('src/model/sample.ts');
const { Engine } = await imp('engine/Engine.ts');
const { getVariant } = await imp('variants/registry.ts');
const M = buildModel(1, () => dom.now(), null);
const E: Any = new Engine({ canvas: dom.canvas, ui: dom.ui, root: dom.root, model: M, expression: getVariant('subtle').expression, intro: false });
if (M.sim.playing) E.togglePlay();
dom.settle();
const F0 = Object.keys(M.P.F)[0];
/** A state that opens each surface (a new SURFACES row with no entry there fails case 2). */
const OPEN = openStates(M);
const DEC0 = OPEN.dec.dec as string, TGT = OPEN.tgt.tgt;
expect(!!DEC0, 'the sample has an open question to open the decision card on');
const reset = (patch: Record<string, unknown> = {}) => { E.store.set({ ...ALL_CLOSED, selMode: false, phone: false, ...patch }); };

// ---------------------------------------------------------------------------------------------- 1. info under a track
{
  const S = { tgt: { n: 2 }, info: true, track: 'T1' };
  ok(() => SF.calloutSeat(S) === 'track', 'case 1: calloutSeat({selection, info, track}) is the track (got ' + (SF && SF.calloutSeat?.(S)) + ')');
  ok(() => SF.escTarget(S) === 'track', 'case 1: escTarget({selection, info, track}) is the track, the surface painted (got ' + (SF && SF.escTarget?.(S)) + ')');
  reset({ tgt: { ids: { [F0]: 1, [Object.keys(M.P.F)[1]]: 1 }, n: 2, label: 'two' }, info: true, track: 'T1' }); E.goUp();
  expect(E.S.track === null && E.S.info === true, 'case 1: Engine.goUp with info under a track closes the track and leaves info (track ' + E.S.track + ', info ' + E.S.info + ')');
}

// ---------------------------------------------------------------------------------------------- 2. every pair
{
  const rows: Any[] = SF?.SURFACES ?? [];
  ok(() => rows.length > 0 && rows.every((r: Any) => OPEN[r.id]), 'case 2: every SURFACES row has an opening state here (missing: ' + rows.filter((r: Any) => !OPEN[r.id]).map((r: Any) => r.id).join(', ') + ')');
  ok(() => Object.keys(OPEN).every((id) => rows.some((r: Any) => r.id === id)), 'case 2: every surface opened here is a SURFACES row');
  let pairs = 0; const bad: string[] = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j];
    if (a.seat === b.seat) continue; // not a reachable state: the openers keep one occupant per seat (cases 3, 4)
    pairs++;
    reset(); const S = { ...E.S, ...OPEN[a.id], ...OPEN[b.id] };
    const open = (r: Any, s: Any) => r.isOpen(s);
    if (!open(a, S) || !open(b, S)) { bad.push(a.id + '+' + b.id + ': not both open'); continue; }
    const top = SF.topSurface(S), want = top && SF.surface(top).barrier ? null : top, t = SF.escTarget(S);
    if (top !== a.id && top !== b.id) bad.push(a.id + '+' + b.id + ': topSurface ' + top);
    if (t !== want) bad.push(a.id + '+' + b.id + ': escTarget ' + t + ', painted ' + top);
    reset({ ...OPEN[a.id], ...OPEN[b.id] }); E.goUp();
    const S2 = E.S;
    if (t === null) { if (!open(a, S2) || !open(b, S2)) bad.push(a.id + '+' + b.id + ': Esc behind the barrier moved something'); }
    else {
      const other = t === a.id ? b : a, tr = t === a.id ? a : b;
      if (open(tr, S2)) bad.push(a.id + '+' + b.id + ': goUp left ' + tr.id + ' open');
      if (!open(other, S2)) bad.push(a.id + '+' + b.id + ': goUp also closed ' + other.id);
    }
  }
  ok(() => pairs >= 100 && bad.length === 0, 'case 2: over ' + pairs + ' pairs, Esc closes the painted surface and only it: ' + bad.length + ' mismatches' + (bad.length ? ' (' + bad.slice(0, 8).join('; ') + ')' : ''));
}

// ---------------------------------------------------------------------------------------------- 3, 4. one occupant per seat
{
  ok(() => SF.openPatch('track', { info: true, tgt: { n: 2 } }).info === false, 'case 3: openPatch(track) over info closes info (one occupant of the callout seat)');
  ok(() => SF.openPatch('blast', { ga: true }).ga === false, 'case 3 (guard): openPatch(blast) over the readiness mode closes it');
  ok(() => SF.openPatch('dtab', { tl: true }).tl === false, 'case 4 (guard): openPatch(dtab) over the timeline closes it');
  ok(() => SF.openPatch('tl', { dtab: 'view' }).dtab === null, 'case 4 (guard): openPatch(tl) over a flyout closes it');
  // the reachable states the old blast+ga rung stood for: the real openers keep one occupant
  reset({ info: true, tgt: TGT }); E.openTrack('T1');
  expect(E.S.track === 'T1' && E.S.info === false, 'case 3: Engine.openTrack over info closes info (info ' + E.S.info + ')');
  reset(OPEN.ga); E.toggleBlast(F0);
  expect(E.S.blast === F0 && E.S.ga === false, 'case 3 (guard): Engine.toggleBlast over the readiness mode turns it off');
  reset({ blast: F0 }); E.toggleGA();
  expect(E.S.ga === true && E.S.blast === null, 'case 3 (guard): Engine.toggleGA over blast clears it');
  reset({ dtab: 'view' }); E.setTimeline(true);
  expect(E.S.tl === true && E.S.dtab === null, 'case 4 (guard): Engine.setTimeline over a flyout closes it');
  reset({ tl: true }); E.setDockTab('view');
  expect(E.S.dtab === 'view' && E.S.tl === false, 'case 4 (guard): Engine.setDockTab over the timeline collapses it');
  reset({ dec: DEC0, morning: true, menu: OPEN.menu.menu }); E.openFeature(F0);
  expect(E.S.open === F0 && E.S.dec === null && E.S.morning === false && E.S.menu === null, 'guard: Engine.openFeature closes the decision card, the morning card and the scan menu');
  reset({ morning: true }); E.openDecision(DEC0, true);
  expect(E.S.dec === DEC0 && E.S.morning === false, 'guard: Engine.openDecision closes the morning card');
}

// ---------------------------------------------------------------------------------------------- 5. the order, fixed
{
  const ids: string[] = (SF?.SURFACES ?? []).map((r: Any) => r.id);
  ok(() => ids.join(' > ') === ESC_ORDER.join(' > '), 'case 5: the Esc order is ' + ESC_ORDER.join(' > ') + ' (got ' + ids.join(' > ') + ')');
  const changed: string[] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    if (BEFORE.indexOf(ids[i]) > BEFORE.indexOf(ids[j])) changed.push(ids[i] + '|' + ids[j]);
  }
  ok(() => changed.sort().join(' ') === [...CHANGED].sort().join(' '), 'case 5: exactly these pairs changed order: ' + CHANGED.join(', ') + ' (got ' + changed.join(', ') + ')');
  // the real goUp walks this order rung by rung: check-engine-harness section 4, over SURFACES
}

// ---------------------------------------------------------------------------------------------- 6. the ledger is a barrier
{
  ok(() => SF.escTarget({ page: 'ledger', key: 'x', open: 'f1' }) === null, 'case 6 (guard): escTarget on the ledger with a key and a feature behind it is null');
  reset({ page: 'ledger', key: 'x', open: F0 }); E.goUp();
  expect(E.S.page === 'ledger' && E.S.key === 'x' && E.S.open === F0, 'case 6 (guard): Engine.goUp on the ledger moves nothing behind it');
}

// ---------------------------------------------------------------------------------------------- 7. source guard
{
  const eng = fs.readFileSync(path.join(SRC, 'engine/Engine.ts'), 'utf8');
  const ov = fs.readFileSync(path.join(SRC, 'components/Overlays.tsx'), 'utf8');
  const hdr = fs.readFileSync(path.join(SRC, 'components/Header.tsx'), 'utf8');
  const har = fs.readFileSync(path.join(ROOT, 'scripts/check-engine-harness.ts'), 'utf8');
  const goUp = eng.slice(eng.indexOf('\n  goUp() {'), eng.indexOf('\n  walk(dir'));
  expect(goUp.length > 20 && !/if \(S\.\w+/.test(goUp), 'case 7: Engine.goUp holds no `if (S.<field>)` ladder');
  const co = ov.slice(ov.indexOf('export function Callout()'), ov.indexOf('// ------', ov.indexOf('export function Callout()')));
  expect(co.length > 20 && !/s\.track\s*&&/.test(co) && !/else if \(s\.info/.test(co) && /calloutSeat\(/.test(co), 'case 7: the Callout switches on calloutSeat, with no `s.track && ... else if (s.info` chain');
  const hand = ['{ tl: on, dtab: null }', '{ dtab, tl: false }', '{ ...m, info: false }', "dtab: 'swarm', tl: false", 'dec: null, hover: null, morning: false, menu: null', 'hover: null, morning: false, hlOpt: null', 'blast: t, ga: false', 'ga: !this.S.ga, blast: null'];
  const left = hand.filter((h) => eng.includes(h));
  expect(left.length === 0, 'case 7: no opener in Engine.ts writes its exclusion by hand (left: ' + left.join(' | ') + ')');
  expect(!hdr.includes('E.patch({ dtab: null, tl: false })'), 'case 7: Header goPage closes what the ledger covers through openPatch');
  expect(!/\brung\('/.test(har), 'case 7: check-engine-harness holds no hand-named list of Esc rungs (it reads SURFACES)');
}

E.destroy();
if (failures.length) { console.error('check:surfaces FAILED (' + failures.length + '):\n  - ' + failures.join('\n  - ')); process.exit(1); }
console.log('check:surfaces: ' + held + ' expectations held');
process.exit(0);
