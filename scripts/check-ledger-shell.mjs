// The findings ledger's SHELL quality gate - the half of src/components/ledger that train/** already has one for.
//
// Why it exists: `scripts/check-train-quality.mjs` walks apps/web/src/components/ledger/train/** and
// packages/core/src/train/** and holds six rules over them. The shell those files render INSIDE - LedgerPage.tsx,
// ledger.css, ledger-theme.css, the two hooks, variants/**, waves/** and lens/** - is four times as many lines and
// had no check of its own but the typechecker. Four contexts render one ledger; three of them were gated and the
// shared surface was not, which is exactly where the three defects this gate pins were found.
//
// The rules, each printing `walked / checked / violations`:
//   clock   no shell file hand-formats a timestamp. packages/core/src/model/time.ts is the one place that formatting
//           lives (hhmmUTC / dayHhmmUTC / ymdUTC), and check-model.ts section (e) holds that rule over
//           packages/core/src/model/ ONLY - so the ledger could, and did, print a UTC instant with no zone on it
//           and render a corrupt stamp as its own raw bytes. Forbidden: an ISO slice at a date or time boundary,
//           `replace('T', ' ')`, getUTCHours/getUTCMinutes, and toLocaleTimeString/toLocaleDateString (which read
//           the viewer's zone, so two readers of one event read different times).
//   sticky  every sticky row the shell's CSS declares is PLACED where sticky can act. A sticky box is clamped to its
//           containing block (its parent's padding box), so a head row wrapped in a box of its own height has zero
//           travel and silently scrolls away - which is what `.lg-tr.hd` did inside a one-child
//           `<div role="rowgroup" className="lg-th">`. The sticky class list is DERIVED FROM THE CSS, not kept by
//           hand: every selector in the shell's stylesheets carrying `position: sticky` yields the classes it names,
//           and each JSX element carrying one must sit directly under its table/scroll parent (`role="table"`,
//           `<thead>`, `<table`, or the page root) - judged by indentation, which this tree formats consistently.
//   theme-ink  no shell module reads a role ledger-theme.css redefines off the document root or readTheme().
//   breakpoints  every `@container (max-width)` prelude in the shell's stylesheets names one width (.lg-body is the only container).
//   colour  no raw colour literal in the shell's stylesheets except ledger-theme.css, which IS the palette file
//           (docs/blueprint-ui.md: design tokens; the same rule check-train-quality holds for train/**'s CSS).
//           Comments are stripped first, or a file that TALKS about the rule and breaks it passes.
//
// Seed any of the three and watch it go red before trusting a clean run. Exit 1 on any violation, 2 when no file was
// walked (a gate that matches nothing reports a clean codebase in a voice indistinguishable from success), else 0.
// Run: node scripts/check-ledger-shell.mjs   (plain node, no deps)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments, stripBlock, blankBlock, blankComments } from './lib/source.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHELL = 'apps/web/src/components/ledger';
const TRAIN = SHELL + '/train';

const posix = (p) => p.replace(/\\/g, '/');
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
const rel = (f) => posix(path.relative(ROOT, f));
/** The shell: everything under the ledger except train/**, which check-train-quality.mjs owns. */
const shellFiles = walk(path.join(ROOT, SHELL)).filter((f) => !posix(f).includes('/train/'));
const code = shellFiles.filter((f) => /\.tsx?$/.test(f));
const css = shellFiles.filter((f) => /\.css$/.test(f));

let violations = 0;
const fail = (m) => { violations++; console.log('FAIL ' + m); };

