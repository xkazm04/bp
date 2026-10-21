// Source guard for the rail's flyouts (components/rail, components/rail/wide). The panels have no DOM test rig,
// so the rules an earlier keyboard review fixed by hand are pinned here against the source text, with comments
// stripped so a file that TALKS about a rule cannot stand in for one that follows it:
//   1. Roving tabindex: every role="option" in the rail is reachable by keyboard the ARIA 1.2 way - either a
//      CONDITIONAL tabIndex (0 on the selected option, -1 on the rest), or, in a combobox popup, an id its
//      input names through aria-activedescendant while focus stays in the box. A bare tabIndex={0} is the
//      defect: it costs one Tab per row to pass (docs/blueprint-ui.md, "keyboard throughout").
//   2. Every hand-rolled listbox in the rail (one that does not build its rows from shell.tsx's <Row>) owns a
//      key handler of its own, so the arrows walk ITS options instead of reaching the panel's own walk.
//   3. No scroll in the rail animates unconditionally: every `behavior:` is a function of the reduced-motion
//      query, never the bare literal 'smooth' (docs/blueprint-ui.md, "reduced motion honoured").
//   4. Focus is never dropped: a panel that moves focus to a row also has a fallback for "no row to move it to",
//      and the pane that fallback focuses is itself focusable (a .focus() on a div with no tabindex is a no-op,
//      which is the silent half of this bug).
// Run: node src/components/rail/check-keys.ts  (Node's type stripping; no build step). Exit 1 on any failure.
// Control: BP_RAIL_MUTATE='[["view.tsx","tabIndex={on ? 0 : -1}","tabIndex={0}"]]' rewrites the source text as
// it is read ([file suffix, find, replace] literals), so each assertion can be seen red on a seeded defect.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStripped } from '../../../../../scripts/lib/source.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MUTATE: [string, string, string][] = JSON.parse(process.env.BP_RAIL_MUTATE || '[]');
/** Source text with comments removed, and any seeded mutation applied. */
function read(rel: string): string {
  let src = readStripped(path.join(HERE, rel));
  for (const [suffix, find, repl] of MUTATE) if (rel.endsWith(suffix)) src = src.split(find).join(repl);
  return src;
}

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

const FILES = ['wide/shell.tsx', 'wide/view.tsx', 'wide/agents.tsx', 'wide/orders.tsx', 'wide/plan.tsx', 'wide/review.tsx', 'wide/steer.tsx', 'panels.tsx'];
const SRC = new Map(FILES.map((f) => [f, read(f)]));

/**
 * The text of the tag that holds `at`: back to the nearest `<` that opens a tag, forward to `at`. An attribute
 * list holds arrows (`() =>`), so no character class over `>` can delimit a tag - the scan runs backwards only.
 */
function tagAt(src: string, at: number): string {
  const i = src.lastIndexOf('<', at);
  return i < 0 ? '' : src.slice(i, at + 200);
}

// ---------------------------------------------------------------- 1. roving tabindex on every option
let options = 0;
for (const [f, src] of SRC) {
  for (const m of src.matchAll(/role="option"/g)) {
    options++;
    const tag = tagAt(src, m.index);
    const tab = /tabIndex=\{([^}]*)\}/.exec(tag);
    // a combobox popup's options are not tab stops at all: the input keeps focus and names the active one
    const activedesc = /aria-activedescendant/.test(src) && /\bid=\{/.test(tag);
    expect(!!tab || activedesc, `${f}: a role="option" that is neither a tab stop nor an aria-activedescendant target - no keyboard can reach it`);
    if (tab) expect(tab[1].trim() !== '0', `${f}: role="option" has a bare tabIndex={0}, so every option is a tab stop; expected a roving tabindex (0 on the selected one, -1 on the rest)`);
  }
}
expect(options >= 2, `the role="option" scan found ${options} options in the rail, expected at least 2 (shell.tsx's Row and view.tsx's "Whose desk") - the matcher has stopped biting`);

// ---------------------------------------------------------------- 2. a hand-rolled listbox owns its own walk
// view.tsx's "Whose desk" writes its own <li role="option"> rows instead of shell.tsx's <Row>, so the panel's
// section walk would otherwise read its arrow keys (useWalk swallows the key, which is what keeps them apart).
const view = SRC.get('wide/view.tsx') as string;
const who = /<ul[^]*?className="wb-who"[\s\S]{0,300}?>/.exec(view);
expect(!!who, 'view.tsx: no <ul className="wb-who"> found - the "Whose desk" listbox scan has stopped biting');
if (who) expect(/onKeyDown=\{/.test(who[0]), 'view.tsx: the "Whose desk" listbox has no onKeyDown of its own, so the arrows reach the section nav\'s walk instead of walking its own options');
expect((view.match(/useWalk\(/g) ?? []).length >= 2, `view.tsx calls useWalk ${(view.match(/useWalk\(/g) ?? []).length} time(s); expected 2 - one walk for the section nav and one for the "Whose desk" listbox`);

// ---------------------------------------------------------------- 3. no scroll travels under reduced motion
let scrolls = 0;
for (const [f, src] of SRC) {
  for (const m of src.matchAll(/behavior:\s*([^,}]+)/g)) {
    scrolls++;
    const v = m[1].trim();
    expect(v !== "'smooth'" && v !== '"smooth"', `${f}: a scroll with behavior: ${v} unconditionally - under prefers-reduced-motion it must not travel`);
    expect(/reduce|matchMedia|prefers-reduced-motion/.test(src), `${f}: sets a scroll behavior but never reads the reduced-motion preference`);
  }
}
expect(scrolls > 0, `the scroll-behavior scan found ${scrolls} sites in the rail, expected at least 1 (view.tsx's section jump) - the matcher has stopped biting`);

// ---------------------------------------------------------------- 4. no panel drops focus on <body>
const shell = SRC.get('wide/shell.tsx') as string;
const pane = /<div[^]*?className="wb-list"[\s\S]{0,300}?>/.exec(shell);
expect(!!pane, 'shell.tsx: no <div className="wb-list"> found - the list-pane scan has stopped biting');
if (pane) expect(/tabIndex=\{-1\}/.test(pane[0]), 'shell.tsx: the .wb-list pane is not focusable (tabIndex={-1}), so a panel handing it focus is a silent no-op and the reader lands on <body>');
// A panel that hands focus to a SUCCESSOR row - `next && <ref>.current?.querySelector('[data-row=...]')`, the
// shape that admits there may be no such row - owes a fallback for the render where there is none. shell.tsx's
// useWalk is deliberately not in this set: it walks a row that exists and unmounts nothing.
let movers = 0;
for (const [f, src] of SRC) {
  if (!/\w+\s*&&\s*\w+\.current\?\.querySelector[\s\S]{0,80}?\[data-row=/.test(src)) continue;
  movers++;
  expect(/\.current\?\.focus\(/.test(src), `${f}: hands focus to a successor row with no fallback - when no row can take over (the last item decided, or a refused write that reopens it) focus falls to <body>`);
}
expect(movers >= 1, `the focus-handoff scan found ${movers} panels that hand focus to a successor row, expected at least 1 (review.tsx's decide) - the matcher has stopped biting`);

if (failures.length) { console.error(`check-rail-keys: ${failures.length} failed (${held} held)`); for (const f of failures) console.error('  ' + f); process.exit(1); }
console.log(`check-rail-keys: ${held} expectations held (${options} role="option" sites, ${scrolls} scroll-behavior sites)`);
