// Checks that the compare panel judges a rebuild against the attempt it replaces, on the Kettle sample train
// (packages/core/src/model/train-sim.ts: des1-kiosk, reworked with KIOSK_NOTE because its offline banner covers the
// scanner, rebuilt as des2-kiosk with the banner at the bottom; both read 2 -> 1, so only the screens tell them apart):
//   - attemptChain (compare/attempts.ts): the earlier attempts newest first, numbered, with status, note and verdict;
//     a first build has none; a cycle in attempt_of stops at 50;
//   - againstPairs: one pair per (theme, size) of the current attempt, its before the previous attempt's AFTER of the
//     same theme and size, never the base; a missing one stays missing and reads 'lone';
//   - Screens: the 'Against' choice (base / attempt n-1) only on a rebuild, the captions naming the two attempts; a
//     'prev' choice carried to a first build shows the base pairs and no choice;
//   - the change map: the prev-vs-cur pair caches under its own key, and the changed area (pixels.ts diffPixels and
//     focusCrop over the sample SVGs, rasterised by sharp as the worker's canvas would) spans both banner bands;
//   - Measurement: an 'Attempt n-1' line between Before and After with the note quoted and its commit, only on a rebuild;
//   - the prefetch follows the choice: the next rebuild's previous-attempt afters, no base befores.
// Run: node scripts/check-train-attempts.ts  (Node's type stripping; scripts/overlays-loader.mjs transpiles the .tsx).
import fs from 'node:fs';
import { createRequire, register } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ScanSim } from '../packages/core/src/model/scan-sim.ts';
import { SAMPLE_ITEMS } from '../packages/core/src/model/train-sim.ts';
import { compareOf, type LensFields, type ShotPair } from '../packages/core/src/scan/compare.ts';
import { diffPixels, focusCrop } from '../packages/core/src/train/pixels.ts';
import type { Proposal } from '../packages/core/src/scan/types.ts';
import type { LensManifest } from '../packages/core/src/standard/types.ts';
import { harness } from './lib/expect.ts';

const H = harness('check-train-attempts');
const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src'), CMP = 'components/ledger/train/compare/';
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: [] } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const imp = async (f: string): Promise<Any> => { try { return await import(pathToFileURL(path.join(SRC, CMP + f)).href); } catch (e) { H.expect(false, `import ${f}`, String(e).split('\n')[0]); return {}; } };

// ------------------------------------------------------------------ the sample train, as the ledger's useTrain reads it
const structure = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/core/data/kettle.app-structure.json'), 'utf8')) as { features: { slug: string }[]; lenses: { id: string; manifest: LensManifest }[]; facets: Record<string, Record<string, { values?: Record<string, unknown> }>> };
const manifests = new Map(structure.lenses.map((l) => [l.id, l.manifest]));
const lenses: LensFields[] = structure.lenses.map((l) => ({ id: l.id, manifest: l.manifest }));
const sim = new ScanSim({ now: () => Date.parse('2026-10-15T12:00:00.000Z'), findings: [] });
sim.bind({ order: structure.features.map((f) => f.slug), manifest: (l) => manifests.get(l), value: (f, l, k) => { const v = structure.facets[f]?.[l]?.values?.[k]; return typeof v === 'number' ? v : undefined; } });
const s0 = sim.snapshot();
const T = { slug: null, proposals: s0.proposals, byId: new Map(s0.proposals.map((p) => [p.id, p])), measurements: s0.measurements, shots: s0.shots, lenses };
const idOf = (key: string): string => {
  const it = SAMPLE_ITEMS.find((i) => i.key === key)!;
  return s0.proposals.find((x) => x.title === it.title && x.pack_id === it.pack && (it.attemptOf ? !!x.attempt_of : !x.attempt_of))!.id;
};
const D1 = idOf('des1-kiosk'), D2 = idOf('des2-kiosk'), PERF = idOf('perf1-timetable'), BOOK = idOf('des1-booking');
const KIOSK_NOTE = SAMPLE_ITEMS.find((i) => i.key === 'des1-kiosk')!.note!;
const cmp = (id: string) => compareOf(T as Any, id, lenses)!;