// ---------------------------------------------------------------------------------------------------- clock
const CLOCK = [
  [/\.slice\(\s*0\s*,\s*(10|16|19)\s*\)/, 'an ISO slice at a date or time boundary - call ymdUTC / dayHhmmUTC (packages/core/src/model/time.ts)'],
  [/\.slice\(\s*11\s*,/, 'an ISO slice at the time-of-day boundary - call hhmmUTC'],
  [/replace\(\s*['"]T['"]\s*,/, "replacing an ISO 'T' by hand - call dayHhmmUTC"],
  [/getUTCHours|getUTCMinutes/, 'hand-building a clock time - call hhmmUTC'],
  [/toLocale(Time|Date)?String/, 'a locale/zone-dependent stamp - the tree prints UTC, so call the time.ts helpers'],
];
let clockChecked = 0;
for (const f of code) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  src.split('\n').forEach((ln, i) => {
    clockChecked++;
    for (const [re, why] of CLOCK) if (re.test(ln)) fail(`${rel(f)}:${i + 1}  ${ln.trim().slice(0, 110)}\n       ${why}`);
  });
}
console.log(`clock       ${code.length} shell .ts/.tsx walked / ${clockChecked} lines checked against ${CLOCK.length} hand-formatting shapes`);

// ---------------------------------------------------------------------------------------------------- sticky
/** Classes the shell's CSS puts `position: sticky` on, read off the stylesheets rather than kept by hand. */
const stickyClasses = new Set();
let stickySelectors = 0;
for (const f of css) {
  const src = stripBlock(fs.readFileSync(f, 'utf8'));
  for (const m of src.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    // `bottom:`-pinned boxes (the page's own bar) are not head rows inside a scroller and are left alone
    if (!/position\s*:\s*sticky/.test(m[2]) || !/(^|;)\s*top\s*:/.test(m[2])) continue;
    for (const sel of m[1].split(',')) {
      // a selector that ends in an element (`.lg-mx thead th`) is the browser's own table-sticky case, not ours
      const last = sel.trim().split(/\s+/).pop() ?? '';
      if (!last.startsWith('.')) continue;
      stickySelectors++;
      stickyClasses.add(last.split('.').filter(Boolean));
    }
  }
}
/** A parent whose box spans the rows the head row travels over - or the component's own root, whose placement is its
 *  caller's business and not this file's. */
const SPANS = /role=["']table["']|<thead\b|<table\b|className=["']lg-page|return \(|^\s*\) ?: ?\(|^\s*<>/;
const OPENS = /<[A-Za-z]/;                      // an element opening on this line
const SKIP = (t) => !t || t.startsWith('//') || t.startsWith('{/*') || t.startsWith('*') || t.startsWith('}') || t.startsWith(')');
let stickySites = 0;
for (const f of code) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((ln, i) => {
    const cls = /className=["']([^"']*)["']/.exec(ln);
    if (!cls) return;
    const have = new Set(cls[1].split(/\s+/).filter(Boolean));
    const set = [...stickyClasses].find((cs) => cs.every((c) => have.has(c)));
    if (!set) return;
    stickySites++;
    // walk back to the nearest spanning container; nothing may OPEN an element between it and the sticky row, or the
    // row sits in a box that is not the one it was meant to travel over. Indentation is not consulted: a wrapper
    // formatted at the row's own depth is exactly the mistake this rule exists to catch.
    const between = [];
    for (let j = i - 1; j >= 0; j--) {
      const t = lines[j].trimStart();
      if (SKIP(t)) continue;
      if (SPANS.test(lines[j])) {
        if (between.length) fail(`${rel(f)}:${i + 1}  a \`position: sticky\` row (.${set.join('.')}) is not its container's own child:\n       ${rel(f)}:${j + 1}  ${t.slice(0, 100)}\n       ${between.map((b) => `  wraps  ${rel(f)}:${b.n}  ${b.t.slice(0, 100)}`).join('\n       ')}\n       sticky is clamped to its containing block, so a wrapper of its own height gives the row no travel and it scrolls away: put it directly under its role="table" / <thead> / page root, as train/PackTable.tsx:54 does`);
        return;
      }
      if (OPENS.test(t)) between.push({ n: j + 1, t });
      if (between.length > 4) break;            // far from any container: not a head row this rule can judge
    }
  });
}
if (!stickyClasses.size) fail('sticky: no top-pinned `position: sticky` class was found in the shell stylesheets - the rule stopped matching');
console.log(`sticky      ${stickySelectors} top-pinned sticky selectors in ${css.length} shell stylesheets -> ${[...stickyClasses].map((c) => '.' + c.join('.')).join(', ')} / ${stickySites} JSX sites checked`);

// ---------------------------------------------------------------------------------------------------- colour
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(|\b(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|brown|cyan|magenta)\b\s*(?:;|\)|\s|$)/;
const PALETTE = 'ledger-theme.css';
let colourChecked = 0;
for (const f of css) {
  if (path.basename(f) === PALETTE) continue;
  const src = stripBlock(fs.readFileSync(f, 'utf8'));
  src.split('\n').forEach((ln, i) => {
    colourChecked++;
    // a var() reference is a TOKEN, not a literal (`var(--red)` must not read as the named colour `red`); the
    // property names `white-space`, `color-mix`, `color-scheme` and `border-collapse` are not colour literals either
    const bare = ln.replace(/var\(\s*--[\w-]+\s*(,[^()]*)?\)/g, 'T').replace(/white-space|color-mix|color-scheme|border-collapse/g, '');
    if (COLOUR.test(bare)) fail(`${rel(f)}:${i + 1}  ${ln.trim().slice(0, 110)}\n       a raw colour outside ${PALETTE}: use a token (docs/blueprint-ui.md, design tokens)`);
  });
}
console.log(`colour      ${css.length - 1} shell stylesheets (${PALETTE} is the palette) / ${colourChecked} lines checked`);

// ---------------------------------------------------------------------------------------------------- header
// The page sits under the app header. blueprint.css owns the header's geometry as --hdr-top / --hdr-h (one density
// override on .bp-compact); a literal `top: 74px` on .lg-page re-encodes it by hand and breaks silently when it moves.
let pageRules = 0, pageTokenised = 0;
for (const f of css) {
  const src = stripBlock(fs.readFileSync(f, 'utf8'));
  for (const m of src.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!m[1].split(',').some((s) => /(^|\s)\.lg-page\s*$/.test(s.trim()))) continue;
    const top = /(^|[;\s])top\s*:\s*([^;]+)/.exec(m[2]);
    if (!top) continue;
    pageRules++;
    if (/var\(\s*--hdr-h\b/.test(top[2])) pageTokenised++;
    else fail(`${rel(f)}  ${m[1].trim()} { top: ${top[2].trim()} }\n       a hand-computed header height: read var(--hdr-top) + var(--hdr-h) (blueprint.css owns them)`);
  }
}
if (!pageRules) fail('header: no top-placed .lg-page rule was found - the rule stopped matching');
console.log(`header      ${pageRules} top-placed .lg-page rule(s) / ${pageTokenised} read the header token`);

// ---------------------------------------------------------------------------------------------------- theme-ink
// ledger-theme.css redefines bp's role tokens (--ink, --accent, ...) on `.lg-page` only. A shell module that reads such a
// token off `document.documentElement`, or off the engine's readTheme() (which reads the root), gets the DRAWING SET's value,
// not the ledger's: the lens glyphs were painted #dff0ff beside labels set in #cfe3fb. Read it off the drawing's own element
// (variants/bits.tsx inkAt). The overridden set is read from the palette file's `.lg-page` blocks, not kept by hand.
const overridden = new Set();
for (const f of css) {
  if (path.basename(f) !== PALETTE) continue;
  for (const m of blankBlock(fs.readFileSync(f, 'utf8')).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!m[1].split(',').some((s) => /(^|\s)\.lg-page\s*$/.test(s.trim()))) continue;
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:/g)) overridden.add(d[1]);
  }
}
const camel = (tok) => tok.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase());
const overriddenFields = new Set([...overridden].map(camel));
let inkReads = 0;
for (const f of code) {
  const src = blankComments(fs.readFileSync(f, 'utf8')), lines = src.split('\n');
  const themes = [...new Set([...src.matchAll(/\b(\w+)\s*=\s*readTheme\([^)]*\)/g)].map((m) => m[1]))];
  lines.forEach((ln, i) => {
    for (const m of ln.matchAll(/getPropertyValue\(\s*['"](--[\w-]+)['"]/g)) {
      inkReads++;
      if (overridden.has(m[1]) && /document\.documentElement/.test(lines.slice(Math.max(0, i - 2), i + 1).join(' ')))
        fail(`${rel(f)}:${i + 1}  ${ln.trim().slice(0, 110)}\n       ${m[1]} is redefined on .lg-page (${PALETTE}); the document root holds the drawing set's value - resolve it on the drawing's own element (inkAt)`);
    }
    for (const t of themes) for (const m of ln.matchAll(new RegExp('\\b' + t + '\\.(?:theme\\.)?(\\w+)', 'g'))) {
      inkReads++;
      if (overriddenFields.has(m[1]))
        fail(`${rel(f)}:${i + 1}  ${ln.trim().slice(0, 110)}\n       readTheme() reads the document root, but ${PALETTE} redefines this role on .lg-page: take it from the drawing's own element (inkAt)`);
    }
  });
}
if (!overridden.size) fail(`theme-ink: no .lg-page custom property was found in ${PALETTE} - the rule stopped matching`);
console.log(`theme-ink   ${overridden.size} roles redefined on .lg-page / ${inkReads} root-token reads checked in ${code.length} shell modules`);

// ---------------------------------------------------------------------------------------------------- breakpoints
// `.lg-body` is the shell's one `container-type: inline-size`, so every `@container (max-width: N)` prelude in the shell's
// stylesheets resolves against the same width. Two different N there leave a band where the rows have folded into cards
// and the wave strip is still a tab row (760 vs 720 once). The set of widths is read off the preludes, not kept by hand.
const containerWidths = new Map();
let containerPreludes = 0;
for (const f of css) {
  const src = blankBlock(fs.readFileSync(f, 'utf8'));
  src.split('\n').forEach((ln, i) => {
    for (const m of ln.matchAll(/@container[^{]*\(\s*max-width\s*:\s*(\d+)px\s*\)/g)) {
      containerPreludes++;
      if (!containerWidths.has(m[1])) containerWidths.set(m[1], []);
      containerWidths.get(m[1]).push(`${rel(f)}:${i + 1}`);
    }
  });
}
if (!containerPreludes) fail('breakpoints: no `@container (max-width: Npx)` prelude was found in the shell stylesheets - the rule stopped matching');
if (containerWidths.size > 1) fail(`breakpoints: one container (.lg-body), ${containerWidths.size} fold widths: ${[...containerWidths].map(([w, at]) => `${w}px at ${at.join(', ')}`).join(' vs ')}\n       between them the rows are cards while the other fold is still unfolded: name one width`);
console.log(`breakpoints ${containerPreludes} @container preludes in ${css.length} shell stylesheets -> ${[...containerWidths.keys()].map((w) => w + 'px').join(', ')}`);

// ----------------------------------------------------------------------------------------------------
if (!code.length || !css.length) { console.log(`FAIL walked no shell file under ${SHELL} (train/** is check-train-quality.mjs's)`); process.exit(2); }
console.log(violations ? `\n${violations} violation(s)` : `\nledger shell clean: ${code.length} modules + ${css.length} stylesheets, ${TRAIN}/** excluded (check-train-quality.mjs)`);
process.exit(violations ? 1 : 0);
