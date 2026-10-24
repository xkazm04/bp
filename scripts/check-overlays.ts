// Server-renders the overlays that no other gate touches (HoverCard, Morning, Phone, Toast, Legend) against
// the real Kettle model and a stub engine. Without this, an overlay regression is caught only in a browser.
// Nine subjects, in file order - each section below names its own:
//   HoverCard             a lens whose aggregate throws costs its card line and not the chrome, and logs once
//   Morning               the watch reads the model's SPEND_CAP and AWAY_SINCE, not copies of them
//   Phone headline/detail headline "live" = the header's live + flagged; Back keeps a 44 px target; the
//                         detail is a focusable aria-modal dialog
//   Toast                 an undoable toast is not displaced, the queue drains in order, the live region is
//                         mounted and not display:contents
//   General legend        the caption is prose, not a key row (.lg-cap and the display:block rule that carries it)
//   Phone touch targets   every phone-scoped rule for an interactive element, DERIVED from the CSS and the rendered
//                         controls, declares at least 44 px (a touch-exempt comment opts one out)
//   Marker tokens         no text colour is taken from --red / --mint / --amber (their *-2 siblings are the
//                         text-grade ones; --red reads 4.36:1 on --paper in light theme)
//   Phone reading list    a search never prints a heading with no rows under it
//   WCAG 2.5.3            a control whose visible text is a key cap carries that text in its accessible name
// The count is PRINTED by the run ("N expectations held"), never written out here: the sections used to carry
// hand-kept numbers that said 16 while the file held 25, and two sections carried no number at all.
// Run: node scripts/check-overlays.ts  (Node's type stripping for this file; scripts/overlays-loader.mjs
// transpiles src/**/*.tsx on the fly). Exit 1 when any expectation fails.
// Control: BP_OVERLAYS_MUTATE='[["Phone.tsx","height: 44","height: 40"]]' rewrites source text as it loads
// ([file suffix, find, replace] literals), so each assertion can be seen red on a seeded defect.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import { blankBlock, readBlanked, readStripped, stripBlock } from './lib/source.ts';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
// One fixed seam: the server render hands the Kettle scan sim's jobs to useScanJobs (its server snapshot is empty, which a
// client never sees), so the Agents flyout can be rendered with a job in it (the scan chip section near the end).
const SSR_JOBS = ['rail/panels.tsx', '() => (sim ? sim.jobs() : NO_JOBS), () => NO_JOBS)', '() => (sim ? sim.jobs() : NO_JOBS), () => (sim ? sim.jobs() : NO_JOBS))'];
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: [...JSON.parse(process.env.BP_OVERLAYS_MUTATE || '[]'), SSR_JOBS] } });

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
const { Phone, phoneFind } = await imp('components/Phone.tsx');
const { Legend } = await imp('components/Legend.tsx');

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

const V = getVariant('subtle');
const M = buildModel(1, () => 0, null), P = M.P;
const lensId = Object.keys(P.LENS).find((l) => lensOf(P, l)) as string;
const text = (html: string) => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// a fresh stub engine and state per render, with console.error captured (the card logs a failed aggregate once)
function render(el: () => Any, patch: Record<string, unknown>, lensAgg: () => Any, shared?: { E?: Any }) {
  const S = { ...initialState(1, P.asOf), ready: true, ...patch };
  const errors: string[] = [], origErr = console.error;
  console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ').slice(0, 160)); };
  const E = shared?.E ?? {
    M, S, U: 1, SAFE: { l: 0, t: 0, r: 1280, b: 800 }, FW: 1280, FH: 800,
    store: { get: () => S, subscribe: () => () => {} },
    setHoverEl() {}, placeHover() {}, dirty() {}, onFrame: () => () => {}, flyToFeature() {},
    placeById: (t: string, id: string) => (t === 'wing' ? M.L.WING[id] : t === 'room' ? M.L.ROOM[id] : null),
    lensIds: Object.keys(P.LENS),
    lensAgg, channel: () => null,
  };
  if (shared) { if (shared.E) { Object.assign(E.S, patch); E.lensAgg = lensAgg; } shared.E = E; }   // a reused engine takes the new state and aggregate
  try {
    const html: string = renderToString(React.createElement(VariantCtx.Provider, { value: V }, React.createElement(EngineCtx.Provider, { value: E }, el())));
    return { html, threw: null as string | null, errors };
  } catch (e) {
    return { html: '', threw: (e as Error).message, errors };
  } finally { console.error = origErr; }
}