const { attemptChain, againstPairs, pairsFor } = await imp('attempts.ts');
const { Screens, pairKey, pairReadings, pairLabel } = await imp('Screens.tsx');
const { Measurement } = await imp('Measurement.tsx');
const { prefetchSrcs } = await imp('ComparePanel.tsx');
const has = (f: unknown, name: string) => H.expect(typeof f === 'function', `${name} is exported`);
const ready = [has(attemptChain, 'attempts.ts attemptChain'), has(againstPairs, 'attempts.ts againstPairs'), has(pairsFor, 'attempts.ts pairsFor'), has(prefetchSrcs, 'ComparePanel.tsx prefetchSrcs')].every(Boolean);
const React = createRequire(path.join(ROOT, 'package.json'))('react') as Any, { renderToStaticMarkup } = createRequire(path.join(ROOT, 'package.json'))('react-dom/server') as Any;
const html = (el: Any) => renderToStaticMarkup(el) as string;
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

if (ready) {
  // ---------------------------------------------------------------- 1. attemptChain
  const ch = attemptChain(T, D2);
  H.expect(ch.length === 1 && ch[0].id === D1 && ch[0].n === 1 && ch[0].status === 'rework' && ch[0].note === KIOSK_NOTE && ch[0].verdict === cmp(D1).verdict,
    'attemptChain(des2-kiosk): one earlier attempt, des1-kiosk, n 1, rework, its note and verdict', ch.map((a: Any) => ({ id: a.id, n: a.n, status: a.status, verdict: a.verdict })));
  H.expect(attemptChain(T, PERF).length === 0 && attemptChain(T, D1).length === 0, 'attemptChain: a first build (perf1-timetable, des1-kiosk) has no earlier attempt');
  // a three-attempt chain and a cycle: numbered from the first build, newest first, and a loop stops at 50
  const mk = (id: string, of?: string): Proposal => ({ ...T.byId.get(D1)!, id, ...(of ? { attempt_of: of } : { attempt_of: undefined }) });
  const c3 = [mk('a1'), mk('a2', 'a1'), mk('a3', 'a2')], T3 = { ...T, proposals: c3, byId: new Map(c3.map((p) => [p.id, p])) };
  H.expect(attemptChain(T3, 'a3').map((a: Any) => a.id + ':' + a.n).join() === 'a2:2,a1:1', 'attemptChain: a third attempt lists attempts 2 and 1, newest first', attemptChain(T3, 'a3').map((a: Any) => a.id + ':' + a.n));
  const cy = [mk('x1', 'x2'), mk('x2', 'x1')], TC = { ...T, proposals: cy, byId: new Map(cy.map((p) => [p.id, p])) };
  let cyc: Any[] = []; try { cyc = attemptChain(TC, 'x1'); } catch { cyc = [] }
  H.expect(cyc.length > 0 && cyc.length <= 50, 'attemptChain: a cycle in attempt_of stops (at most 50 attempts)', cyc.length);

  // ---------------------------------------------------------------- 2. againstPairs
  const c2 = cmp(D2), c1 = cmp(D1), ap: ShotPair[] = againstPairs(c2.shots, c1.shots);
  const same = (x: ShotPair, y: ShotPair) => x.theme === y.theme && x.size === y.size;
  H.expect(ap.length === c2.shots.length && ap.every((p, i) => same(p, c2.shots[i]) && p.after?.id === c2.shots[i].after?.id && p.before?.id === c1.shots.find((q) => same(q, p))?.after?.id && p.before?.phase === 'after'),
    'againstPairs: one pair per (theme, size) of des2, before = des1\'s AFTER of that theme and size, after = des2\'s after', ap.map((p) => [p.theme, p.before?.path, p.after?.path]));
  const lonely: ShotPair[] = againstPairs(c2.shots, c1.shots.filter((p) => p.theme !== 'dark'));
  const dk = lonely.find((p) => p.theme === 'dark');
  H.expect(!!dk && dk.before === undefined && pairReadings([dk], [undefined])[0].state === 'lone', 'againstPairs: a (theme, size) the previous attempt lacks has no before and reads lone, never the base', dk && [dk.before?.path, pairReadings([dk], [undefined])[0].state]);

  // ---------------------------------------------------------------- 3. Screens
  const noop = () => {};
  const scr = (id: string, against: 'base' | 'prev', mode = 'side') => {
    const ch2 = attemptChain(T, id);
    return html(React.createElement(Screens, { c: cmp(id), slug: null, view: { theme: 'light', mode, against }, onView: noop, fname: 'Kiosk', stateLine: 'x', prev: ch2[0] ?? null }));
  };
  const lbl = pairLabel(c2.shots.find((p) => p.theme === 'light')!);
  const sp = text(scr(D2, 'prev'));
  H.expect(sp.includes('Attempt 1 · after · ' + lbl) && sp.includes('Attempt 2 · after · ' + lbl) && !sp.includes('Before · '), 'Screens des2 against attempt 1: captions name "Attempt 1 · after" and "Attempt 2 · after"', sp.slice(0, 400));
  const seg = /aria-label="Against"[\s\S]*?<\/span>/.exec(scr(D2, 'prev'))?.[0] ?? '';
  H.expect(/>base</.test(seg) && />attempt 1</.test(seg) && /aria-pressed="true"[^>]*>attempt 1</.test(seg), 'Screens des2: an Against choice offers base / attempt 1, attempt 1 pressed', seg);
  const sb = text(scr(D2, 'base'));
  H.expect(sb.includes('Before · ' + lbl) && sb.includes('After · ' + lbl) && /aria-label="Against"/.test(scr(D2, 'base')), 'Screens des2 against base: today\'s Before / After captions, the choice still offered');
  for (const id of [PERF, BOOK]) {
    const h2 = scr(id, 'prev');
    H.expect(!/aria-label="Against"/.test(h2) && !text(h2).includes('Attempt '), `Screens ${id === PERF ? 'perf1-timetable' : 'des1-booking'} with against 'prev' carried over: no Against choice, the base pairs`);
  }
  H.expect(text(scr(BOOK, 'prev')).includes('Before · '), 'Screens: a first build with \'prev\' carried shows its own before/after (no empty screens)');
  H.expect(text(scr(D2, 'prev')).includes('Attempt 1 · after'), 'Screens: back on the rebuild the carried \'prev\' is restored');
  for (const mode of ['slider', 'blink', 'map', 'focus']) H.expect(text(scr(D2, 'prev', mode)).includes('Attempt'), `Screens mode ${mode} against attempt 1 names the attempts`);

  // ---------------------------------------------------------------- 4. the change map: its own key, the changed area spans both bands
  const lightP = ap.find((p) => p.theme === 'light')!, lightB = c2.shots.find((p) => p.theme === 'light')!;
  const kp = pairKey(null, lightP), kb = pairKey(null, lightB);
  H.expect(!!kp && !!kb && kp !== kb, 'pairKey: the attempt-vs-attempt pair keys apart from the base pair (two cache entries)', [kp, kb]);
  const eff = pairsFor(c2, attemptChain(T, D2)[0], 'prev'), effB = pairsFor(cmp(BOOK), null, 'prev');
  H.expect(eff.against === 'prev' && eff.pairs[0]?.before?.proposal_id === D1 && effB.against === 'base' && effB.pairs.length === cmp(BOOK).shots.length,
    'pairsFor: a rebuild against prev pairs the previous after; a first build falls back to base', [eff.against, effB.against]);
  let sharp: Any = null;
  try { sharp = createRequire(path.join(ROOT, 'package.json'))('sharp'); } catch { /* reported below */ }
  if (H.expect(!!sharp, 'sharp loads (it rasterises the sample SVGs as the worker\'s canvas does)')) {
    const raster = async (p: string) => { const r = await sharp(path.join(ROOT, 'apps/web/public', p)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { d: new Uint8ClampedArray(r.data.buffer, r.data.byteOffset, r.data.length), w: r.info.width, h: r.info.height }; };
    const grid = async (b: string, a: string) => { const [x, y] = await Promise.all([raster(b), raster(a)]); return diffPixels(x.d, y.d, x.w, x.h); };
    const gp = await grid(lightP.before!.path, lightP.after!.path), gb = await grid(lightB.before!.path, lightB.after!.path);
    // the banner: y 168-232 at the top (des1), y 772-836 at the bottom (des2), in a 1600 x 900 capture
    H.expect(!!gp.bbox && gp.bbox[1] <= 232 && gp.bbox[3] >= 772, 'changed area des2 against attempt 1: the box spans the top and the bottom banner bands', gp.bbox);
    H.expect(!!gb.bbox && gb.bbox[1] >= 700, 'changed area des2 against base: only the bottom band moved (not the attempt-vs-attempt box)', gb.bbox);
    const cp = focusCrop(gp);
    H.expect(!!cp && cp.y * 900 <= 168 && (cp.y + cp.h) * 900 >= 836, 'focusCrop: the attempt-vs-attempt crop holds both banner bands', cp);
  }

  // ---------------------------------------------------------------- 5. Measurement
  const meas = (id: string) => html(React.createElement(Measurement, { c: cmp(id), now: null, prev: attemptChain(T, id)[0] ?? null }));
  const m2 = meas(D2), t2 = text(m2), sha = (T.byId.get(D1)!.commit_sha ?? '').slice(0, 7);
  const iB = t2.indexOf('Before'), iA1 = t2.indexOf('Attempt 1'), iAf = t2.indexOf('After');
  H.expect(iB >= 0 && iA1 > iB && iAf > iA1, 'Measurement des2: an "Attempt 1" line between Before and After', t2);
  H.expect(t2.includes('1 · reworked: “' + KIOSK_NOTE + '”') && !!sha && t2.includes(sha), 'Measurement des2: the line reads "1 · reworked: “<the note>”" with attempt 1\'s commit', [t2, sha]);
  const m1 = meas(BOOK), m0 = html(React.createElement(Measurement, { c: cmp(BOOK), now: null }));
  const els = (h: string) => (h.match(/<[a-zA-Z]/g) ?? []).length;
  H.expect(!text(m1).includes('Attempt') && els(m1) === els(m0), 'Measurement of a first build: no Attempt line, the element count unchanged', [els(m1), els(m0)]);

  // ---------------------------------------------------------------- 6/7. the prefetch follows the choice
  const pre = (against: 'base' | 'prev') => prefetchSrcs(null, cmp(D2), attemptChain(T, D2)[0] ?? null, { theme: 'both', mode: 'side', against }) as string[];
  const p1Afters = c1.shots.map((p) => p.after!.path), p2Befores = c2.shots.map((p) => p.before!.path), p2Afters = c2.shots.map((p) => p.after!.path);
  const pp = pre('prev'), pb = pre('base');
  H.expect(p1Afters.every((s) => pp.some((x) => x.endsWith(s))) && p2Afters.every((s) => pp.some((x) => x.endsWith(s))) && !p2Befores.some((s) => pp.some((x) => x.endsWith(s))),
    'prefetch against prev for a next rebuild: attempt 1\'s afters and its own afters, no base befores', pp);
  H.expect(p2Befores.every((s) => pb.some((x) => x.endsWith(s))) && !p1Afters.some((s) => pb.some((x) => x.endsWith(s))), 'prefetch against base: today\'s before/after sources', pb);
  const pf = prefetchSrcs(null, cmp(BOOK), null, { theme: 'both', mode: 'side', against: 'prev' }) as string[];
  H.expect(cmp(BOOK).shots.every((p) => pf.some((x) => x.endsWith(p.before!.path))), 'prefetch against prev for a next first build: its base pairs', pf);
}

H.done();
