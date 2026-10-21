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
import { readStripped, stripBlock } from './lib/source.ts';
import fs from 'node:fs';

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
const { Legend } = await imp('components/Legend.tsx');

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
    lensIds: Object.keys(P.LENS),
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

// 10-11. The General legend's caption is prose, not a key row: `.lg div` is a flex box, so without a block
// override the caption's two text runs and its <code> lay out as three narrow side-by-side columns (what
// shaped works around with .shp-cap). The class and the rule that carries it must both exist.
const lg = render(() => React.createElement(Legend, { view: 'general' }), {}, () => ({ parts: [] }));
expect(lg.threw === null && /class="lg-cap"/.test(lg.html), `the General legend caption lost its .lg-cap class (${lg.threw ?? 'rendered'})`);
const bpcss = stripBlock(fs.readFileSync(path.join(SRC, 'components/blueprint.css'), 'utf8'));
const capRule = /\.lg\s+\.lg-cap\s*\{([^}]*)\}/.exec(bpcss);
expect(!!capRule && /display\s*:\s*block/.test(capRule[1]), 'blueprint.css: .lg .lg-cap does not set display: block, so the caption lays out as flex columns');

// 12-14. Phone touch targets: the theme toggle, the "whose desk" chips and the feature rows are tapped with a
// thumb, so each declares at least 44 px (the Back button above is the fourth). Read from the CSS, comments stripped.
const minPx = (sel: string) => {
  const m = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(bpcss);
  if (!m) return { sel, px: NaN, found: false };
  const h = /(?:^|[;\s])(?:min-height|height)\s*:\s*(\d+)px/.exec(m[1]);
  return { sel, px: h ? Number(h[1]) : NaN, found: true };
};
for (const sel of ['.bp-phone .theme-toggle', '.ph-who button', '.ph-dom button']) {
  const r = minPx(sel);
  expect(r.found && r.px >= 44, `blueprint.css ${sel}: touch target ${r.found ? (Number.isNaN(r.px) ? 'unset' : r.px + 'px') : 'rule not found'}, expected at least 44px`);
}

// 15-16. WCAG 2.5.3 label in name: a control whose visible text is a key cap ("Esc") must carry that text in
// its accessible name, or voice control cannot address what the reader can see. Source-scanned with comments
// stripped, so a comment about the rule cannot stand in for it.
for (const f of ['components/Overlays.tsx', 'components/Dock.tsx']) {
  const src = readStripped(path.join(SRC, f));
  // scan backwards from the visible text to its own <button: an attribute list holds arrows (=>), so no
  // character class over '>' can delimit the tag
  const bad: string[] = [];
  let seen = 0;
  for (const m of src.matchAll(/>\s*Esc\s*</g)) {
    const i = src.lastIndexOf('<button', m.index);
    if (i < 0) continue;
    seen++;
    const al = /aria-label="([^"]*)"/.exec(src.slice(i, m.index));
    if (al && !/\bEsc\b/.test(al[1])) bad.push(al[1]);
  }
  expect(seen > 0, `${f}: no button with the visible text "Esc" found - the label-in-name scan stopped matching`);
  expect(bad.length === 0, `${f}: ${bad.length} control(s) with the visible text "Esc" whose accessible name omits it (${bad.join('; ')}) - WCAG 2.5.3`);
}

if (failures.length) { console.error(`check-overlays: ${failures.length} failed (${held} held)`); for (const f of failures) console.error('  ' + f); process.exit(1); }
console.log(`check-overlays: ${held} expectations held`);
