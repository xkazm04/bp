// The variant chunk law: the production route `/` draws with the adopted subtle expression, so nothing it imports
// statically may reach the shaped or bold prototypes (apps/web/src/variants/{shaped,bold}/**, nor base/legacy.ts,
// which only they use). Each prototype loads through exactly one door, a dynamic import() in variants/registry.ts,
// and the routes that only NAME a variant (the /variants index cards, /v/<id>'s metadata and static params) read
// the registry's meta list, never a variant module. Counted over the static import graph (scripts/lib/import-graph.ts,
// the walker check-train-budget.ts uses for the ledger), then held at run time: the doors resolve to the variant
// their meta entry names.
// Run: node scripts/check-variant-chunk.ts  (Node's type stripping; scripts/overlays-loader.mjs transpiles src/**/*.tsx).
// Exit 1 when a case fails.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SRC, chain, dynIn, rel, walk, type Graph } from './lib/import-graph.ts';
import { readStripped, stripComments } from './lib/source.ts';

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

const V = path.join(SRC, 'variants'), REG = path.join(V, 'registry.ts');
const LAZY = ['shaped', 'bold'] as const;
const index = (id: string) => path.join(V, id, 'index.ts');
const PROTO = LAZY.map((id) => path.join(V, id) + path.sep), LEGACY = path.join(V, 'base', 'legacy.ts');
const at = (...ps: string[]) => ps.map((p) => path.join(SRC, p));

// the walker keeps a specifier's spelling ('./bold' resolves to `...\bold/index.ts` on Windows), so compare normalised
const N = (p: string) => path.normalize(p);
/** The prototype modules a graph reaches, each with the import chain that reaches it. */
const leaks = (g: Graph): string[] => [...g.reached].filter((p) => N(p) === LEGACY || PROTO.some((d) => N(p).startsWith(d))).map((p) => chain(g, p).map(rel).join(' -> '));
const show = (xs: string[]) => xs.slice(0, 4).join('; ') + (xs.length > 4 ? ` (+${xs.length - 4} more)` : '');

// ------------------------------------------------------------------------------------------- 1-2. the static graph
const prod = walk(at('app/page.tsx', 'app/layout.tsx'));
const prodLeaks = leaks(prod);
expect(!prodLeaks.length, `\`/\` (app/page.tsx + app/layout.tsx) reaches ${prodLeaks.length} prototype module(s) statically: ${show(prodLeaks)}`);
const named = walk(at('app/variants/page.tsx', 'app/v/[variant]/page.tsx'));
const namedLeaks = leaks(named);
expect(!namedLeaks.length, `the /variants index and /v/[variant] reach ${namedLeaks.length} prototype module(s) statically: ${show(namedLeaks)}`);
console.log(`chunk   / reaches ${prod.reached.size} modules statically, ${prodLeaks.length} of them shaped/**, bold/** or base/legacy.ts; /variants + /v/[variant] reach ${named.reached.size}, ${namedLeaks.length} of them`);