// HoverCard: a throwing lens aggregate renders the card, logs once; a working one shows its line
const wing = M.L.blds[0].wings[0];
const hover = { view: lensId, hover: { type: 'wing', id: wing.id } };
const bad = render(() => React.createElement(O.HoverCard), hover, () => { throw new Error('check-overlays: aggregate threw'); });
expect(bad.threw === null && bad.html.length > 0, `HoverCard threw under a lens whose aggregate throws (${bad.threw})`);
expect(bad.errors.length === 1, `HoverCard logged ${bad.errors.length} errors for one throwing lens aggregate, expected 1`);
const ok = render(() => React.createElement(O.HoverCard), hover, () => ({ parts: ['CHECK lens part'] }));
expect(text(ok.html).includes('CHECK lens part'), 'HoverCard did not show the lens aggregate line it was given');

// One engine, one failing lens, reported on the plan AND under the pointer: the canvas (plan.ts) and the hover card share
// a single log-once set, so the pair prints one line. Each render above had its own stub engine, so it could not see two.
// The failure arrives through plan.ts's drawDecor (a channel whose decor throws); the card's aggregate throws too.
{
  const { drawDecor } = await imp('engine/render/plan.ts');
  const shared: { E?: Any } = {};
  const first = render(() => React.createElement(O.HoverCard), { view: lensId }, () => ({ parts: [] }), shared);
  const E = shared.E as Any;
  E.channel = (l: string) => (l === lensId ? { decor() { throw new Error('check-overlays: decor threw'); } } : null);
  E.mixS = { d: { [lensId]: 1 } }; E.th = {}; E.U = 1;
  const errs: string[] = [], keep = console.error;
  console.error = (...a: unknown[]) => { errs.push(String(a[0])); };
  try { drawDecor(E, { save() {}, restore() {} }, { c0x: 0, c0y: 0, c1x: 1, c1y: 1, k: 1 }); } finally { console.error = keep; }
  const card = render(() => React.createElement(O.HoverCard), hover, () => { throw new Error('check-overlays: aggregate threw'); }, shared);
  expect(first.threw === null && errs.length === 1, `plan.ts drawDecor logged ${errs.length} errors for one throwing decor, expected 1 (the stub engine did not reach the failure)`);
  expect(card.threw === null && card.errors.length === 0, `the same lens failing on the plan and under the pointer was logged ${errs.length + card.errors.length} times for one engine, expected 1`);
}

// Morning: the spend line reads SPEND_CAP and the away mark reads AWAY_SINCE
const mo = render(() => React.createElement(O.Morning), { morning: true }, () => ({ parts: [] }));
const mt = text(mo.html);
const cap = (mt.match(/spent today, cap \$ ?([\d,]+)/) || [])[1];
expect(mo.threw === null && cap === SPEND_CAP.toLocaleString('en-US'), `Morning cap reads ${cap ?? 'nothing'} (${mo.threw ?? 'rendered'}), the model's SPEND_CAP is ${SPEND_CAP}`);
const since = [...mt.matchAll(/since (\d\d:\d\d)/g)].map((m) => m[1]);
expect(since.length > 0 && since.every((s) => s === AWAY_SINCE.slice(11, 16)), `Morning away marks ${JSON.stringify(since)}, the model's AWAY_SINCE is ${AWAY_SINCE.slice(11, 16)}`);

