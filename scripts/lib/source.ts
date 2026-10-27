// Shared by the source-guard checks: read a file with its comments removed, so a rule described in a comment
// cannot stand in for the rule. Plain node (type stripping); import with the .ts extension.
//
// TWO MODES, and the choice is not cosmetic. The delete-mode strippers (stripComments, stripBlock) remove the
// comment's characters, so a multi-line comment collapses and every line number after it is wrong: measured on
// apps/web/src, 99 of 200 files shift, 620 lines are lost in all, worst -46 in engine/render/keyplan.ts, and all
// 179 font declarations in components/blueprint.css report the wrong anchor (the case on record: a declaration
// on blueprint.css:312 reported as :310). The keep-mode strippers (blankComments, blankBlock) overwrite the
// comment with spaces instead, so every offset, column and line number in the stripped text is still the file's
// own. Use keep-mode in any check that REPORTS a `<path>:<line>` anchor or reads an opt-out comment back out of
// the raw source by line; use delete-mode only when the stripped text is matched and nothing is located in it.
//
// `node scripts/lib/source.ts` (npm run check:source-strip) is the gate: run directly it pins both modes on a
// subject carrying a block comment, a line comment, code beside a comment, and a URL that looks like one.
import fs from 'node:fs';

/** Overwrite a run of text with spaces, keeping its newlines - so offsets and line numbers survive. */
const blank = (s: string): string => s.replace(/[^\n]/g, ' ');

/** Block comments, and line comments not preceded by `:` (URLs), a quote or a backslash. DELETES: lines shift. */
export const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
/** Block comments only (CSS has no line comments). DELETES: lines shift. */
export const stripBlock = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');
export const readStripped = (file: string): string => stripComments(fs.readFileSync(file, 'utf8'));

/** As `stripComments`, but BLANKED: every offset, column and line number is still the file's own. */
export const blankComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:'"`\\])(\/\/.*)$/gm, (_, a: string, b: string) => a + blank(b));
/** As `stripBlock`, but BLANKED (CSS and any text with no line comments): lines and offsets survive. */
export const blankBlock = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, blank);
/** Read a file with its comments blanked, for a check that reports anchors. */
export const readBlanked = (file: string): string => blankComments(fs.readFileSync(file, 'utf8'));

// ------------------------------------------------------------------------------------------------- the gate
if (import.meta.main) {
  let failed = 0;
  const check = (name: string, ok: boolean, detail = ''): void => {
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
  };
  const subject = [
    'const a = 1; // tail',
    '/* a block',
    '   over three',
    '   lines */',
    "const url = 'https://example.com/x';",
    'const b = 2;',
    '/* one-liner */ const c = 3;',
    'const d = 4;',
  ].join('\n');
  const lines = (s: string): number => s.split('\n').length;

  check('blankComments keeps every line', lines(blankComments(subject)) === lines(subject), `${lines(blankComments(subject))} vs ${lines(subject)}`);
  check('blankBlock keeps every line', lines(blankBlock(subject)) === lines(subject), `${lines(blankBlock(subject))} vs ${lines(subject)}`);
  check('stripComments drops lines (delete-mode, as documented)', lines(stripComments(subject)) < lines(subject), `${lines(stripComments(subject))} vs ${lines(subject)}`);

  const kept = blankComments(subject);
  const anchor = (s: string, needle: string): number => s.slice(0, s.indexOf(needle)).split('\n').length;
  check('blankComments: `const d` still anchors at line 8', anchor(kept, 'const d') === 8, String(anchor(kept, 'const d')));
  check('stripComments: `const d` anchors WRONG', anchor(stripComments(subject), 'const d') !== 8, String(anchor(stripComments(subject), 'const d')));

  check('both modes remove the line comment', !blankComments(subject).includes('tail') && !stripComments(subject).includes('tail'));
  check('both modes remove the block comment', !blankComments(subject).includes('over three') && !stripComments(subject).includes('over three'));
  check('neither mode eats a `//` inside a URL string', blankComments(subject).includes('https://example.com/x') && stripComments(subject).includes('https://example.com/x'));
  check('blankComments keeps the code beside a one-line block comment', /^ {16}const c = 3;$/m.test(blankComments(subject)), JSON.stringify(blankComments(subject).split('\n')[6]));
  check('blankBlock leaves line comments alone', blankBlock(subject).includes('// tail'));
  check('column is preserved: `const b` starts at column 0', blankComments(subject).split('\n')[5] === 'const b = 2;');

  console.log(`\ncheck-source-strip: ${11 - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
