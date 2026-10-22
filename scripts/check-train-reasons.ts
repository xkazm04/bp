// A disabled decision button must give its reason to the accessibility tree (ui/Controls.tsx Btn `reason`, used by
// train/Decide.tsx). A `disabled` button leaves the tab order and its `title` is hover-only, so a keyboard or
// screen-reader operator never learns why Accept / Rework / Descope / Undo cannot be used. This server-renders the real
// Decide with nothing selected (all four decisions unavailable) and counts, per button, the three things an operator
// needs: it stays focusable (no `disabled`), it says it is unavailable (`aria-disabled="true"`), and its
// `aria-describedby` resolves to an element carrying the reason. Also: the click is suppressed on a reasoned Btn, and a
// Btn without a reason is the plain button it was. Before: 0 of 4 reach the tree. Expected: 4 of 4.
// Run: node scripts/check-train-reasons.ts  (Node's type stripping; scripts/overlays-loader.mjs transpiles the src).
// Exit 1 on any failure.
import { register, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { blankComments } from './lib/source.ts';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: [] } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const g = globalThis as Any;
g.window ??= { devicePixelRatio: 1 };
const imp = (p: string): Promise<Any> => import(pathToFileURL(path.join(SRC, p)).href);
const req = createRequire(path.join(ROOT, 'package.json'));
const React: Any = req('react'), { renderToStaticMarkup }: Any = req('react-dom/server');
const h = React.createElement;
const { buildModel } = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/model/sample.ts')).href) as Any;
const { initialState } = await imp('engine/state.ts');
const { EngineCtx, VariantCtx, LiveCtx } = await imp('components/hooks.ts');
const { getVariant } = await imp('variants/registry.ts');
const { Decide } = await imp('components/ledger/train/Decide.tsx');
const { Btn } = await imp('components/ledger/train/ui/Controls.tsx');

let passed = 0;
const failures: string[] = [];
const ok = (c: boolean, what: string) => { if (c) passed++; else failures.push(what); };

const M = buildModel(1, () => 0, null), S = { ...initialState(1, M.P.asOf), ready: true, page: 'ledger', lv: 'triage' };
const E = { M, S, U: 1, store: { get: () => S, subscribe: () => () => {} }, dirty() {}, onFrame: () => () => {}, setPage() {}, flyToFeature() {}, openFeature() {}, lensAgg: () => ({ parts: [] }), channel: () => null };
const live = { slug: 'synthetic', product: { status: 'live', events: '', jobs: [], scan: { runs: [], measurements: [], proposals: [], activity: [], shots: [], coverage: [], packs: [], releases: [] } } };
const render = (el: Any) => renderToStaticMarkup(h(VariantCtx.Provider, { value: getVariant('subtle') }, h(EngineCtx.Provider, { value: E }, h(LiveCtx.Provider, { value: live }, el))));

const html: string = render(h(Decide, { ids: [] }));
const buttons = html.match(/<button\b[\s\S]*?<\/button>/g) ?? [];
ok(buttons.length === 4, 'the bar renders its four decision buttons (' + buttons.length + ')');
let reach = 0;
for (const b of buttons) {
  const open = b.slice(0, b.indexOf('>') + 1);
  const focusable = !/\sdisabled(=|\s|>)/.test(open), flagged = /aria-disabled="true"/.test(open);
  const id = /aria-describedby="([^"]+)"/.exec(open)?.[1];
  const text = id ? new RegExp('id="' + id.replace(/[:]/g, '\\$&') + '"[^>]*>([^<]+)<').exec(b)?.[1] : undefined;
  if (focusable && flagged && text && /pack item first/.test(text)) reach++;
}
ok(reach === 4, 'disabled decision buttons whose reason reaches the accessibility tree and the tab order: ' + reach + ' of 4');

{ // a reasoned Btn is aria-disabled and carries it; a plain one is the plain button
  const withReason = renderToStaticMarkup(h(Btn, { reason: 'why not', onClick() {} }, 'X'));
  const plain = renderToStaticMarkup(h(Btn, { onClick() {} }, 'X'));
  ok(/aria-disabled="true"/.test(withReason) && /why not/.test(withReason), 'a Btn with a reason is aria-disabled and carries it');
  ok(!/aria-disabled|aria-describedby|\sdisabled/.test(plain), 'a Btn without a reason is the plain button');
}
{ // the click is suppressed on a reasoned Btn (an event cannot be fired in a static render: read the source, comments blanked)
  const src = blankComments(fs.readFileSync(path.join(SRC, 'components/ledger/train/ui/Controls.tsx'), 'utf8'));
  ok(/onClick=\{reason \? undefined : onClick\}/.test(src), 'Btn drops onClick while it has a reason');
}

if (failures.length) { for (const f of failures) console.log('FAIL ' + f); console.log(failures.length + ' failed, ' + passed + ' held'); process.exit(1); }
console.log('train decision reasons: ' + passed + ' assertions held');
