// Holds the variants' literal CSS copies to their TypeScript sources. Some facts have to be restated in CSS
// because the element that shows them is outside the variant's React tree:
//   - shaped/styles.css draws each built-in lens tab's icon from a data-URI copy of its path in
//     shaped/icons.ts (LENS_ICON -> ICONS[..].s); a copy may add sub-paths (the dial's static needle),
//     never change the icon's own;
//   - bold/styles.css repeats bold/palette.ts's ACCENT as --bl-<lens> per theme, because the sheet's current
//     panel cannot read --lens (see the comment there).
// Two further copies are lists of the ids rather than of a value, and fail quietly when one is missing:
//   - shaped/styles.css's `:is(button[data-lens=...])` selector, which turns on a tab's number prefix;
//   - bold/styles.css's `[data-view='<l>'] #detail { --bl: var(--bl-<l>) }` alias, without which that lens's
//     detail panel draws in ink while every sibling lens has a colour.
// Each copy is compared with its source, in both directions: a copy or a source that cannot be found is a
// failure, not a skip, and a copy for an id that is not a BuiltinLens is dead CSS, also a failure.
// Run: node src/variants/check-copies.ts  (Node's type stripping; no build step). Exit 1 on any disagreement.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStripped } from '../../../../scripts/lib/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Source text with comments removed, so a rule described in a comment cannot stand in for the rule. */
const read = (p: string) => readStripped(path.join(HERE, p));

let agree = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) agree++; else failures.push(what); };

// The ids to check are NOT a list of this file's own: they are read from base/legacy.ts's KNOWN, which is
// `Record<BuiltinLens, true>` and therefore holds exactly the ids `LENS_ICON` and `ACCENT` are keyed by
// (both are `Record<BuiltinLens, ...>`, so the compiler forces them to agree). A hand-kept copy here would
// let a seventh built-in lens reach both sources and both stylesheets while this gate still reported
// "18 of 18 agree": it would check the six it knew and never notice the one it did not.
const legacy = read('base/legacy.ts');
const LENSES = [...(/\bKNOWN\b[^=]*= \{([^}]*)\}/.exec(legacy)?.[1] ?? '').matchAll(/(\w+): true/g)].map((m) => m[1]);
if (!LENSES.length) {
  console.log('FAIL base/legacy.ts: could not read KNOWN (the BuiltinLens ids this gate checks)');
  process.exit(1);
}