// Phone headline and detail: headline live = header live + flagged; the detail's Back keeps a 44 px target
const ph = render(() => React.createElement(Phone), { phone: true, open: P.features[0].id }, () => ({ parts: [] }));
const all = M.agg.countsOf('ALL', P.features, P.asOf, 7);
const live = (ph.html.match(/<b>(\d+)<\/b>live</) || [])[1];
expect(ph.threw === null && Number(live) === all.live + all.flagged, `Phone headline live ${live ?? 'missing'} (${ph.threw ?? 'rendered'}), header live + flagged is ${all.live + all.flagged}`);
const back = (ph.html.match(/<button[^>]*>‹ Back<\/button>/) || [''])[0];
const h = Number((back.match(/height:\s*(\d+)px/) || [])[1]);
expect(h >= 44, `Phone Back button height ${Number.isNaN(h) ? 'unset' : h + 'px'}, expected at least 44px`);
// the detail covers the whole screen, so it is aria-modal and programmatically focusable (Phone.tsx moves the
// reading position into it on open and back to the row on close - the attributes are what make that possible)
const dlg = (ph.html.match(/<div[^>]*class="ph-detail"[^>]*>/) || [''])[0];
expect(/tabindex="-1"/.test(dlg) && /aria-modal="true"/.test(dlg), `the phone feature detail is not a focusable modal dialog (${dlg.slice(0, 160) || 'not rendered'})`);

// Toast: an undoable toast is not displaced by an informational one (it queues), the queue drains in order,
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
// severity: the toast's <div> only mounts after an effect (no server render), so the renderer is read as source: it must paint the
// model's tone as data-tone, and the chrome rule for each tone must exist (a failure must not arrive in mint)
const ovSrc = fs.readFileSync(path.join(SRC, 'components/Overlays.tsx'), 'utf8');
expect(/<motion\.div id="toast"[^>]*data-tone=\{cur\.tone\}/.test(ovSrc), '#toast does not paint the toast tone as data-tone');
const toastCss = fs.readFileSync(path.join(SRC, 'components/blueprint.css'), 'utf8');
expect(/#toast\[data-tone="bad"\]\s*\{[^}]*var\(--red\)/.test(toastCss) && /#toast\[data-tone="warn"\]\s*\{[^}]*var\(--amber\)/.test(toastCss), '#toast has no red/amber chrome rule for data-tone bad/warn');

// The General legend's caption is prose, not a key row: `.lg div` is a flex box, so without a block
// override the caption's two text runs and its <code> lay out as three narrow side-by-side columns (what
// shaped works around with .shp-cap). The class and the rule that carries it must both exist.
const lg = render(() => React.createElement(Legend, { view: 'general' }), {}, () => ({ parts: [] }));
expect(lg.threw === null && /class="lg-cap"/.test(lg.html), `the General legend caption lost its .lg-cap class (${lg.threw ?? 'rendered'})`);
const bpcss = stripBlock(fs.readFileSync(path.join(SRC, 'components/blueprint.css'), 'utf8'));
const capRule = /\.lg\s+\.lg-cap\s*\{([^}]*)\}/.exec(bpcss);
expect(!!capRule && /display\s*:\s*block/.test(capRule[1]), 'blueprint.css: .lg .lg-cap does not set display: block, so the caption lays out as flex columns');

// General legends with every lens switched off (`?lenses=-a,-b,...` leaves P.lenses empty; parseLensToggle has no floor):
// the plan draws no lens marks, so neither key may describe marks or count "all 0 enabled lenses". The populated case is
// read first, as the guard that the phrases still bite - a reworded legend cannot pass the empty case by saying nothing.
{
  const { SubtleLegend } = await imp('variants/subtle/Legend.tsx');
  const keys = (shared: { E?: Any }) => [
    text(render(() => React.createElement(SubtleLegend, { view: 'general' }), {}, () => ({ parts: [] }), shared).html),
    text(render(() => React.createElement(Legend, { view: 'general' }), {}, () => ({ parts: [] }), shared).html),
  ];
  const full: { E?: Any } = {};
  const [subFull, capFull] = keys(full);
  expect(/one mark per lens/.test(subFull) && new RegExp(`all ${P.lenses.length} enabled lenses`).test(capFull), 'the populated General legends no longer say "one mark per lens" / "all N enabled lenses" - the empty-lens scan stopped matching');
  const none: { E?: Any } = {};
  render(() => null, {}, () => ({ parts: [] }), none);
  none.E.M = { ...M, P: { ...P, lenses: [] } }; none.E.lensIds = [];
  const [subNone, capNone] = keys(none);
  expect(!/one mark per lens/.test(subNone) && /No lenses are enabled/.test(subNone), `the subtle General legend with 0 lenses still describes marks or does not say so (${subNone.slice(0, 120)})`);
  expect(!/all 0 enabled lenses/.test(capNone) && /No lenses are enabled/.test(capNone), `the shared General caption with 0 lenses still counts "all 0 enabled lenses" or does not say so`);
}

