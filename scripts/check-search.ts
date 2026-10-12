// Pins the Find ranking against the real Kettle model: tiers are a max (a multi-word query that also hits a
// domain still reaches the multi-word tier), ties sort by name, a source feature appears once at ?scale>1 (the
// clone in the reader's product line wins), and the page reports how many matches it cut.
// Run: node scripts/check-search.ts  (Node's type stripping; scripts/overlays-loader.mjs transpiles src on the fly).
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: [] } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const { buildModel, search, searchAll, searchPage, baseId } = (await import(pathToFileURL(path.join(SRC, 'lib/model/index.ts')).href)) as Any;

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

const P1 = buildModel(1, () => 0, null).P, P4 = buildModel(4, () => 0, null).P;
const names = (fs: Any[]) => fs.map((f: Any) => f.name);

// the first hit for a feature's own name is that feature
const f0 = P1.features[0];
expect(search(P1, f0.name)[0]?.id === f0.id, 'a feature found by its own name ranks first: ' + names(search(P1, f0.name)).join(' | '));
expect(search(P1, f0.id.toUpperCase())[0]?.id === f0.id, 'an exact slug (any case) ranks first');
expect(search(P1, '   ').length === 0, 'a blank query finds nothing');

// multi-word: every word of a feature name, reversed, still finds it even when a domain name also matches one word
const multi = P1.features.find((f: Any) => f.name.split(/\s+/).length >= 2 && P1.D[f.domain].name.toLowerCase().includes(f.name.toLowerCase().split(/\s+/)[0]));
const probe = multi ?? P1.features.find((f: Any) => f.name.split(/\s+/).length >= 2);
const rev = probe.name.toLowerCase().split(/\s+/).reverse().join(' ');
expect(searchAll(P1, rev).some((f: Any) => f.id === probe.id), `a reversed multi-word query "${rev}" reaches ${probe.id}${multi ? ' (domain also matches)' : ''}`);

// max over tiers: a feature whose name AND domain match scores as its best tier, so it never sorts below a domain-only hit
const dom = P1.D[P1.features[0].domain].name.toLowerCase().split(/\s+/)[0];
const dRes = searchAll(P1, dom), firstDomainOnly = dRes.findIndex((f: Any) => !f.name.toLowerCase().includes(dom) && !f.summary.toLowerCase().includes(dom));
const lastNamed = dRes.map((f: Any) => f.name.toLowerCase().includes(dom)).lastIndexOf(true);
expect(firstDomainOnly < 0 || lastNamed < firstDomainOnly, `name matches for "${dom}" rank above domain-only matches`);

// ties by name: the domain-only hits all share one tier, so they come out in name order
const only = dRes.filter((f: Any) => !f.name.toLowerCase().includes(dom) && !f.summary.toLowerCase().includes(dom));
expect(only.every((f: Any, i: number) => i === 0 || only[i - 1].name.localeCompare(f.name) <= 0), `domain-only hits for "${dom}" sort by name`);

// pinned Kettle queries
expect(names(search(P1, 'gift cards'))[0] === 'Gift cards' && names(search(P1, 'cards gift'))[0] === 'Gift cards', 'gift cards, in either word order, finds Gift cards first');
expect(names(search(P1, 'waitlist')).slice(0, 2).every((n: string) => /^waitlist/i.test(n)), 'waitlist: the two Waitlist features lead: ' + names(search(P1, 'waitlist')).join(' | '));
expect(names(search(P1, 'payments'))[0] === 'Card payments' && searchPage(P1, 'payments').total > 8, 'payments: a name hit leads, domain hits trail, and the page is truncated');

// scale 4: one hit per source feature, whatever the query
for (const q of [f0.name, 'pay', 'a']) {
  const r = searchAll(P4, q), bases = r.map((f: Any) => baseId(f.id));
  expect(new Set(bases).size === bases.length, `scale 4 "${q}": each source feature once (${bases.length} hits)`);
  expect(r.length === searchAll(P1, q).length, `scale 4 "${q}": as many hits as scale 1 (${r.length} vs ${searchAll(P1, q).length})`);
}
// the preferred product line wins the clone
for (const b of [0, 2]) {
  const r = searchAll(P4, f0.name, b);
  const mine = r.filter((f: Any) => baseId(f.id) === f0.id);
  expect(mine.length === 1 && P4.D[mine[0].domain].bld === b, `scale 4: clone in line ${b} preferred (got ${mine.map((f: Any) => f.id)})`);
}

// paging
const pg = searchPage(P1, 'a', 3);
expect(pg.hits.length === 3 && pg.total === searchAll(P1, 'a').length && pg.total > 3, `searchPage reports the full count (${pg.hits.length} of ${pg.total})`);
expect(search(P1, 'a').length <= 8, 'search keeps its default cap of 8');

if (failures.length) { console.error('check-search: FAIL\n  ' + failures.join('\n  ')); process.exit(1); }
console.log(`check-search: ${held} expectations hold`);