// ---------------------------------------------------------------- shaped: tab icons vs icons.ts
const icons = read('shaped/icons.ts');
const ICONS = new Map([...icons.matchAll(/^\s*(\w+): \{ s: '([^']+)'/gm)].map((m) => [m[1], m[2]]));
const lensIcon = /LENS_ICON[^=]*= \{([^}]*)\}/.exec(icons)?.[1] ?? '';
const LENS_ICON = new Map([...lensIcon.matchAll(/(\w+): '(\w+)'/g)].map((m) => [m[1], m[2]]));
const shapedCss = read('shaped/styles.css');
const tabPath = new Map([...shapedCss.matchAll(/button\[data-lens='(\w+)'\] \{ --shp-ic: url\("data:image\/svg\+xml,([^"]+)"\)/g)]
  .map((m) => [m[1], /\bd='([^']+)'/.exec(decodeURIComponent(m[2]))?.[1] ?? '']));
for (const l of LENSES) {
  const icon = LENS_ICON.get(l), want = icon ? ICONS.get(icon) : undefined, got = tabPath.get(l);
  if (!want) { expect(false, `shaped/icons.ts: no LENS_ICON path for ${l}`); continue; }
  if (got === undefined) { expect(false, `shaped/styles.css: no tab icon for ${l}`); continue; }
  expect(got === want || got.startsWith(want + ' M'), `shaped/styles.css tab icon for ${l} is not ICONS.${icon}: css '${got}' vs '${want}'`);
}

// ---------------------------------------------------------------- bold: --bl-<lens> vs palette.ts
const palette = read('bold/palette.ts');
const accentBlock = /export const ACCENT[^=]*= \{([\s\S]*?)\n\};/.exec(palette)?.[1] ?? '';
const ACCENT = new Map([...accentBlock.matchAll(/(\w+): \{ dark: '(#[0-9a-fA-F]{3,8})', light: '(#[0-9a-fA-F]{3,8})' \}/g)].map((m) => [m[1], { dark: m[2], light: m[3] }]));
const boldCss = read('bold/styles.css');
const rule = (sel: RegExp) => new Map([...(sel.exec(boldCss)?.[1] ?? '').matchAll(/--bl-(\w+): (#[0-9a-fA-F]{3,8})/g)].map((m) => [m[1], m[2]]));
const dark = rule(/^\[data-variant='bold'\] \{([^}]*--bl-[^}]*)\}/m), light = rule(/^:root\[data-theme='light'\] \[data-variant='bold'\] \{([^}]*)\}/m);
for (const l of LENSES) {
  const src = ACCENT.get(l);
  if (!src) { expect(false, `bold/palette.ts: no ACCENT for ${l}`); continue; }
  for (const [theme, css] of [['dark', dark], ['light', light]] as const) {
    const got = css.get(l);
    expect(got !== undefined && got.toLowerCase() === src[theme].toLowerCase(), `bold/styles.css --bl-${l} (${theme}) is ${got ?? 'missing'}, palette.ts says ${src[theme]}`);
  }
}

// --------------------------------------------- the stylesheets' other hand-kept copies of the lens ids
// Two more lists of the same ids sit in the two stylesheets, and neither had a check. A lens missing from
// either one fails silently at runtime rather than visibly: its shaped tab loses the number prefix, and its
// bold detail panel falls back to `--bl: var(--ink)` and draws in ink where every sibling lens has a colour.
const idsIn = (src: string, outer: RegExp, inner: RegExp) => new Set([...(outer.exec(src)?.[1] ?? '').matchAll(inner)].map((m) => m[1]));
/** shaped: the `:is(button[data-lens=...])` list that turns on each built-in tab's number prefix. */
const shapedIs = idsIn(shapedCss, /:is\(([^)]*data-lens[^)]*)\)/, /data-lens='(\w+)'/g);
/** bold: `[data-view='<l>'] #detail { --bl: var(--bl-<l>) }`, the per-view alias the panel reads. */
const boldView = new Set([...boldCss.matchAll(/\[data-view='(\w+)'\][^{]*\{\s*--bl: var\(--bl-(\w+)\)/g)].filter((m) => m[1] === m[2]).map((m) => m[1]));
for (const l of LENSES) {
  expect(shapedIs.has(l), `shaped/styles.css: ${l} is not in the :is(button[data-lens=...]) tab-prefix list`);
  expect(boldView.has(l), `bold/styles.css: no [data-view='${l}'] #detail rule aliasing --bl to --bl-${l}`);
}

// Both directions: a copy for an id that is no longer a BuiltinLens is dead CSS claiming a lens that is gone,
// and the per-lens loops above can only see the ids they look for.
const orphans = (name: string, keys: Iterable<string>) => { for (const k of keys) if (!LENSES.includes(k)) failures.push(`${name}: '${k}' is not a BuiltinLens id (stale copy, no source)`); };
orphans('shaped/styles.css tab icon', tabPath.keys());
orphans('shaped/styles.css :is() tab-prefix list', shapedIs);
orphans('bold/styles.css --bl- (dark)', dark.keys());
orphans('bold/styles.css --bl- (light)', light.keys());
orphans("bold/styles.css [data-view] --bl alias", boldView);

// shaped tab icon, --bl- dark, --bl- light, shaped :is() membership, bold [data-view] alias
const PER_LENS = 5;
const EXPECTED = LENSES.length * PER_LENS;
const total = agree + failures.length;
for (const f of failures) console.log('FAIL ' + f);
console.log(`${agree} of ${total} variant CSS copies agree with their source (expected ${EXPECTED}, ${PER_LENS} per lens for the ${LENSES.length} BuiltinLens ids in base/legacy.ts)`);
if (failures.length || total !== EXPECTED) process.exit(1);
