// The app claims only what the tree backs. `npm run check:claims`.
//   1. the shots route advertises exactly the image types the tree writes and renders (no video/*): a type
//      nothing writes or plays is a promise with no implementation behind it (owner decision, 2026-10-22).
//   2. the browser floor declared in docs/blueprint-ui.md is not exceeded by any web API in apps/web/src.
//   3. the rail reads one urgency vocabulary (the shared URG map), not a second one of its own.
//   4. the General view id is spelled once (GENERAL), never as a bare literal in apps/web/src.
// Source is read with comments stripped, so a comment that talks about the rule cannot satisfy it.
import fs from 'node:fs';
import { blankComments } from './lib/source.ts';

let failed = 0;
const ok = (name: string, pass: boolean, detail = ''): void => {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${pass || !detail ? '' : `  (${detail})`}`);
};

// ------------------------------------------------------------------------------------------ shots route types
const ROUTE = 'packages/core/src/server/api/products/[slug]/shots/[...path]/route.ts';
const raw = fs.readFileSync(ROUTE, 'utf8');
const code = blankComments(raw);
const types = /const TYPES[^=]*=\s*\{([^}]*)\}/.exec(code);
const entries = types ? [...types[1].matchAll(/'(\.[a-z0-9]+)'\s*:\s*'([^']+)'/g)].map((m) => `${m[1]} ${m[2]}`) : [];
const ADVERTISED = ['.png image/png', '.jpg image/jpeg', '.jpeg image/jpeg', '.webp image/webp'];
ok('shots route: the TYPES map is found', !!types);
ok('shots route: advertises exactly png, jpg, jpeg and webp', entries.join('|') === ADVERTISED.join('|'), entries.join(', '));
ok('shots route: no video content type anywhere in its code', !/video\//.test(code));
ok('shots route: the header does not call a shot a recording', !/recording/i.test(raw.split('\n').slice(0, 5).join('\n')));

// ------------------------------------------------------------------------------------- the declared browser floor
// docs/blueprint-ui.md "Supported browsers" declares the floor; no web API newer than it may be used in apps/web/src.
type Ver = { chrome: number; safari: number; firefox: number };
const doc = fs.readFileSync('docs/blueprint-ui.md', 'utf8');
const fl = /\*\*Floor:\*\*\s*Chrome (\d+(?:\.\d+)?),\s*Safari (\d+(?:\.\d+)?),\s*Firefox (\d+(?:\.\d+)?)/.exec(doc);
ok('browser floor: declared in docs/blueprint-ui.md', !!fl);
const FLOOR: Ver = fl ? { chrome: +fl[1], safari: +fl[2], firefox: +fl[3] } : { chrome: 0, safari: 0, firefox: 0 };

/** First release of each browser with the API. Newer-than-floor uses are the failures; older ones are noted only here. */
const APIS: { name: string; re: RegExp; css?: boolean; min: Ver }[] = [
  { name: 'AbortSignal.any', re: /\bAbortSignal\.any\b/, min: { chrome: 116, safari: 17.4, firefox: 124 } },
  { name: 'AbortSignal.timeout', re: /\bAbortSignal\.timeout\b/, min: { chrome: 103, safari: 16, firefox: 100 } },
  { name: 'Promise.withResolvers', re: /\bPromise\.withResolvers\b/, min: { chrome: 119, safari: 17.4, firefox: 121 } },
  { name: 'Object.groupBy / Map.groupBy', re: /\b(?:Object|Map)\.groupBy\b/, min: { chrome: 117, safari: 18, firefox: 119 } },
  { name: 'Array.fromAsync', re: /\bArray\.fromAsync\b/, min: { chrome: 121, safari: 16.4, firefox: 115 } },
  { name: 'Set methods (union, intersection, ...)', re: /\.(?:union|intersection|symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\(/, min: { chrome: 122, safari: 17, firefox: 127 } },
  { name: 'Iterator helpers', re: /\bIterator\.from\b|\.values\(\)\.(?:map|filter|take|drop|toArray)\(/, min: { chrome: 122, safari: 18.4, firefox: 131 } },
  { name: 'RegExp.escape', re: /\bRegExp\.escape\b/, min: { chrome: 136, safari: 18.2, firefox: 134 } },
  { name: 'Uint8Array base64', re: /\bUint8Array\.fromBase64\b|\.toBase64\(/, min: { chrome: 140, safari: 18.2, firefox: 133 } },
  { name: '@starting-style', re: /@starting-style/, css: true, min: { chrome: 117, safari: 17.5, firefox: 129 } },
  { name: 'text-wrap: balance', re: /text-wrap\s*:\s*balance/, css: true, min: { chrome: 114, safari: 17.5, firefox: 121 } },
  { name: '@scope', re: /@scope\b/, css: true, min: { chrome: 118, safari: 17.4, firefox: 146 } },
  { name: 'field-sizing', re: /field-sizing\s*:/, css: true, min: { chrome: 123, safari: 26.2, firefox: 999 } },
  { name: 'anchor positioning', re: /anchor-name\s*:|position-anchor\s*:/, css: true, min: { chrome: 125, safari: 26, firefox: 147 } },
];

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); } else if (/\.(?:ts|tsx|css)$/.test(e.name)) out.push(p);
  }
  return out;
};
/** Every `<file>:<line> <api>` in `files` that needs a browser newer than `floor`. Comments are blanked, lines survive. */
function pastFloor(files: string[], floor: Ver): string[] {
  const hits: string[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const isCss = f.endsWith('.css');
    const text = isCss ? src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')) : blankComments(src);
    for (const a of APIS) {
      if (!!a.css !== isCss) continue;
      if (!(a.min.chrome > floor.chrome || a.min.safari > floor.safari || a.min.firefox > floor.firefox)) continue;
      const m = a.re.exec(text);
      if (m) hits.push(`${f}:${text.slice(0, m.index).split('\n').length} ${a.name}`);
    }
  }
  return hits;
}
const src = walk('apps/web/src');
ok('browser floor: apps/web/src was scanned', src.length > 100, `${src.length} files`);
const over = pastFloor(src, FLOOR);
ok('browser floor: no web API in apps/web/src is newer than the declared floor', over.length === 0, over.join('; '));
// The scan has to be able to fail: against a floor one release under the app's own newest call, it must see that call.
const probe = pastFloor(src, { ...FLOOR, chrome: 115 });
ok('browser floor: self-proof, a floor under Chrome 116 flags AbortSignal.any', probe.some((h) => h.includes('lib/scan/client.ts') && h.includes('AbortSignal.any')), probe.join('; '));
ok('browser floor: AbortSignal.any is still in use (the floor is real, not stale)', src.some((f) => /\bAbortSignal\.any\b/.test(blankComments(fs.readFileSync(f, 'utf8')))));

// ------------------------------------------------------------------------------- one urgency vocabulary on the rail
// The Review row and its detail kicker are on screen together: both read the shared URG map from Queue.tsx, and the
// rail holds no urgency map of its own (a second one drifted once: "Later" beside "When you can").
const REVIEW = 'apps/web/src/components/rail/wide/review.tsx';
const rev = blankComments(fs.readFileSync(REVIEW, 'utf8'));
ok('urgency: review.tsx imports the shared URG map', /import\s*\{[^}]*\bURG\b[^}]*\}\s*from\s*'\.\.\/\.\.\/Queue'/.test(rev));
ok('urgency: review.tsx declares no urgency map of its own', !/\b(?:const|let|var)\s+URG\w*\s*[:=]/.test(rev) && !/\bURG_\w+/.test(rev));
ok('urgency: the row and the kicker both read URG[d.urg]', (rev.match(/\bURG\[d\.urg\]/g) ?? []).length >= 2);
const railUrg = walk('apps/web/src/components/rail').filter((f) => /\.tsx?$/.test(f)).filter((f) => /\bRecord<[^>]*\['urg'\][^>]*>\s*=\s*\{/.test(blankComments(fs.readFileSync(f, 'utf8'))));
ok('urgency: no file under components/rail declares a Record keyed by urg', railUrg.length === 0, railUrg.join(', '));

// ------------------------------------------------------------------------- the General view id is declared once
// 'general' is the one view id that is not a lens. core declares it once, as GENERAL (data/types.ts), and
// GENERAL_SHEET.k (model/constants.ts) is the same word: if the two ever differ, one of them is the stale spelling.
const typesSrc = blankComments(fs.readFileSync('packages/core/src/data/types.ts', 'utf8'));
const sheetSrc = blankComments(fs.readFileSync('packages/core/src/model/constants.ts', 'utf8'));
const gConst = /export const GENERAL\s*=\s*'([^']+)'/.exec(typesSrc);
const gSheet = /GENERAL_SHEET[^=]*=\s*\{\s*k:\s*'([^']+)'/.exec(sheetSrc);
ok('general: core exports the GENERAL constant', !!gConst);
ok('general: GENERAL_SHEET.k is the same word as GENERAL', !!gConst && !!gSheet && gConst[1] === gSheet[1], `${gConst?.[1]} vs ${gSheet?.[1]}`);

// No bare 'general' in apps/web/src: it is GENERAL. Held back for the director (a sibling worker owns the phone sheet
// surfaces this wave): Phone.tsx, sheet/SheetBody.tsx, sheet/LensPanel.tsx, one literal each. Remove an entry here
// when its literal is replaced.
const HELD = ['apps/web/src/components/Phone.tsx', 'apps/web/src/components/sheet/SheetBody.tsx', 'apps/web/src/components/sheet/LensPanel.tsx'];
const bare: string[] = [];
for (const f of src.filter((x) => /\.tsx?$/.test(x))) {
  const text = blankComments(fs.readFileSync(f, 'utf8'));
  for (const m of text.matchAll(/(['"`])general\1/g)) {
    const at = `${f}:${text.slice(0, m.index).split('\n').length}`;
    if (!HELD.includes(f)) bare.push(at);
  }
}
ok('general: no bare General literal in apps/web/src outside the held files', bare.length === 0, bare.join('; '));
if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nclaims ok');
