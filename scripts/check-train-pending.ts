// The release train's pending bound (apps/web/src/components/ledger/train/Decide.tsx boundPending): a decision the
// store never answers - a call that hangs, or a 200 whose change never arrives because the snapshot stream is down -
// must not hold its item "deciding" for the session. Drives the real module store (useLedger.ts setLedgerUi) with the
// timer injected, so the bound fires at once:
//   - hang / dead stream: the pending item is released at the bound, the toast says the decision may have landed, and a
//     second decision is accepted (the item is no longer in the pending set decide() filters on);
//   - a decision that moved on (re-sent from another status) is left alone; an item already released raises no toast;
//   - the bound is generous (>= 30 s) and decide() really arms it (source, comments blanked).
// Run: node scripts/check-train-pending.ts  (Node's type stripping; scripts/overlays-loader.mjs transpiles the src).
// Exit 1 on any failure.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { blankComments } from './lib/source.ts';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: [] } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const imp = (f: string): Promise<Any> => import(pathToFileURL(path.join(SRC, 'components/ledger', f)).href);
const { setLedgerUi } = await imp('useLedger.ts');
const D = await imp('train/Decide.tsx');

let passed = 0;
const failures: string[] = [];
const ok = (c: boolean, what: string) => { if (c) passed++; else failures.push(what); };

const peek = (): Map<string, string> => { let m = new Map<string, string>(); setLedgerUi((u: Any) => { m = new Map(u.pending); return u; }); return m; };
const put = (xs: [string, string][]) => setLedgerUi((u: Any) => ({ ...u, pending: new Map(xs) }));

ok(typeof D.boundPending === 'function' && typeof D.PENDING_BOUND_MS === 'number', 'Decide.tsx exports boundPending and PENDING_BOUND_MS');
if (typeof D.boundPending === 'function') {
  ok(D.PENDING_BOUND_MS >= 30_000, 'the bound is generous (>= 30 s): too short reopens the double-send');
  const run = (was: [string, string][]) => {
    const toasts: string[][] = [], timers: { f: () => void; ms: number }[] = [];
    D.boundPending(new Map(was), D.PENDING_BOUND_MS, { later: (f: () => void, ms: number) => timers.push({ f, ms }), set: setLedgerUi, toast: (t: string, b: string) => toasts.push([t, b]) });
    return { toasts, timers };
  };

  { // (2) the call hangs, (3) the write landed and the stream is dead: nothing ever changes the status
    put([['p-1', 'done'], ['p-2', 'done']]);
    const r = run([['p-1', 'done'], ['p-2', 'done']]);
    ok(r.timers.length === 1 && r.timers[0].ms === D.PENDING_BOUND_MS, 'one timer at the bound');
    ok(peek().size === 2 && r.toasts.length === 0, 'before the bound: still pending, no toast');
    r.timers[0].f();
    ok(peek().size === 0, 'at the bound the silent items are released (a second A press is accepted)');
    ok(r.toasts.length === 1 && /may still have landed/.test(r.toasts[0][1]) && r.toasts[0][1].includes('p-1') && r.toasts[0][1].includes('p-2'), 'one toast naming both items and that it may have landed');
  }
  { // a later decision on the same item (sent from another status) is not the one that timed out
    put([['p-1', 'accepted'], ['p-3', 'done']]);
    const r = run([['p-1', 'done'], ['p-3', 'done']]);
    r.timers[0].f();
    const m = peek();
    ok(m.get('p-1') === 'accepted' && !m.has('p-3'), 'a pending that moved on is kept; only the silent one is released');
  }
  { // already released (the stream answered): the bound fires on nothing and says nothing
    put([]);
    const r = run([['p-1', 'done']]);
    r.timers[0].f();
    ok(r.toasts.length === 0 && peek().size === 0, 'an item the stream already answered raises no toast');
  }
}
{ // decide() arms it (comments blanked: the header talks about the bound too)
  const src = blankComments(fs.readFileSync(path.join(SRC, 'components/ledger/train/Decide.tsx'), 'utf8'));
  const decide = src.slice(src.indexOf('const decide = useCallback'));
  ok(/boundPending\(\s*was\s*,\s*PENDING_BOUND_MS/.test(decide), 'decide() arms boundPending(was, PENDING_BOUND_MS, ...)');
}

if (failures.length) { for (const f of failures) console.log('FAIL ' + f); console.log(failures.length + ' failed, ' + passed + ' held'); process.exit(1); }
console.log('train pending bound: ' + passed + ' assertions held');
