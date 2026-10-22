// The app claims only what the tree backs. `npm run check:claims`.
//   1. the shots route advertises exactly the image types the tree writes and renders (no video/*): a type
//      nothing writes or plays is a promise with no implementation behind it (owner decision, 2026-10-22).
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

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nclaims ok');