// Phone touch targets, DERIVED rather than listed: every phone-scoped rule in blueprint.css whose subject (the last
// compound of its selector) is an interactive element must declare at least 44 px on the rule for that element. A subject is
// interactive when it is a button / summary / input / select / textarea / a, or when it carries a class that a control the
// Phone actually renders (list and detail) carries - so `.ph-q .op`, `.ph-more` and `.theme-toggle` are found without being
// named here. State variants (`:hover`, `[aria-pressed]`, pseudo-elements) inherit from their base rule and are skipped. A
// rule that styles a control that is not a thumb target opts out with a `touch-exempt` comment inside the rule.
// Read from the CSS with comments BLANKED (offsets and line numbers stay the file's own), so a comment about the rule cannot
// stand in for it and the reported anchor is the line the rule sits on.
const rawCss = fs.readFileSync(path.join(SRC, 'components/blueprint.css'), 'utf8');
const touchCss = blankBlock(rawCss);
const phList = render(() => React.createElement(Phone), { phone: true, open: null }, () => ({ parts: [] }));
const controlClasses = new Set<string>();
for (const m of (ph.html + phList.html).matchAll(/<(?:button|summary|input|select|textarea|a)\b([^>]*)>/g)) {
  for (const c of (/class="([^"]*)"/.exec(m[1]) || ['', ''])[1].split(/\s+/)) if (c) controlClasses.add(c);
}
const TAGS = ['button', 'summary', 'input', 'select', 'textarea', 'a'];
const subjectOf = (sel: string) => sel.trim().split(/\s*[>+~]\s*|\s+/).pop() as string;
const byTouch = new Map<string, { sel: string; line: number; px: number; exempt: boolean; kind: string }>();
for (const m of touchCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const line = touchCss.slice(0, m.index + m[0].indexOf(m[1].trim())).split('\n').length;
  const exempt = /touch-exempt/.test(rawCss.slice(m.index, m.index + m[0].length));
  const px = Math.max(-Infinity, ...[...m[2].matchAll(/(?:^|[;\s])(?:min-height|height)\s*:\s*(\d+(?:\.\d+)?)px/g)].map((d) => Number(d[1])));
  for (const sel of m[1].split(',').map((s) => s.trim())) {
    if (!/\.ph-|\.bp-phone/.test(sel)) continue;
    const subj = subjectOf(sel);
    if (/[:[]/.test(subj)) continue;
    const tag = (/^[a-z][a-z0-9-]*/.exec(subj) || [''])[0];
    const classes = subj.match(/\.[\w-]+/g)?.map((c) => c.slice(1)) ?? [];
    const kind = TAGS.includes(tag) ? tag : classes.find((c) => controlClasses.has(c)) ? 'class' : '';
    if (!kind) continue;
    const prev = byTouch.get(sel);
    byTouch.set(sel, prev ? { ...prev, px: Math.max(prev.px, px), exempt: prev.exempt || exempt } : { sel, line, px, exempt, kind });
  }
}
const touch = [...byTouch.values()];
// the matcher guard: the derivation must still see each kind of control this file is known to style for a thumb
for (const k of ['button', 'summary', 'input', 'class']) expect(touch.some((t) => t.kind === k), `blueprint.css: the touch-target derivation found no phone ${k === 'class' ? 'control reached through a rendered class' : k + ' rule'} - the matcher stopped biting`);
expect(touch.length >= 9, `blueprint.css: the touch-target derivation found ${touch.length} phone control rules, 9 are known - the matcher stopped biting`);
for (const t of touch) expect(t.exempt || t.px >= 44, `blueprint.css:${t.line} ${t.sel}: touch target ${Number.isFinite(t.px) ? t.px + 'px' : 'unset'}, expected at least 44px (or a touch-exempt comment)`);

// globals.css states the rule on the tokens themselves: --mint-2 / --amber-2 / --red-2 are the text-grade
// status colours (>= 4.5:1 on paper and cards) and --mint / --amber / --red stay the marker and fill tones.
// In light theme --red reads 4.36:1 on --paper, so a text colour taken from the marker set fails WCAG AA.
// Borders and fills ('border-color', 'background') are untouched: this matches a bare `color:` only.
const rawText = [...bpcss.matchAll(/(?:^|[;{\s])color\s*:\s*var\(\s*--(red|mint|amber)\s*\)/g)].map((m) => m[1]);
expect(rawText.length === 0, `blueprint.css: ${rawText.length} text colour(s) taken from the marker tokens (--${rawText.join(', --')}) instead of their text-grade --*-2 siblings`);

// The phone's reading list drops every level with no hit, so a search never prints a heading with nothing
// under it (`q` is component state, so the rule is held on the exported pure function, not on a render).
const wingsOf = (g: Any[]) => g.reduce((n: number, b: Any) => n + b.wings.length, 0);
const hitsOf = (g: Any[]) => g.reduce((n: number, b: Any) => n + b.wings.reduce((m: number, w: Any) => m + w.rooms.reduce((k: number, r: Any) => k + r.hits.length, 0), 0), 0);
const allWings = wingsOf(phoneFind(M.L.blds, ''));
expect(allWings > 1 && hitsOf(phoneFind(M.L.blds, '')) === P.features.length, `an empty query must list every wing and every feature (${allWings} wings, ${hitsOf(phoneFind(M.L.blds, ''))} of ${P.features.length} features)`);
const one = P.features[0], g1 = phoneFind(M.L.blds, one.name);
expect(wingsOf(g1) >= 1 && wingsOf(g1) < allWings && hitsOf(g1) >= 1, `a query for one feature listed ${wingsOf(g1)} of ${allWings} wings and ${hitsOf(g1)} hits: empty headings are still rendered`);
const g0 = phoneFind(M.L.blds, 'zzz no such feature zzz');
expect(g0.length === 0, `a query that matches nothing returned ${g0.length} buildings (${wingsOf(g0)} wings), so the list renders headings over no rows`);

// WCAG 2.5.3 label in name: a control whose visible text is a key cap ("Esc") must carry that text in
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

// BlueprintApp's loading panel: a sample chunk that never settles must not read like a fresh load. BlueprintApp pulls the whole
// chrome and cannot be server-rendered here, so the rule is held on its comment-stripped source: one SampleLoading component
// owning a timer that adds a Reload once it fires, and no second inline copy of the loading panel.
const appSrc = readStripped(path.join(SRC, 'components/BlueprintApp.tsx'));
const fnOf = (name: string) => { const i = appSrc.indexOf('function ' + name + '('); if (i < 0) return ''; const j = appSrc.indexOf('\nfunction ', i + 1); return appSrc.slice(i, j < 0 ? undefined : j); };
{
  const fn = fnOf('SampleLoading');
  expect(fn.includes('setTimeout(') && fn.includes('SAMPLE_SLOW_MS') && fn.includes('clearTimeout(') && fn.includes('>Reload<'), 'BlueprintApp SampleLoading no longer times out into a Reload');
  expect(appSrc.includes('<SampleLoading />') && appSrc.split('Loading the Kettle sample').length === 2, 'BlueprintApp renders the sample loading state outside SampleLoading');
}

// LiveEmpty on the Kettle sample's own build failure: the live-product copy ("Open the Kettle sample instead") links to the page
// the reader is already on, so that branch is told apart (`kettle`) and offers Reload, as ChromeBoundary does.
{
  const fn = fnOf('LiveEmpty');
  expect(fn.includes('kettle') && fn.includes('>Reload<'), 'LiveEmpty has no Reload branch for the Kettle sample build failure');
  expect(appSrc.includes('kettle={!product}'), 'the Kettle build-failure call site does not pass `kettle` to LiveEmpty');
}

// ThemeToggle: a refused localStorage write is reported (setTheme returns false) and the toggle's name says the choice is for this
// visit only; a kept write stays silent. The stub is a document and a localStorage that throw on demand.
{
  const T = await imp('components/ThemeToggle.tsx');
  const g = globalThis as Any, held0 = { d: g.document, l: g.localStorage };
  g.document = { documentElement: { dataset: {} as Record<string, string> } };
  Object.defineProperty(g, 'localStorage', { configurable: true, value: { setItem() { throw new Error('blocked'); } } });
  const refused = T.setTheme('light');
  Object.defineProperty(g, 'localStorage', { configurable: true, value: { setItem() {} } });
  const kept = T.setTheme('dark');
  g.document = held0.d; if (held0.l === undefined) delete g.localStorage; else Object.defineProperty(g, 'localStorage', { configurable: true, value: held0.l });
  expect(refused === false && kept === true, `setTheme reports a refused write as ${refused} and a kept one as ${kept}, expected false / true`);
  expect(T.themeLabel('light', true) === 'Switch to light theme' && /visit only/.test(T.themeLabel('light', false)), 'themeLabel does not word the refused write only when it happened');
  const html: string = renderToString(React.createElement(T.ThemeToggle));
  expect(html.includes('Switch to') && !html.includes('visit only'), 'a fresh toggle (nothing refused yet) already carries the notice');
}
// Screens viewer: the scan polls, so the run list it indexes is rebuilt under it. The reader's A/B choice is held as a run
// id and resolved against the CURRENT list (pickRun): a pruned list must not index past its end (A undefined throws at
// t.shot), and a newer run arriving must not turn the chosen run into another one. renderToString keeps no state across
// renders, so the stale-choice cases are held on the resolver the Viewer reads, and the Viewer is rendered at 3 and 1 takes.
const { Viewer, pickRun } = await imp('components/sheet/Screens.tsx');
const take = (id: string) => ({ run: null, runId: id, shot: { id: 's-' + id, path: 'shots/' + id + '/a.png', size: 'phone', theme: 'dark', captured_at: '2026-10-01T10:00:00Z' } });
const three = ['r3', 'r2', 'r1'].map(take), solo = [take('r3')];
expect(pickRun(three, 'r1', 1) === 2 && pickRun(solo, 'r1', 1) === 0, `pickRun: a chosen run pruned from the list resolved to ${pickRun(solo, 'r1', 1)}, expected the clamped default 0`);
expect(pickRun([take('r4'), ...three], 'r2', 0) === 2, 'pickRun: a newer run arriving changed which run the reader chose (r2 is now index 2)');
expect(pickRun(three, null, 1) === 1 && pickRun(three, null, 0) === 0 && pickRun([], null, 1) === 0, 'pickRun: the unchosen default is not the second newest (A) and the newest (B)');
for (const t of [three, solo]) {
  const sv = render(() => React.createElement(Viewer, { slug: 'p', k: 'phone · dark', takes: t, name: 'F', close() {} }), {}, () => ({ parts: [] }));
  expect(sv.threw === null && /class="shotv"/.test(sv.html), `Screens Viewer threw with ${t.length} take(s) (${sv.threw ?? 'rendered'})`);
}

// Flyout focus (WCAG 2.4.3): closing a panel hands focus back to its rail item, so opening one must hand it to the panel
// body (.fb, tabIndex -1), or a keyboard reader Tabs past every remaining rail button to reach it. No DOM rig exists, so
// Dock.tsx is read as source with comments blanked (a comment about the rule cannot stand in for it). The close path is
// the guard that the matcher still bites: if it is not found, the pattern - not the Dock - is what broke.
const dockSrc = readBlanked(path.join(SRC, 'components/Dock.tsx'));
const focusCalls = (needle: string) => [...dockSrc.matchAll(/\.focus\(/g)].filter((m) => dockSrc.slice(Math.max(0, m.index - 220), m.index).includes(needle)).length;
expect(focusCalls('[data-k=') > 0, 'Dock.tsx: the close-path focus call (rail item by data-k) was not found - the flyout focus scan stopped matching');
expect(focusCalls("'.fb'") > 0, "Dock.tsx: opening a flyout never focuses its body (.fb) - focus stays on the rail and the panel is 7 Tab presses away");

// Scan chip (engine-render/B): the chip on the plan hovers to its job's card and clicks into the Agents flyout on that job.
// HoverCard with S.hover { type: 'scan' } reads the engine's drawn view (E.scans.viewOf): lens name, status word, n/m, how long
// a stale run has been silent, a failed run's error. Agents seeds its selection from S.scanJob: the job's detail with Cancel.
{
  const lid = Object.keys(P.LENS)[0], lname = P.LENS[lid].name;
  const sv = (o: Record<string, unknown>) => ({ id: 'j1', job: 'j1', lens: lid, accent: '', place: null, features: [], done: new Set(), n: 3, m: 12, status: 'stale', seen: Date.now() - 12 * 60000, ...o });
  const card = (V: Any) => {
    const shared: { E?: Any } = {};
    render(() => null, {}, () => ({ parts: [] }), shared);
    shared.E.scans = { viewOf: (id: string) => (id === 'j1' ? V : null) };
    return render(() => React.createElement(O.HoverCard), { hover: { type: 'scan', id: 'j1' } }, () => ({ parts: [] }), shared);
  };
  const st = card(sv({})), stt = text(st.html);
  expect(st.threw === null && [lname, 'stalled', '3/12', 'no sign of life for 12 min', 'Click for the job'].every((w) => stt.includes(w)), `HoverCard for a stale scan chip lacks the lens name / stalled / 3/12 / silence / click hint (${st.threw ?? stt.slice(0, 160)})`);
  const fl = card(sv({ status: 'failed', error: 'exit 1: gate red', seen: undefined })), flt = text(fl.html);
  expect(fl.threw === null && flt.includes('exit 1: gate red') && flt.includes('failed'), `HoverCard for a failed scan chip does not show its error (${fl.threw ?? flt.slice(0, 160)})`);

  const { Agents } = await imp('components/rail/wide/agents.tsx');
  const now = Date.now(), j1 = { id: 'j1', kind: 'measure', lens: lid, scope: { kind: 'all', label: 'Everything' }, status: 'running', queued_at: new Date(now - 60000).toISOString(), started_at: new Date(now - 60000).toISOString() };
  const agents = (scanJob: string | null) => {
    const shared: { E?: Any } = {};
    render(() => null, {}, () => ({ parts: [] }), shared);
    shared.E.M = Object.assign(Object.create(M), { scanSim: { subscribe: () => () => {}, jobs: () => [j1], snapshot: () => undefined } });
    shared.E.patch = () => {};
    return render(() => React.createElement(Agents), { scanJob, dtab: 'swarm' }, () => ({ parts: [] }), shared);
  };
  const a1 = agents('j1'), a1t = text(a1.html);
  expect(a1.threw === null && a1t.includes('Cancel job') && /wb-kick[^>]*>.*j1/.test(a1.html) && !a1t.includes('Latest from the swarm'), `Agents with S.scanJob = j1 does not open j1's detail with Cancel (${a1.threw ?? a1t.slice(0, 200)})`);
  const a0 = agents(null), a0t = text(a0.html);
  expect(a0.threw === null && !a0t.includes('No scans yet'), `GUARD the server render reached the scan sim's jobs (the SSR_JOBS seam in rail/panels.tsx no longer matches) (${a0.threw ?? a0t.slice(0, 200)})`);
  expect(a0.threw === null && !a0t.includes('Cancel job') && (a0t.includes('Latest from the swarm') || a0t.includes('No swarm data')), `GUARD Agents with S.scanJob null is not the Overview as before (${a0.threw ?? a0t.slice(0, 200)})`);
}

if (failures.length) { console.error(`check-overlays: ${failures.length} failed (${held} held)`); for (const f of failures) console.error('  ' + f); process.exit(1); }
console.log(`check-overlays: ${held} expectations held`);
