// One byte-diff for the generated sample fixtures, shared by the generators that write them
// (scripts/fixtures/gen-kettle.mjs, scripts/fixtures/gen-swarm.mjs).
//
// Why it exists: a generator whose output nobody diffs is a fixture that has quietly stopped being generated.
// kettle-to-v3.ts and kettle-findings.mjs each carry a `--check` mode that regenerates in memory and compares
// against the committed bytes; gen-kettle.mjs and gen-swarm.mjs did not, so an edit to either one (or to
// scripts/lib/prng.ts, which seeds both) left `npm run check` fully green while the committed
// packages/core/data/kettle.json and swarm.json no longer matched what the generator produces. Measured
// 2026-10-21: one digit changed in gen-kettle.mjs's adoption range, 60 of 61 checks still passed.
//
// LF-normalised on purpose: a Windows checkout holds the committed JSON with CRLF while the generator writes
// LF, so a raw byte compare reports drift on line 1 of a file that reproduces exactly.
import fs from 'node:fs';

/** The OUT directory from argv: the first argument that is not a flag. */
export const outDirFrom = (argv: string[]): string | undefined => argv.find((a) => !a.startsWith('--'));

/** A path as the repo prints it: forward slashes, trimmed to the repo-relative part when it has one. */
const shown = (file: string): string => file.replace(/\\/g, '/').replace(/^.*\/(?=(?:packages|apps|scripts|docs|public)\/)/, '');

/**
 * `outputs` is [absolute file, generated text] pairs. With `check` false they are written; with `check` true
 * nothing is written, each is compared against what is on disk, and the process exits 1 on the first drift
 * (naming up to three differing lines per file) or 0 when every file reproduces.
 */
export function writeOrCheck(outputs: [string, string][], check: boolean, label: string): void {
  if (!check) {
    for (const [file, text] of outputs) fs.writeFileSync(file, text);
    return;
  }
  const lf = (s: string): string => s.replace(/\r\n/g, '\n');
  const report: string[] = [];
  for (const [file, text] of outputs) {
    const name = shown(file);
    let have: string[];
    try { have = lf(fs.readFileSync(file, 'utf8')).split('\n'); }
    catch { report.push(`  ${name}: not committed, so nothing proves the generator still writes it`); continue; }
    const want = lf(text).split('\n');
    const bad: string[] = [];
    for (let i = 0; i < Math.max(have.length, want.length) && bad.length < 3; i++) {
      if (have[i] !== want[i]) {
        bad.push(`    line ${i + 1}\n      committed: ${(have[i] ?? '(end)').slice(0, 110)}\n      generated: ${(want[i] ?? '(end)').slice(0, 110)}`);
      }
    }
    if (bad.length) report.push(`  ${name}: ${have.length} committed lines vs ${want.length} generated\n${bad.join('\n')}`);
  }
  if (report.length) {
    console.error(`DRIFT: the committed data is not what ${label} generates:\n${report.join('\n')}`);
    process.exit(1);
  }
  const names = outputs.map(([f]) => shown(f));
  console.log(`ok: ${names.join(' and ')} reproduce${names.length > 1 ? '' : 's'} exactly from ${label}`);
  process.exit(0);
}
