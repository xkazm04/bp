// Pins the one seat of a pending steer preview (apps/web/src/lib/model/preview-seat.ts: previewSeat). A preview
// (Engine.preview / previewLive) is a consent gate - NOT ISSUED YET, then Commit - and Enter commits it whenever focus
// is off a control, so it must always be on screen: on the selection bar, or in the open Agents / Orders / Steer
// panel (the row that owns it, else the Workbench's own pending bar). The bar steps aside exactly when the panel holds
// it. Cases:
//   (1) a preset preview (pause, order O-7) with Steer open -> the 'research' preset row;
//   (2) a push over the selection with Steer open -> the 'here' row;
//   (3) an order draft with Orders open -> the 'write' row, never the breached order Orders defaults to;
//   (4) a preview no row of the open panel owns (push under Orders, a preset under Agents) -> the panel, row undefined
//       (the Workbench's pending bar);
//   (5) a live steer with Agents open and no selection -> the Agents overview (row null);
//   (6) GUARD (today's behaviour): any other tab, or the rail hidden -> the selection bar; no preview -> 'none';
//   (7) the exhaustive sweep: every PreviewKind x {order, none} x lprev x DockTab x hidden - never 'none' with a
//       preview, and selbarStepsAside equals surface === 'panel';
//   (8) check:rail-keys' seat rule goes red on a seeded per-panel predicate (BP_RAIL_MUTATE re-adds agents.tsx's
//       `(s.prev && !s.prev.order) || s.lprev`).
// Run: node scripts/check-preview-seat.ts  (Node's type stripping; scripts/overlays-loader.mjs maps the @/ alias).
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: [] } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const mod: Any = await import(pathToFileURL(path.join(SRC, 'lib/model/preview-seat.ts')).href).catch(() => ({}));
const call = (name: string, a: Any): Any => { try { return typeof mod[name] === 'function' ? mod[name](a) : { missing: name }; } catch (e) { return { threw: (e as Error).message }; } };
const seat = (a: Any) => call('previewSeat', { prev: null, lprev: null, dtab: null, hidden: false, tgtN: 0, ...a });

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };
const J = (x: unknown) => JSON.stringify(x, (_k, v) => v === undefined ? '<undefined>' : v);
const is = (got: Any, want: Any, what: string) => {
  const ok = !!got && got.surface === want.surface && ('row' in want ? got.row === want.row : true);
  expect(ok, `${what}: got ${J(got)}, expected ${J(want)}`);
};

// 1-3: the panel's owning row
is(seat({ prev: { kind: 'pause', order: 'O-7' }, dtab: 'steer', tgtN: 0 }), { surface: 'panel', row: 'research' }, '(1) a pause preset (O-7) under Steer');
is(seat({ prev: { kind: 'push', order: 'O-4' }, dtab: 'steer', tgtN: 0 }), { surface: 'panel', row: 'ga' }, '(1) a push preset (O-4) under Steer');
is(seat({ prev: { kind: 'push' }, dtab: 'steer', tgtN: 3 }), { surface: 'panel', row: 'here' }, '(2) a push over the selection under Steer');
is(seat({ prev: { kind: 'order', tpl: 'hold' }, dtab: 'orders', tgtN: 2 }), { surface: 'panel', row: 'write' }, '(3) an order draft under Orders');

// 4: no row owns it -> the Workbench's pending bar
is(seat({ prev: { kind: 'push' }, dtab: 'orders', tgtN: 2 }), { surface: 'panel', row: undefined }, '(4) a push under Orders');
is(seat({ prev: { kind: 'pause', order: 'O-7' }, dtab: 'swarm', tgtN: 0 }), { surface: 'panel', row: undefined }, '(4) a preset under Agents');

// 5: the Agents overview holds a live steer without a selection
is(seat({ lprev: { verb: 'build' }, dtab: 'swarm', tgtN: 0 }), { surface: 'panel', row: null }, '(5) a live build under Agents, no selection');

// 6 GUARD: the selection bar keeps every other case; no preview has no seat
const TABS = [null, 'asks', 'swarm', 'orders', 'plan', 'find', 'view', 'steer'];
for (const dtab of [null, 'find', 'asks', 'plan', 'view']) is(seat({ prev: { kind: 'push' }, dtab, tgtN: 1 }), { surface: 'selbar' }, `(6) a push with dtab ${dtab}`);
for (const dtab of ['swarm', 'steer', 'orders']) is(seat({ prev: { kind: 'push' }, dtab, hidden: true, tgtN: 1 }), { surface: 'selbar' }, `(6) a push with ${dtab} open but the rail hidden`);
for (const dtab of TABS) is(seat({ dtab }), { surface: 'none' }, `(6) no preview with dtab ${dtab}`);

// 7: the sweep
{
  const kinds = ['push', 'pause', 'resume', 'order', 'answer'];
  let n = 0, none = 0, parity = 0;
  const previews: Any[] = [null];
  for (const kind of kinds) for (const order of [undefined, 'O-7']) previews.push({ kind, ...(order ? { order } : {}) });
  for (const prev of previews) for (const lprev of [null, { verb: 'measure' }]) for (const dtab of TABS) for (const hidden of [false, true]) for (const tgtN of [0, 2]) {
    if (prev && lprev) continue;   // the engine never sets both (Engine.preview / previewLive clear the other)
    n++;
    const s = seat({ prev, lprev, dtab, hidden, tgtN });
    if ((prev || lprev) && (!s || !['selbar', 'panel'].includes(s.surface))) none++;
    const aside = call('selbarStepsAside', { prev, lprev, dtab, hidden, tgtN });
    if ((prev || lprev) && aside !== (s?.surface === 'panel')) parity++;
  }
  expect(n === 384, `(7) the sweep ran ${n} combinations, expected 384 - the matcher has stopped biting`);
  expect(none === 0, `(7) ${none} combinations with a pending preview have no visible seat`);
  expect(parity === 0, `(7) ${parity} combinations where the selection bar steps aside but the panel does not hold the preview (or the reverse)`);
}

// 8: the source rule in check:rail-keys bites on a seeded per-panel predicate
{
  const keys = path.join(SRC, 'components/rail/check-keys.ts');
  const clean = spawnSync(process.execPath, [keys], { encoding: 'utf8', env: { ...process.env, BP_RAIL_MUTATE: '[]' } });
  expect(clean.status === 0 && /preview seat/.test(clean.stdout), `(8) check:rail-keys is not green with a preview-seat rule on the clean tree: ${(clean.stderr || clean.stdout).trim().split('\n').slice(0, 4).join(' | ')}`);
  const seeded = spawnSync(process.execPath, [keys], { encoding: 'utf8', env: { ...process.env, BP_RAIL_MUTATE: JSON.stringify([['agents.tsx', 'seatHere(seat, null)', '(s.prev && !s.prev.order) || s.lprev']]) } });
  expect(seeded.status === 1 && /agents\.tsx[^\n]*seat/.test(seeded.stderr), `(8) check:rail-keys stays green with agents.tsx deciding the preview's seat itself (exit ${seeded.status})`);
}

if (failures.length) { console.error(`check-preview-seat: ${failures.length} failed (${held} held)`); for (const f of failures) console.error('  ' + f); process.exit(1); }
console.log(`check-preview-seat: ${held} expectations held`);
