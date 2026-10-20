// Server-renders the overlays that no other gate touches (HoverCard, Morning, Phone) against the real Kettle
// model and a stub engine, and pins what an earlier overlay review fixed by hand: a lens whose aggregate throws
// costs its card line and not the chrome (and logs once), the morning watch reads the model's spend cap and away
// mark instead of copies of them, the phone's headline "live" is the header's live + flagged, and the phone's
// Back button keeps a 44 px touch target. Without this, an overlay regression is caught only in a browser.
// Run: node scripts/check-overlays.ts  (Node's type stripping for this file; scripts/overlays-loader.mjs
// transpiles src/**/*.tsx on the fly). Exit 1 when any expectation fails.
// Control: BP_OVERLAYS_MUTATE='[["Phone.tsx","height: 44","height: 40"]]' rewrites source text as it loads
// ([file suffix, find, replace] literals), so each assertion can be seen red on a seeded defect.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_OVERLAYS_MUTATE || '[]') } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const imp = (p: string): Promise<Any> => import(pathToFileURL(path.join(SRC, p)).href);
const impCore = (p: string): Promise<Any> => import(pathToFileURL(path.join(ROOT, 'packages/core', p)).href);
const req = createRequire(path.join(ROOT, 'package.json'));
const React: Any = req('react'), { renderToString }: Any = req('react-dom/server');
const { lensOf, SPEND_CAP, AWAY_SINCE } = await impCore('src/model/index.ts');
const { buildModel } = await impCore('src/model/sample.ts');
const { initialState } = await imp('engine/state.ts');
const { EngineCtx, VariantCtx } = await imp('components/hooks.ts');
const { getVariant } = await imp('variants/registry.ts');
const O = await imp('components/Overlays.tsx');
const { Phone } = await imp('components/Phone.tsx');

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

const V = getVariant('subtle');
const M = buildModel(1, () => 0, null), P = M.P;
const lensId = Object.keys(P.LENS).find((l) => lensOf(P, l)) as string;
const text = (html: string) => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// a fresh stub engine and state per render, with console.error captured (the card logs a failed aggregate once)
function render(el: () => Any, patch: Record<string, unknown>, lensAgg: () => Any) {
  const S = { ...initialState(1, P.asOf), ready: true, ...patch };
  const errors: string[] = [], origErr = console.error;
  console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ').slice(0, 160)); };
  const E = {
    M, S, U: 1, SAFE: { l: 0, t: 0, r: 1280, b: 800 }, FW: 1280, FH: 800,
    store: { get: () => S, subscribe: () => () => {} },
    setHoverEl() {}, placeHover() {}, dirty() {}, onFrame: () => () => {}, flyToFeature() {},
    placeById: (t: string, id: string) => (t === 'wing' ? M.L.WING[id] : t === 'room' ? M.L.ROOM[id] : null),
    lensAgg, channel: () => null,
  };
  try {
    const html: string = renderToString(React.createElement(VariantCtx.Provider, { value: V }, React.createElement(EngineCtx.Provider, { value: E }, el())));
    return { html, threw: null as string | null, errors };
  } catch (e) {
    return { html: '', threw: (e as Error).message, errors };
  } finally { console.error = origErr; }
}

// 1-2. HoverCard: a throwing lens aggregate renders the card, logs once; a working one shows its line
const wing = M.L.blds[0].wings[0];
const hover = { view: lensId, hover: { type: 'wing', id: wing.id } };
const bad = render(() => React.createElement(O.HoverCard), hover, () => { throw new Error('check-overlays: aggregate threw'); });
expect(bad.threw === null && bad.html.length > 0, `HoverCard threw under a lens whose aggregate throws (${bad.threw})`);
expect(bad.errors.length === 1, `HoverCard logged ${bad.errors.length} errors for one throwing lens aggregate, expected 1`);
const ok = render(() => React.createElement(O.HoverCard), hover, () => ({ parts: ['CHECK lens part'] }));
expect(text(ok.html).includes('CHECK lens part'), 'HoverCard did not show the lens aggregate line it was given');

// 3-4. Morning: the spend line reads SPEND_CAP and the away mark reads AWAY_SINCE
const mo = render(() => React.createElement(O.Morning), { morning: true }, () => ({ parts: [] }));
const mt = text(mo.html);
const cap = (mt.match(/spent today, cap \$ ?([\d,]+)/) || [])[1];
expect(mo.threw === null && cap === SPEND_CAP.toLocaleString('en-US'), `Morning cap reads ${cap ?? 'nothing'} (${mo.threw ?? 'rendered'}), the model's SPEND_CAP is ${SPEND_CAP}`);
const since = [...mt.matchAll(/since (\d\d:\d\d)/g)].map((m) => m[1]);
expect(since.length > 0 && since.every((s) => s === AWAY_SINCE.slice(11, 16)), `Morning away marks ${JSON.stringify(since)}, the model's AWAY_SINCE is ${AWAY_SINCE.slice(11, 16)}`);

// 5-6. Phone: headline live = header live + flagged; the detail's Back keeps a 44 px target
const ph = render(() => React.createElement(Phone), { phone: true, open: P.features[0].id }, () => ({ parts: [] }));
const all = M.agg.countsOf('ALL', P.features, P.asOf, 7);
const live = (ph.html.match(/<b>(\d+)<\/b>live</) || [])[1];
expect(ph.threw === null && Number(live) === all.live + all.flagged, `Phone headline live ${live ?? 'missing'} (${ph.threw ?? 'rendered'}), header live + flagged is ${all.live + all.flagged}`);
const back = (ph.html.match(/<button[^>]*>‹ Back<\/button>/) || [''])[0];
const h = Number((back.match(/height:\s*(\d+)px/) || [])[1]);
expect(h >= 44, `Phone Back button height ${Number.isNaN(h) ? 'unset' : h + 'px'}, expected at least 44px`);

// 7-9. Toast: an undoable toast is not displaced by an informational one (it queues), the queue drains in order,
// a close button and a persistently mounted live region exist (not display:contents)
const tt = (n: number, strong: string, extra: Record<string, unknown> = {}) => ({ n, strong, text: '', ...extra });
let q = O.toastArrive({ cur: null, q: [] }, tt(1, 'Decided', { action: 'undo' }));
q = O.toastArrive(q, tt(2, 'New question', { fid: 'f1' }));
q = O.toastArrive(q, tt(3, 'Viewing as x'));
expect(q.cur.n === 1 && q.q.length === 2, `an undo toast was displaced (cur ${q.cur?.n}, queued ${q.q.length})`);
q = O.toastNext(q);
expect(q.cur.n === 2 && q.q.length === 1, 'the queue did not hand over in arrival order');
expect(O.toastArrive({ cur: tt(5, 'Decided', { action: 'undo' }), q: [] }, tt(6, 'Decided', { action: 'undo' })).cur.n === 6, 'a newer undoable toast did not supersede an older one');
const to = render(() => React.createElement(O.Toast), { toast: tt(7, 'Hello') }, () => ({ parts: [] }));
expect(to.threw === null && /role="status"/.test(to.html) && !/display:\s*contents/.test(to.html), `Toast live region missing or display:contents (${to.threw ?? 'rendered'})`);

if (failures.length) { console.error(`check-overlays: ${failures.length} failed (${held} held)`); for (const f of failures) console.error('  ' + f); process.exit(1); }
console.log(`check-overlays: ${held} expectations held`);
