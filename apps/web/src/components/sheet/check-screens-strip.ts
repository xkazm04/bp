// Pins what the feature sheet's Screens strip says where the lens expected shots and there are none. Before this the
// strip returned null for "no scan store", "the scan errored", "still loading" and "the scan has no shots of this
// feature" alike, so the Screens block was simply absent and nothing said which. Server-renders ScreensStrip under each
// live status with the scan missing, empty and holding a shot, and asserts:
//   - with `expected` (the lens tab, a harness lens) every no-shot state prints its own sentence, all different;
//   - without `expected` (the sheet's plain strip) an empty state stays absent, as before;
//   - with a shot the strip draws its thumbnail and no empty sentence, whatever the status;
//   - Kettle (no live product) draws nothing: it has no store to ask.
// Run: node apps/web/src/components/sheet/check-screens-strip.ts  (scripts/overlays-loader.mjs transpiles src on the fly).
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { stripComments } from '../../../../../scripts/lib/source.ts';

const ROOT = path.resolve(import.meta.dirname, '../../../../..'), SRC = path.join(ROOT, 'apps/web/src');
register(pathToFileURL(path.join(ROOT, 'scripts/overlays-loader.mjs')).href, { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: [] } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const React = (await import('react')).default, { renderToStaticMarkup } = (await import('react-dom/server')) as Any;
const { ScreensStrip } = (await import(pathToFileURL(path.join(SRC, 'components/sheet/Screens.tsx')).href)) as Any;
const { LiveCtx } = (await import(pathToFileURL(path.join(SRC, 'components/hooks.ts')).href)) as Any;

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

const f: Any = { id: 'booking', name: 'Booking' };
const shot: Any = { id: 1, run_id: 'r1', feature: 'booking', path: 'shots/a.png', captured_at: '2026-10-15T00:00:00Z', size: '1280', theme: 'light' };
const snap = (shots: Any[]): Any => ({ runs: [], proposals: [], measurements: [], shots, activity: [] });
const render = (live: Any, expected: boolean): string =>
  renderToStaticMarkup(React.createElement(LiveCtx.Provider, { value: live }, React.createElement(ScreensStrip, { f, expected })));
const live = (status: string, scan?: Any, error?: string): Any => ({ slug: 'p', product: { status, events: '', jobs: [], ...(scan ? { scan } : {}), ...(error ? { error } : {}) } });

const states: [string, Any][] = [
  ['live, scan without shots', live('live', snap([]))],
  ['offline, scan without shots', live('offline', snap([]))],
  ['error, no scan', live('error', undefined, 'store locked')],
  ['loading, no scan', live('loading')],
  ['missing, no scan', live('missing')],
];
const said = states.map(([n, l]) => [n, render(l, true)] as const);
for (const [n, h] of said) expect(h.trim().length > 0, `${n}: says something where the screens are missing`);
expect(new Set(said.map(([, h]) => h)).size === said.length, 'every no-shot state reads differently: ' + said.map(([n, h]) => n + '=' + JSON.stringify(h)).join(' | '));
expect(/store locked/.test(said[2][1]), 'the error state carries the store error');
for (const [n, l] of states) expect(render(l, false).trim() === '', `${n}: the sheet strip (not expected) stays absent`);
for (const st of ['live', 'offline', 'error']) {
  const h = render(live(st, snap([shot])), true);
  expect(h.includes('class="thumb') && !/No screens/.test(h), `${st} with a shot: the thumbnail, no empty sentence`);
}
// the lens tab is what asks for the sentence: its strip must be mounted with `expected`
const lensTab = stripComments(fs.readFileSync(path.join(SRC, 'components/page/LensTab.tsx'), 'utf8'));
expect(/<ScreensStrip\s+f=\{f\}\s+expected\s*\/>/.test(lensTab), 'LensTab mounts <ScreensStrip expected />');
expect(render(null, true).trim() === '', 'Kettle: no live product, nothing drawn');

if (failures.length) { for (const m of failures) console.log('FAIL ' + m); console.log(`check-screens-strip: ${failures.length} failed, ${held} held`); process.exit(1); }
console.log(`check-screens-strip: ${held} checks passed`);
