// Pins what the model says about facets NOBODY MEASURED (packages/core/src/model/**). The facet reader returns ''
// and null for an absent value, so every word the model builds out of those values must stay distinguishable from
// a real reading - the rule the A/B facet-reader fix left to its consumers.
//   (a) lens.ts headlineSummary: a place's headline is computed over the features that carry the field, so it
//       names that denominator whenever it is smaller than the place, and never when the place is whole.
// Run: node scripts/check-model.ts   (Node's type stripping; scripts/overlays-loader.mjs transpiles src/** on the fly)
// Control: BP_MODEL_MUTATE='[["lens.ts"," (\x27 + n + \x27 of \x27","(\x27 + n + \x27 OF \x27"]]' rewrites source text as
// it loads ([file suffix, find, replace] literals), so an assertion can be seen red on a seeded defect.
// Exit 1 on any failure.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_MODEL_MUTATE || '[]') } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const impCore = (p: string): Promise<Any> => import(pathToFileURL(path.join(ROOT, 'packages/core', p)).href);

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

const { buildModel } = await impCore('src/model/sample.ts');
const { headlineSummary } = await impCore('src/model/lens.ts');

const M = buildModel(1, () => Date.parse('2026-10-08T09:00:00Z'), null) as Any;
const P = M.P;
const PLACES: { id: string; feats: Any[] }[] = [...M.L.rooms, ...M.L.wings, ...M.L.bays, ...M.L.blds];

// ---------------------------------------------------------------- (a) a place headline names what it measured
{
  let n = 0, partial = 0, whole = 0;
  const bad: string[] = [];
  for (const d of P.lenses) {
    const f = d.headline; if (!f) continue;
    for (const pl of PLACES) {
      const s = headlineSummary(d, pl.feats);
      if (!s) continue;
      n++;
      let have = 0;
      for (const g of pl.feats) if (g.lens[d.id]?.v[f.key] !== undefined) have++;
      if (have < pl.feats.length) {
        partial++;
        if (!s.includes('(' + have + ' of ' + pl.feats.length + ')')) bad.push(`${d.id}.${f.key}/${pl.id}: "${s}" was measured on ${have} of ${pl.feats.length}`);
      } else {
        whole++;
        if (/\(\d+ of \d+\)/.test(s)) bad.push(`${d.id}.${f.key}/${pl.id}: "${s}" covers the whole place, so it must not name a denominator`);
      }
    }
  }
  expect(n > 100 && partial > 50 && whole > 50, `(a) the sample must exercise both arms: ${n} place headlines, ${partial} partial, ${whole} whole`);
  expect(!bad.length, `(a) ${bad.length} of ${n} place headlines do not say what they measured:\n      ` + bad.slice(0, 4).join('\n      '));
  console.log(`headlines   ${n} place headlines / ${partial} over part of the place / ${whole} over all of it / ${bad.length} silent`);
}

if (failures.length) {
  console.log(`\ncheck-model: ${failures.length} failed, ${held} held`);
  for (const f of failures) console.log('FAIL  ' + f);
  process.exit(1);
}
console.log(`\ncheck-model: ${held} expectations held`);
