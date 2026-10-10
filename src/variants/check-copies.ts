// Holds the variants' literal CSS copies to their TypeScript sources. Two facts have to be restated in CSS
// because the element that shows them is outside the variant's React tree:
//   - shaped/styles.css draws each built-in lens tab's icon from a data-URI copy of its path in
//     shaped/icons.ts (LENS_ICON -> ICONS[..].s); a copy may add sub-paths (the dial's static needle),
//     never change the icon's own;
//   - bold/styles.css repeats bold/palette.ts's ACCENT as --bl-<lens> per theme, because the sheet's current
//     panel cannot read --lens (see the comment there).
// Each copy is compared with its source; a copy or a source that cannot be found is a failure, not a skip.
// Run: node src/variants/check-copies.ts  (Node's type stripping; no build step). Exit 1 on any disagreement.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LENSES = ['business', 'design', 'development', 'operations', 'security', 'quality'];
/** Source text with comments removed, so a rule described in a comment cannot stand in for the rule. */
const read = (p: string) => fs.readFileSync(path.join(HERE, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');

let agree = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) agree++; else failures.push(what); };

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

const total = agree + failures.length;
for (const f of failures) console.log('FAIL ' + f);
console.log(`${agree} of ${total} variant CSS copies agree with their source (expected ${LENSES.length * 3})`);
if (failures.length || total !== LENSES.length * 3) process.exit(1);
