// The wave composer's Arrange control (apps/web/src/components/ledger/waves/arrange.ts + WaveComposer.tsx): one press
// re-partitions the held findings into packages. Cases:
//   1. findings on features F1,F1,F2,F3 by feature -> 3 packages, each feature in exactly one, no shared feature;
//   2. findings on 15 features by feature with MAX_PACKAGES 12 -> exactly 12 packages: the lightest groups (size weight)
//      merge into the lightest packages, no feature in two packages, every id once;
//   3. findings on 3 lenses by lens -> one package per lens named by the lens short name; when two lenses share a
//      feature the shared-feature list is not empty and the composer still renders its clash warning;
//   4. model/effort (operator revision: no new default policy): a package keeps the model and effort of the package
//      that held its first finding before the arrange; a finding with no previous package takes the composer's existing
//      default (Opus, high), which the Model and Effort Segs still change;
//   5. every arrange() output passes checkWaveBody and is deterministic: the same findings shuffled -> the same packages,
//      in map order (Finding.fi);
//   6. composer (SSR through the overlays loader): an "Arrange" Seg (One package | By feature | By lens) is in the head,
//      a new wave shows One package pressed, an edited wave none; choosing one only replaces the packages (the wave name
//      and the excluded note stay); a manual Move afterwards still works; Esc still closes.
// GUARDS (behaviour that must not change): a new wave still starts as ONE package (Opus, high) holding every id; a
// manual edit wave with two packages on one feature still shows the clash warning.
// Run: node scripts/check-wave-arrange.ts  (Node's type stripping; scripts/overlays-loader.mjs transpiles the src).
// Exit 1 on any failure.
import { register, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { blankComments } from './lib/source.ts';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src'), WAVES = path.join(SRC, 'components/ledger/waves');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: [] } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const g = globalThis as Any;
g.window ??= { devicePixelRatio: 1 };
const imp = async (p: string): Promise<Any> => { try { return await import(pathToFileURL(path.join(SRC, p)).href); } catch (e) { console.log('(cannot load ' + p + ': ' + String((e as Error).message).split('\n')[0] + ')'); return {}; } };
const req = createRequire(path.join(ROOT, 'package.json'));
const React: Any = req('react'), { renderToStaticMarkup }: Any = req('react-dom/server');
const h = React.createElement;
const W = await import(pathToFileURL(path.join(ROOT, 'packages/core/src/scan/waves.ts')).href) as Any;
const A = await imp('components/ledger/waves/arrange.ts');
const { WaveComposer } = await imp('components/ledger/waves/WaveComposer.tsx');
const { SIZE_W } = await imp('components/ledger/useLedger.ts');

let passed = 0;
const failures: string[] = [];
const ok = (c: boolean, what: string) => { if (c) passed++; else failures.push(what); };
const cases = new Map<number, boolean>();
const caseOk = (n: number, c: boolean, what: string) => { ok(c, 'case ' + n + ': ' + what); cases.set(n, (cases.get(n) ?? true) && c); };
const arrange = (fs: Any[], by: string, o: Any = {}): Any[] => { try { return typeof A.arrange === 'function' ? A.arrange(fs, by, o) : []; } catch (e) { console.log('(arrange threw: ' + String((e as Error).message) + ')'); return []; } };
const shared = (pks: Any[], byId: Map<string, Any>): Any[] => (typeof A.sharedFeatures === 'function' ? A.sharedFeatures(pks, byId) : [{ missing: true }]);

/** A Finding as the composer reads it: p.{id, feature, lens, size, risk, title}, fname, fi. */
const fd = (id: string, feature: string, fi: number, o: Any = {}): Any => ({ p: { id, feature, lens: o.lens ?? 'house.qa', size: o.size ?? 'M', risk: o.risk ?? 3, title: 'Item ' + id }, fname: 'Feature ' + feature, fi, status: 'proposed', can: true });
const ids = (pks: Any[]) => pks.flatMap((p) => p.ids);
const featsOf = (pk: Any, byId: Map<string, Any>) => new Set(pk.ids.map((i: string) => byId.get(i).p.feature));
const oneFeatureOnePackage = (pks: Any[], byId: Map<string, Any>) => {
  const seen = new Map<string, number>();
  pks.forEach((p, k) => { for (const f of featsOf(p, byId)) seen.set(f as string, (seen.get(f as string) ?? 0) + 1); void k; });
  return [...seen.values()].every((n) => n === 1);
};
const index = (fs: Any[]) => new Map(fs.map((f) => [f.p.id, f]));
const valid = (pks: Any[]) => W.checkWaveBody({ name: 'w', packages: pks.map((p) => ({ name: p.name, model: p.model, effort: p.effort, ids: p.ids })) }).ok === true;

// ------------------------------------------------------------------------------------------- 1. by feature
const c1 = [fd('a1', 'F1', 0), fd('a2', 'F1', 0), fd('b1', 'F2', 1), fd('c1', 'F3', 2)], c1i = index(c1);
{
  const r = arrange(c1, 'feature');
  caseOk(1, r.length === 3, '3 packages (' + r.length + ')');
  caseOk(1, r.length > 0 && oneFeatureOnePackage(r, c1i) && ids(r).sort().join() === 'a1,a2,b1,c1', 'every feature in exactly one package, every id once');
  caseOk(1, r.length > 0 && shared(r, c1i).length === 0, 'the shared-feature (clash) list over the result is empty');
  caseOk(1, r[0]?.name === 'Feature F1', 'a package is named by its feature (' + r[0]?.name + ')');
}

// ------------------------------------------------------------------------------------------- 2. over MAX_PACKAGES
const SIZES = ['XL', 'L', 'M', 'S', 'XS'];
const c2 = Array.from({ length: 15 }, (_, i) => [fd('x' + i, 'G' + String(i).padStart(2, '0'), i, { size: SIZES[i % 5] }), ...(i < 3 ? [fd('y' + i, 'G' + String(i).padStart(2, '0'), i, { size: 'L' })] : [])]).flat(), c2i = index(c2);
{
  caseOk(2, W.MAX_PACKAGES === 12, 'MAX_PACKAGES is 12');
  const r = arrange(c2, 'feature');
  caseOk(2, r.length === 12, 'exactly 12 packages (' + r.length + ')');
  caseOk(2, r.length > 0 && oneFeatureOnePackage(r, c2i), 'no feature in two packages');
  caseOk(2, ids(r).length === c2.length && new Set(ids(r)).size === c2.length, 'every id once');
  // the three lightest feature groups (by size weight, map order breaking ties) are the ones merged away
  const w = (f: string) => c2.filter((x) => x.p.feature === f).reduce((s, x) => s + SIZE_W[x.p.size], 0);
  const groups = [...new Set(c2.map((x) => x.p.feature))].map((f, i) => ({ f, w: w(f), i })).sort((a, b) => b.w - a.w || a.i - b.i);
  const lightest = new Set(groups.slice(12).map((x) => x.f));
  const merged = r.filter((p) => featsOf(p, c2i).size > 1);
  caseOk(2, merged.length > 0 && merged.every((p) => [...featsOf(p, c2i)].some((f) => lightest.has(f as string))) && [...lightest].every((f) => merged.some((p) => featsOf(p, c2i).has(f))), 'the lightest groups are the ones merged (' + [...lightest].join() + ')');
  const pw = r.map((p) => p.ids.reduce((s: number, i: string) => s + SIZE_W[c2i.get(i).p.size], 0));
  const solo = r.map((p, k) => (featsOf(p, c2i).size === 1 ? pw[k] : Infinity));
  caseOk(2, merged.every((p) => { const own = [...featsOf(p, c2i)].find((f) => !lightest.has(f as string)); return own === undefined || w(own as string) <= Math.min(...solo); }), 'they merge into the lightest packages');
  caseOk(2, merged.every((p) => p.name.length <= 60 && /\+ \d+ more$/.test(p.name)), 'a merged package says so in its name (' + merged.map((p) => p.name).join(' | ') + ')');
}

// ------------------------------------------------------------------------------------------- 3. by lens
const c3 = [fd('l1', 'F1', 0, { lens: 'house.qa' }), fd('l2', 'F2', 1, { lens: 'house.ux' }), fd('l3', 'F2', 1, { lens: 'house.perf' }), fd('l4', 'F3', 2, { lens: 'house.qa' })], c3i = index(c3);
const SHORT: Record<string, string> = { 'house.qa': 'QA', 'house.ux': 'UX', 'house.perf': 'PERF' };
const lensName = (id: string) => SHORT[id] ?? id;
const r3 = arrange(c3, 'lens', { lensName });
{
  caseOk(3, r3.length === 3 && r3.map((p) => p.name).join() === 'QA,UX,PERF', 'one package per lens, named by the short name, in map order (' + r3.map((p) => p.name).join() + ')');
  caseOk(3, r3.every((p) => new Set(p.ids.map((i: string) => c3i.get(i).p.lens)).size === 1), 'each package holds one lens');
  const s = shared(r3, c3i);
  caseOk(3, s.length === 1 && s[0].name === 'Feature F2', 'two lenses on one feature -> the shared-feature list names it (' + JSON.stringify(s.map((x: Any) => x.name)) + ')');
}

// ------------------------------------------------------------------------------------------- 4. model / effort kept
{
  const prev = new Map<string, Any>([['a1', { model: 'sonnet', effort: 'low' }], ['a2', { model: 'opus', effort: 'xhigh' }], ['b1', { model: 'opus', effort: 'medium' }]]);
  const r = arrange(c1, 'feature', { was: (id: string) => prev.get(id) });
  const by = (n: string) => r.find((p) => p.name === n);
  caseOk(4, by('Feature F1')?.model === 'sonnet' && by('Feature F1')?.effort === 'low', 'a package keeps the model/effort of the package its first finding was in (' + JSON.stringify(by('Feature F1')) + ')');
  caseOk(4, by('Feature F2')?.model === 'opus' && by('Feature F2')?.effort === 'medium', 'F2 keeps opus/medium');
  caseOk(4, by('Feature F3')?.model === 'opus' && by('Feature F3')?.effort === 'high', 'no previous package -> the existing default opus/high');
  const hot = arrange([fd('h1', 'F1', 0, { risk: 9, size: 'XL' }), fd('h2', 'F2', 1, { risk: 1, size: 'XS' })], 'feature');
  caseOk(4, hot.length === 2 && hot.every((p) => p.model === 'opus' && p.effort === 'high'), 'risk and size invent no model/effort policy: both stay opus/high');
}

// ------------------------------------------------------------------------------------------- 5. valid + deterministic
{
  const all = [arrange(c1, 'one'), arrange(c1, 'feature'), arrange(c2, 'feature'), arrange(c2, 'lens'), r3, arrange(c2, 'one')];
  caseOk(5, all.every((r) => r.length > 0 && valid(r)), 'every output passes checkWaveBody');
  caseOk(5, all[0].length === 1 && all[0][0].ids.join() === 'a1,a2,b1,c1', "'one' -> one package, map order");
  const shuffle = (a: Any[]) => [...a].reverse().sort((x, y) => (x.p.id.charCodeAt(1) % 3) - (y.p.id.charCodeAt(1) % 3));
  const same = (x: Any[], y: Any[]) => JSON.stringify(x) === JSON.stringify(y);
  caseOk(5, same(arrange(shuffle(c2), 'feature'), arrange(c2, 'feature')) && same(arrange(shuffle(c3), 'lens', { lensName }), r3) && same(arrange(shuffle(c1), 'one'), all[0]), 'shuffled input -> the same packages');
  const firstFi = (r: Any[], i: Map<string, Any>) => r.map((p) => Math.min(...p.ids.map((x: string) => i.get(x).fi)));
  const sorted = (a: number[]) => a.every((v, k) => !k || a[k - 1] <= v);
  caseOk(5, sorted(firstFi(arrange(c2, 'feature'), c2i)) && sorted(firstFi(r3, c3i)), 'packages come in map order');
  caseOk(5, ids(arrange(c2, 'feature')).length > 0 && arrange(c2, 'feature').every((p) => sorted(p.ids.map((x: string) => c2i.get(x).fi))), 'ids inside a package in map order');
  caseOk(5, arrange([], 'feature').length === 0, 'no findings -> no packages (the composer then keeps what it has)');
}

// ------------------------------------------------------------------------------------------- 6. the composer
{
  const findings = [...c3, fd('t1', 'F9', 9)], byId = index(findings);
  const draft = { id: 'w-1', name: 'Lens wave', status: 'draft', created_at: 't', packages: r3.map((p, i) => ({ id: 'pk-' + (i + 1), ...p })) };
  const manual = { id: 'w-2', name: 'Manual', status: 'draft', created_at: 't', packages: [{ id: 'pk-1', name: 'A', model: 'opus', effort: 'high', ids: ['l2'] }, { id: 'pk-2', name: 'B', model: 'opus', effort: 'high', ids: ['l3'] }] };
  const L = { waves: { waves: [draft, manual], busy: false, create: async () => null, update: async () => null }, byId, waveTaken: [{ f: byId.get('t1'), wave: manual }], waveReady: [], lenses: Object.entries(SHORT).map(([id, short]) => ({ id, short, name: short, glyph: null, n: 1, enabled: true })), closeComposer() {}, set() {} };
  const render = (ask: Any): string => { try { return typeof WaveComposer === 'function' ? renderToStaticMarkup(h(WaveComposer, { L, ask })).replace(/<!-- -->/g, '') : ''; } catch (e) { console.log('(render threw: ' + String((e as Error).message).split('\n')[0] + ')'); return ''; } };
  const fresh = render({ ids: ['l1', 'l2', 'l3', 'l4'] }), edited = render({ ids: [], edit: 'w-1' }), man = render({ ids: [], edit: 'w-2' });
  const head = (html: string) => { const i = html.indexOf('class="wv-head"'); const j = html.indexOf('class="wv-cp"', i); return i < 0 ? '' : html.slice(i, j); };
  const seg = (html: string) => /<span class="tr-seg" role="group" aria-label="Arrange"[^>]*>(.*?)<\/span>/.exec(head(html))?.[1] ?? '';
  const labels = (s: string) => [...s.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
  const pressed = (s: string) => [...s.matchAll(/<button[^>]*aria-pressed="true"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
  caseOk(6, labels(seg(fresh)).join('|') === 'One package|By feature|By lens', 'an Arrange Seg in the head: One package | By feature | By lens (' + labels(seg(fresh)).join('|') + ')');
  caseOk(6, pressed(seg(fresh)).join() === 'One package', 'a new wave shows One package pressed');
  caseOk(6, seg(edited) !== '' && pressed(seg(edited)).length === 0, 'an edited wave shows none pressed (it is arranged by hand)');
  caseOk(6, /data-wave="clash"/.test(edited), 'a by-lens wave whose lenses share a feature still shows the clash warning');
  caseOk(6, /data-wave="excluded"/.test(fresh) && /value="Wave 3"/.test(fresh), 'the excluded note and the wave name render beside it');
  ok(/data-wave-pkg="Package 1"/.test(fresh) && (fresh.match(/data-wave-pkg=/g) ?? []).length === 1 && /aria-label="Model"[^>]*><button[^>]*aria-pressed="false"[^>]*>Sonnet<\/button><button[^>]*aria-pressed="true"[^>]*>Opus/.test(fresh), 'guard: a new wave starts as ONE package, Opus, holding every id');
  ok(/data-wave="clash"/.test(man), 'guard: a manual wave with two packages on one feature shows the clash warning');
  // the press: only setPks + the Seg's own value; the name state is untouched; Move and Esc unchanged
  const S = blankComments(fs.readFileSync(path.join(WAVES, 'WaveComposer.tsx'), 'utf8'));
  const segSrc = /<Seg(?:<[^>]*>)? label="Arrange"[^\n]*/.exec(S)?.[0] ?? '';
  caseOk(6, /onChange=\{(\w+)\}/.test(segSrc) || /onChange=\{\(\w+\) => \w+\(\w+\)\}/.test(segSrc), 'the Seg calls one handler (' + segSrc.slice(0, 80) + ')');
  const handler = /onChange=\{(?:\(\w+\) => )?(\w+)/.exec(segSrc)?.[1] ?? '@';
  const hbody = (() => { const i = S.indexOf('const ' + handler + ' = '); return i < 0 ? '' : S.slice(i, S.indexOf('\n  const ', i + 1)); })();
  caseOk(6, /\barrange\(/.test(hbody) && /setPks\(/.test(hbody) && !/setName\(/.test(hbody), 'the handler replaces the packages through arrange() and leaves the name alone');
  caseOk(6, /const move = [^\n]*setPks\(/.test(S) && /e\.key === 'Escape'[^\n]*L\.closeComposer\(\)/.test(S), 'Move and Esc are unchanged');
  caseOk(6, /sharedFeatures\(/.test(S), 'the composer reads its clash list from the shared sharedFeatures()');
}

const red = [...cases].filter(([, v]) => !v).map(([k]) => k);
console.log('cases: ' + (cases.size - red.length) + ' of ' + cases.size + ' hold' + (red.length ? ' (red: ' + red.join(', ') + ')' : ''));
if (failures.length) { for (const f of failures) console.log('FAIL ' + f); console.log(failures.length + ' failed, ' + passed + ' held'); process.exit(1); }
console.log('check-wave-arrange: ' + passed + ' held');