// ------------------------------------------------------------------------------------------- 3. one door each
/** The registry's doors: exactly one dynamic import() of each prototype's index.ts, over the comment-stripped source. */
const doorFailures = (src: string): string[] => LAZY.flatMap((id) => {
  const n = dynIn(REG, stripComments(src)).filter((p) => N(p) === index(id)).length;
  return n === 1 ? [] : [n ? `${n} doors for ${id} (want one)` : `no door for ${id}`];
});
const regRaw = fs.readFileSync(REG, 'utf8');
const doorBad = doorFailures(regRaw);
expect(!doorBad.length, 'variants/registry.ts: ' + doorBad.join(', '));
console.log(`doors   variants/registry.ts: ${LAZY.map((id) => id + ' ' + dynIn(REG, stripComments(regRaw)).filter((p) => N(p) === index(id)).length).join(', ')}`);
// the control: comment out bold's door and leave its spelling in the comment - the check must fail naming bold
{
  const seeded = regRaw.replace(/import\((\s*['"]\.\/bold(?:\/index(?:\.ts)?)?['"]\s*)\)/, '/* import($1) */ Promise.resolve(null)');
  const r = doorFailures(seeded);
  expect(seeded !== regRaw && r.length === 1 && r[0] === 'no door for bold', 'control: a registry whose bold door is commented out must fail "no door for bold": ' + JSON.stringify(r));
}

// ------------------------------------------------------------------------------------------- 6. the matcher bites
// a synthetic tree: the real one, with registry.ts keeping a static `import { bold } from './bold'`
{
  const g = walk(at('app/page.tsx', 'app/layout.tsx'), (f) => fs.readFileSync(f, 'utf8') + (f === REG ? "\nimport { bold } from './bold';\n" : ''));
  const l = leaks(g), hit = l.find((c) => c.endsWith('apps/web/src/variants/bold/index.ts'));
  expect(!prodLeaks.length && !!hit && hit.startsWith('apps/web/src/app/page.tsx'),
    'control: a registry with a static import of ./bold must fail listing bold/index.ts as reached from app/page.tsx (and the real tree must not): ' + (hit ?? show(l)));
}

// ------------------------------------------------------------------------------------------- 7. one walker, two checks
{
  const tb = path.join(ROOT, 'scripts/check-train-budget.ts'), src = stripComments(fs.readFileSync(tb, 'utf8'));
  const usesLib = /from\s+'\.\/lib\/import-graph\.ts'/.test(src) && !/function\s+resolveSpec|function\s+statIn|const\s+dynIn\s*=/.test(src);
  const out = usesLib ? spawnSync(process.execPath, [tb], { cwd: ROOT, encoding: 'utf8', timeout: 300_000 }) : null;
  const line = out?.stdout.split('\n').find((s) => s.startsWith('chunk ')) ?? '';
  const want = `chunk   / reaches ${prod.reached.size} modules statically, none of the ledger page or train/**; the ledger loads through ${rel(prod.doors.get(path.join(SRC, 'components/ledger/LedgerPage.tsx')) ?? '(nothing)')}`;
  expect(usesLib && out?.status === 0 && line === want,
    `check-train-budget.ts walks with scripts/lib/import-graph.ts (no inline walker: ${usesLib}) and prints the same chunk line (exit ${out?.status}): got "${line}", want "${want}"`);
}

// ------------------------------------------------------------------------------------------- 4-5, 8. the registry itself
register('./overlays-loader.mjs', { parentURL: import.meta.url, data: { src: SRC, root: ROOT, mutate: [] } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const R: Any = await import(pathToFileURL(REG).href);
const meta: Any[] = Array.isArray(R.VARIANT_META) ? R.VARIANT_META : [];
const ids = meta.map((m) => m.id);
expect(JSON.stringify(ids) === '["subtle","shaped","bold"]', `VARIANT_META ids in index order: ${JSON.stringify(ids)} (want ["subtle","shaped","bold"])`);
{
  const reg = stripComments(regRaw);
  const pages = ['app/variants/page.tsx', 'app/v/[variant]/page.tsx'].map((p) => [p, readStripped(path.join(SRC, p))] as const);
  const literal = pages.filter(([, s]) => /['"](subtle|shaped|bold)['"]/.test(s)).map(([p]) => p);
  const derived = /\bVARIANT_IDS\b[^=;]*=\s*VARIANT_META\.map\(/.test(reg) && JSON.stringify(R.VARIANT_IDS) === JSON.stringify(ids);
  const params = /generateStaticParams[\s\S]*?VARIANT_IDS\.map\(/.test(pages[1][1]);
  expect(derived && params && !literal.length,
    `one list: VARIANT_IDS derives from VARIANT_META (${derived}), /v/[variant] generateStaticParams maps VARIANT_IDS (${params}), no page spells a variant id (${literal.join(', ') || 'none'})`);
}
/** Meta entries whose name or description differ from the literals in <id>/index.ts's `export const <id>: Variant`. */
const metaDrift = (ms: Any[], readIndex: (id: string) => string): string[] => ms.flatMap((m) => {
  const s = readIndex(m.id), i = s.search(new RegExp(`export\\s+const\\s+${m.id}\\s*:\\s*Variant\\s*=\\s*\\{`)), body = i < 0 ? '' : s.slice(i);
  const lit = (k: string) => body.match(new RegExp(`\\b${k}:\\s*(['"])(.*?)\\1`))?.[2];
  const bad = (['name', 'description'] as const).filter((k) => lit(k) === undefined || lit(k) !== m[k]);
  return bad.length ? [`${m.id}: ${bad.join(' and ')} drift from ${m.id}/index.ts`] : [];
});
{
  const drift = metaDrift(meta, (id) => readStripped(index(id)));
  expect(meta.length === 3 && !drift.length, 'VARIANT_META name/description equal the variant modules\': ' + (drift.join('; ') || `${meta.length} entries`));
  // the control: a synthetic bold/index.ts with a changed description must fail naming bold
  const synth = metaDrift(meta, (id) => { const s = readStripped(index(id)); return id === 'bold' ? s.replace(/(\bdescription:\s*['"])/, '$1Changed. ') : s; });
  expect(meta.length === 3 && synth.length === 1 && synth[0].startsWith('bold: description'), 'control: a bold/index.ts with a changed description must fail naming bold: ' + JSON.stringify(synth));
}
// the doors at run time (critic revision): each lazy variant resolves to the Variant its meta entry names; an unknown id to null
{
  const load = typeof R.loadVariant === 'function' ? R.loadVariant : null;
  const got: string[] = [];
  for (const id of LAZY) {
    const v: Any = load ? await load(id).catch((e: Error) => ({ err: e.message })) : null, m = meta.find((x) => x.id === id);
    const ok = !!v && !!m && v.id === id && v.name === m.name && v.description === m.description && !!v.expression && typeof v.expression === 'object';
    got.push(`${id} ${ok ? 'ok' : JSON.stringify(v && { id: v.id, name: v.name, err: v.err })}`);
    expect(ok, `loadVariant('${id}') resolves to a Variant matching its meta entry with an expression: ${got.at(-1)}`);
  }
  const nope = load ? await load('nope') : undefined;
  expect(nope === null, `loadVariant('nope') resolves to null: ${String(nope)}`);
  console.log(`load    ${got.join(', ')}, nope ${String(nope)}`);
}
// GUARD (unchanged by the change): getVariant('subtle') stays synchronous - the server-render checks and
// BlueprintApp's first render read it without awaiting; an unknown id is null.
{
  const s = R.getVariant?.('subtle');
  expect(!!s && s.id === 'subtle' && !!s.expression && R.getVariant('nope') === null, 'guard: getVariant(\'subtle\') returns the subtle Variant synchronously, getVariant(\'nope\') null');
}

if (failures.length) { for (const f of failures) console.log('FAIL ' + f); console.log(`check-variant-chunk: ${failures.length} failed, ${held} held`); process.exit(1); }
console.log(`check-variant-chunk: ${held} held`);
