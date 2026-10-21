// check:bold-decor - bold's decoration caches (building title-block totals, room data-class fences) must not outlive
// the model they were computed from. They used to be module-level Maps keyed on B.id + feats.length and R.id: a rescan
// that rebuilt the model with the same ids and counts but different facet values kept last scan's figures on screen.
// Run: node scripts/check-bold-decor.ts   (Node's type stripping; scripts/overlays-loader.mjs transpiles src/**)
// Control: BP_BOLD_DECOR_MUTATE='[["decor.ts","find","replace"]]' rewrites source as it loads, so the check can be seen red.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..'), SRC = path.join(ROOT, 'apps/web/src');
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: JSON.parse(process.env.BP_BOLD_DECOR_MUTATE || '[]') } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const { bldParts, sensOf }: Any = await import(pathToFileURL(path.join(SRC, 'variants/bold/decor.ts')).href);

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

// a feature carrying only the facets the two readers touch; each call builds fresh objects, as a model rebuild does
const feat = (asks: number, dataClass: string): Any => ({ lens: { business: { v: { customerRequests30d: asks }, h: 'ok' }, security: { v: { dataClass }, h: 'ok' } } });
const bld = (feats: Any[]): Any => ({ kind: 'bld', id: 'B0', feats });
const room = (feats: Any[]): Any => ({ kind: 'room', id: 'r0', feats });

// the same ids and the same feature counts, different facet values: the rescan case
const b1 = bld([feat(2, 'public')]), b2 = bld([feat(9, 'public')]);
const p1 = bldParts(b1, 'business').join('|'), p2 = bldParts(b2, 'business').join('|');
expect(p1.includes('2 customer asks'), 'the first building reads its own facets (2 asks): ' + p1);
expect(p2.includes('9 customer asks'), 'a rebuilt building with the same id and count reads ITS facets (9 asks), not the previous scan: ' + p2);
expect(bldParts(b1, 'business') === bldParts(b1, 'business'), 'one model still computes once: the same building returns the same array');
expect(bldParts(b1, 'business').join('|') === p1, 'asking a second lens or a rebuilt sibling does not disturb the first building');

const r1 = room([feat(0, 'public')]), r2 = room([feat(0, 'payment')]);
expect(sensOf(r1) === 0, 'a public-only room is not fenced');
expect(sensOf(r2) === 3, 'a rebuilt room with the same id but a payment feature is fenced, not served the old 0: ' + sensOf(r2));
expect(sensOf(r2) === sensOf(r2), 'one room computes once');

if (failures.length) { console.error('check:bold-decor FAILED\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
console.log(`check:bold-decor: ${held} expectations held`);
