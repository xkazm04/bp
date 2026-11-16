// The app claims only what the tree backs. `npm run check:claims`.
//   1. the shots route advertises exactly the image types the tree writes and renders (no video/*): a type
//      nothing writes or plays is a promise with no implementation behind it (owner decision, 2026-10-22).
//   2. the browser floor declared in docs/blueprint-ui.md is not exceeded by any web API in apps/web/src.
//   3. the rail reads one urgency vocabulary (the shared URG map), not a second one of its own.
//   4. the General view id is spelled once (GENERAL), never as a bare literal in apps/web/src.
//   5. while machine.md records BpLink built and run in Unreal (the Kettle line), apps/vr/README.md, apps/vr/WP3.1.md,
//      plan.md and lynx-plan.md (the live plan, 2026-10-23) do not say it is unbuilt or unrun, unless that block also
//      carries a correction citing reading 14.
//   6. README.md names every page route the app ships (DERIVED from the page.tsx files under apps/web/src/app, route
//      groups dropped), and its Live products section names /projects as the way to add a repo, with
//      bp.products.local.json still named as the manual alternative.
//   7. docs/blueprint-ui.md's ledger section reads as the page (each claim read against the code): the Waves bullet says a
//      failed list shows it could not be read with its retry (WavesBar.tsx's words), not "a failing list reads as no
//      waves"; the top bar bullet gives the product line in LedgerPage.tsx's words and lists Every lens and Trust; the
//      In packs keys bullet names a key of every KEYMAP.packs binding, E as measure the selection, one scan per lens.
//      (DW-69, DW-67, DW-68; the found-it and code-side lines are guards, the rest red until the guide is corrected.)
//   8. the outcome watch's words match train/watch.ts: History's Watch outcomes tooltip states the condition (checkpoints
//      are queued when the Release tab is opened; one whose window passed before that is missed); the guide's watch rows and
//      watch.ts's header say day 30 has an open window while days 1 and 7 can be missed; the POST row lists the 409 for a
//      release carrying no item; the Release tab bullet names Watch outcomes. (DW-157, DW-153, DW-154)
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
// The held list is EMPTY: the three sites it carried (Phone.tsx:170, SheetBody.tsx:156,
// LensPanel.tsx:132) were finished by the director, because the fence that held them back -
// a sibling worker owning the phone sheet surfaces - turned out wider than it needed to be.
// Keep it empty. An entry here is a site the rule does not actually cover.
const HELD: string[] = [];
const bare: string[] = [];
for (const f of src.filter((x) => /\.tsx?$/.test(x))) {
  const text = blankComments(fs.readFileSync(f, 'utf8'));
  for (const m of text.matchAll(/(['"`])general\1/g)) {
    const at = `${f}:${text.slice(0, m.index).split('\n').length}`;
    if (!HELD.includes(f)) bare.push(at);
  }
}
ok('general: no bare General literal anywhere in apps/web/src', bare.length === 0, bare.join('; '));

// ---------------------------------------------------------------------- BpLink is not called unbuilt or unrun
// A reading that reaches machine.md and leaves the other VR docs asserting the world before it is the defect this
// catches (reading 10's check:bplink sentence needed a correction a wake later). A block is a paragraph together with the
// blockquotes right after it, or one table row. A stale phrase inside `code` or "quotes" is a quotation, not a claim; a
// stale phrase in a block that also cites reading 14 is a sentence kept on the record beside its correction.
// BP_CHECK_CLAIMS_SEED=vr-stale appends one stale sentence to an in-memory copy of apps/vr/README.md, and
// BP_CHECK_CLAIMS_SEED=vr-stale-lynx the same sentence to an in-memory copy of lynx-plan.md, so the live plan is proved
// scanned, not only listed.
const machine = fs.readFileSync('docs/concepts/vr-light-table/machine.md', 'utf8');
const ranInUnreal = /LogBpLink: BpLink: Kettle wings=5 \[/.test(machine);
ok('vr docs: machine.md records BpLink linked (UnrealEditor-BpLink.dll) and run (the Kettle line)',
  ranInUnreal && /Link \[x64\] UnrealEditor-BpLink\.dll/.test(machine));
const STALE: RegExp[] = [
  /not yet run on any UE host/i,
  /WP3\.1 is not run on any UE host/i,
  /WP3\.1 itself not run/i,
  /has not built against Unreal/i,
  /\bit has not run\b/i,
  /nothing has (?:booted the editor or )?run the module/i,
  /nothing is built or run/i,
  /nothing in\s+\S*\s*has (?:been )?compiled/i,
];
const CITES_14 = /\breadings? (?:\d+ (?:to|and) )?14\b/i;
/** `<file>:<line> "<phrase>"` for each stale phrase standing as a claim in a block that does not cite reading 14. */
function staleClaims(file: string, text: string): string[] {
  const blocks: { at: number; text: string }[] = [];
  let cur: { at: number; text: string } | null = null;
  let gap = false;
  text.split(/\r?\n/).forEach((l, i) => {
    if (!l.trim()) { gap = true; return; }
    if (/^\s*\|/.test(l)) { blocks.push({ at: i + 1, text: l }); cur = null; gap = false; return; }
    if (!cur || (gap && !/^\s*>/.test(l))) { cur = { at: i + 1, text: '' }; blocks.push(cur); }
    cur.text += `${l}\n`;
    gap = false;
  });
  const hits: string[] = [];
  for (const b of blocks) {
    if (CITES_14.test(b.text)) continue;
    const claim = b.text.replace(/`[^`]*`/g, '').replace(/"[^"]*"/g, '');
    for (const re of STALE) {
      const m = re.exec(claim);
      if (m) hits.push(`${file}:${b.at} "${m[0]}"`);
    }
  }
  return hits;
}
const LYNX_PLAN = 'docs/concepts/vr-light-table/lynx-plan.md';
const VR_DOCS = ['apps/vr/README.md', 'apps/vr/WP3.1.md', 'docs/concepts/vr-light-table/plan.md', LYNX_PLAN];
const seeds = (process.env.BP_CHECK_CLAIMS_SEED ?? '').split(',');
const SEEDED: Record<string, string> = { 'vr-stale': VR_DOCS[0], 'vr-stale-lynx': LYNX_PLAN };
const seededFiles = new Set(Object.entries(SEEDED).filter(([seed]) => seeds.includes(seed)).map(([, f]) => f));
const stale = VR_DOCS.flatMap((f) => {
  const text = fs.readFileSync(f, 'utf8');
  return staleClaims(f, seededFiles.has(f) ? `${text}\nWP3.1 is not run on any UE host.\n` : text);
});
ok('vr docs: no file says BpLink is unbuilt or unrun without a correction citing reading 14', !ranInUnreal || stale.length === 0, stale.join('; '));
// The rule has to be able to fail: README.md's 2026-10-22 evening text, with no reading-14 correction after it, is flagged.
const before14 = 'Lynx (2026-10-22) both failed.** WP3.1 is not run on any UE host. The\n\n'
  + '> **Correction 2026-10-22 (evening, Lynx).** "The module has not built against Unreal" is out of date.\n'
  + '> The headers are still not copied. Nothing has booted the editor or run the module.\n';
const probe14 = staleClaims('probe', before14);
ok('vr docs: self-proof, the pre-reading-14 README text is flagged twice and its quotation is not', probe14.length === 2, probe14.join('; '));
// This is the probe that fails under "CITES_14 tested on the whole text" and "blocks never split on a blank line": every real VR doc
// cites reading 14 somewhere, so either mutation lets one mention exempt the whole file and the rule would flag nothing.
const twoBlocks = 'WP3.1 is not run on any UE host, as reading 14 corrected.\n\nWP3.1 is not run on any UE host.\n';
const probeScope = staleClaims('scope', twoBlocks);
ok('vr docs: self-proof, a stale block citing reading 14 is spared and the next block without it is flagged alone',
  probeScope.length === 1 && probeScope[0].startsWith('scope:3 '), probeScope.join('; '));
// Every STALE entry has to match its own sentence (STALE_SENTENCES[i] is the real wording STALE[i] was adopted for), so a
// deleted or broken entry fails by name instead of silently narrowing the vocabulary.
const STALE_SENTENCES: string[] = [
  'WP3.1 is not yet run on any UE host.',
  'WP3.1 is not run on any UE host.',
  'WP3.1 itself not run.',
  'The module has not built against Unreal.',
  'It has not run.',
  'Nothing has booted the editor or run the module.',
  'Nothing is built or run.',
  'Nothing in apps/vr has been compiled.',
];
const unmatched = STALE.filter((re, i) => !re.test(STALE_SENTENCES[i] ?? ''));
ok('vr docs: self-proof, every STALE phrase matches its own sentence',
  STALE.length === STALE_SENTENCES.length && unmatched.length === 0,
  STALE.length !== STALE_SENTENCES.length
    ? `${STALE.length} STALE entries but ${STALE_SENTENCES.length} sentences`
    : `matched nothing: ${unmatched.map(String).join(', ')}`);
// ------------------------------------------------------------------------ the README names every shipped page
// The route list is derived from the tree, never written here: every page.tsx under apps/web/src/app is a page a reader
// can open, at its directory path with route groups "(x)" dropped. A route counts as named when README.md carries it as a
// whole path, not as the prefix of a longer one (/projects is not named by /projects/[slug]/onboarding).
const APP = 'apps/web/src/app';
const pages: string[] = [];
const walkPages = (dir: string): void => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== 'api' && !e.name.startsWith('_')) walkPages(p); } else if (e.name === 'page.tsx') pages.push(p);
  }
};
walkPages(APP);
const routeOf = (file: string): string => '/' + file.slice(APP.length + 1).split('/').slice(0, -1).filter((s) => !/^\(.*\)$/.test(s)).join('/');
const routes = pages.map(routeOf).sort();
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const namesRoute = (text: string, route: string) => new RegExp(`(?<![\\w/.\\]-])${reEsc(route)}(?![\\w/\\[-])`).test(text);
const readme = fs.readFileSync('README.md', 'utf8');
ok('readme routes: the page.tsx scan found the app\'s pages (/ and /variants among them)', routes.length >= 3 && routes.includes('/') && routes.includes('/variants'), routes.join(', '));
ok('readme routes: self-proof, a longer route does not name its prefix and the whole path does',
  !namesRoute('see `/projects/[slug]/onboarding`', '/projects') && namesRoute('open `/projects`, then `/projects/[slug]/onboarding`', '/projects')
  && namesRoute('`/v/[variant]`', '/v/[variant]'));
const unnamed = routes.filter((r) => !namesRoute(readme, r));
ok('readme routes: README.md names every page route under apps/web/src/app', unnamed.length === 0, `not named: ${unnamed.join(', ')}`);
const liveSec = (/^## Live products[ \t]*\r?$([\s\S]*?)(?=^## )/m.exec(readme) || ['', ''])[1];
ok('readme routes: the Live products section is found', liveSec.length > 0);
ok('readme routes: Live products names /projects as the way to add a repo', namesRoute(liveSec, '/projects'), 'the section only says to list the repo in bp.products.local.json');
ok('readme routes: Live products still names bp.products.local.json as the manual alternative', /bp\.products\.local\.json/.test(liveSec));
// ------------------------------------------------------------------------ the ledger section of the UI guide reads as the page
// Each claim is read against the code, never written here: the wave strip's failed-read words and its retry label from
// WavesBar.tsx, the top bar's product wording and its controls from LedgerPage.tsx, the In packs keys from KEYMAP.packs.
const UI_DOC = fs.readFileSync('docs/blueprint-ui.md', 'utf8');
/** A top-level bullet of the guide that opens with `- **<name>**`, up to the next top-level bullet or heading. */
const bulletOf = (text: string, name: string): string => {
  const at = text.search(new RegExp(`^- \\*\\*${reEsc(name)}\\*\\*`, 'm'));
  if (at < 0) return '';
  const rest = text.slice(at + 2), end = rest.search(/^(?:- |#)/m);
  return text.slice(at, end < 0 ? undefined : at + 2 + end);
};
const flat = (s: string) => s.replace(/\s+/g, ' ');
//   DW-69 the waves strip: a failed list says it could not be read and offers a retry; only a missing store reads as none
const WAVES_BAR = blankComments(fs.readFileSync('apps/web/src/components/ledger/waves/WavesBar.tsx', 'utf8'));
const waveErr = /data-wave="error">([^:{<]+?)\s*:/.exec(WAVES_BAR)?.[1]?.trim() ?? '';
const waveRetry = /className="wv-retry"[^>]*>([^<{]+)</.exec(WAVES_BAR)?.[1]?.trim() ?? '';
const wavesDoc = flat(bulletOf(UI_DOC, 'Waves'));
ok('ui guide waves: WavesBar.tsx shows a failed read in words with a retry button (the words are read from it)', /could not be read/.test(waveErr) && waveRetry.length > 0, `error ${JSON.stringify(waveErr)}, retry ${JSON.stringify(waveRetry)}`);
ok('ui guide waves: the Waves bullet is found', wavesDoc.length > 0);
ok('ui guide waves: the guide no longer says a failing list reads as no waves', !/failing list reads as no waves/i.test(flat(UI_DOC)), 'docs/blueprint-ui.md still says "a failing list reads as no waves"');
ok(`ui guide waves: the Waves bullet says a failed list shows that it could not be read, with ${waveRetry || 'its retry'}`,
  /could not be read/i.test(wavesDoc) && !!waveRetry && wavesDoc.includes(waveRetry), 'the bullet names neither the failed-read state nor its retry');
//   DW-67 the top bar: the product line in the page's words, and every control the bar renders
const PAGE = blankComments(fs.readFileSync('apps/web/src/components/ledger/LedgerPage.tsx', 'utf8'));
const prod = /className="lg-prod">[^<]*?\{live \? '([^']+)' : '([^']+)'\}/.exec(PAGE);
const topDoc = flat(bulletOf(UI_DOC, 'The top bar'));
ok('ui guide top bar: LedgerPage.tsx\'s product line is read (live wording | sample wording)', !!prod, 'no `live ? \'...\' : \'...\'` in the lg-prod span');
ok('ui guide top bar: the bullet is found', topDoc.length > 0);
ok(`ui guide top bar: the bullet gives the product line in the page's words (${prod ? prod[1] + ' | ' + prod[2] : '?'})`,
  !!prod && topDoc.includes(prod[1]) && topDoc.includes(prod[2]) && (prod[1] === 'live lens scan' || !topDoc.includes('live lens scan')),
  prod ? `the bullet says ${JSON.stringify((/`<product> · ([^`]*?)·/.exec(topDoc) ?? ['', '?'])[1].trim())}` : '');
const barControls: [string, RegExp][] = [['Every lens', /<AllLenses\b/], ['Trust', /<TrustPanel\b/]];
ok('ui guide top bar: LedgerPage renders Every lens and Trust in its top bar', barControls.every(([, re]) => re.test(PAGE)));
const unlisted = barControls.filter(([name, re]) => re.test(PAGE) && !new RegExp(`\\b${reEsc(name)}\\b`).test(topDoc)).map(([n]) => n);
ok('ui guide top bar: the bullet lists every control the bar renders (Every lens and Trust among them)', unlisted.length === 0, `not listed: ${unlisted.join(', ')}`);
//   DW-68 the In packs keys: every key KEYMAP.packs binds is named in the guide's In packs bullet, E as the measure
const { KEYMAP } = await import('../apps/web/src/components/ledger/train/keymap.ts');
const packsDoc = flat((/^ {2}- \*In packs\*:([\s\S]*?)(?=^ {2}- \*|^- )/m.exec(UI_DOC) ?? ['', ''])[1]);
/** How the guide spells a key: letters upper case and whole, arrows as glyphs, 1-3 as a range. */
const keyNamed = (k: string, text: string): boolean => {
  const word: Record<string, string> = { ' ': 'Space', Escape: 'Esc', ArrowDown: '↓', ArrowUp: '↑' };
  if (/^[1-9]$/.test(k)) return /\b1-3\b/.test(text) || new RegExp(`(?<![\\w-])${k}(?![\\w-])`).test(text);
  const w = word[k] ?? (k.length === 1 ? k.toUpperCase() : k);
  return /^\w+$/.test(w) ? new RegExp(`(?<![\\w/])${reEsc(w)}(?![\\w/])`).test(text) : text.includes(w);
};
ok('ui guide keys: the In packs bullet is found', packsDoc.length > 0);
const missingKeys = KEYMAP.packs.filter((b) => !b.keys.some((k) => keyNamed(k, packsDoc))).map((b) => `${b.keys.join('/')} (${b.action})`);
ok('ui guide keys: the In packs bullet names a key of every binding in KEYMAP.packs', missingKeys.length === 0, `not named: ${missingKeys.join(', ')}`);
const measure = KEYMAP.packs.find((b) => b.action === 'measure');
ok('ui guide keys: the In packs bullet says what E does: measures the selection, one scan per lens',
  !!measure && measure.keys.some((k) => keyNamed(k, packsDoc)) && /\bmeasur/i.test(packsDoc) && /one (?:selection )?scan per lens/i.test(packsDoc),
  measure ? `the bullet: ${JSON.stringify(packsDoc.trim())}` : 'KEYMAP.packs binds no measure key');
// ------------------------------------------------------------------------ the outcome watch: what is promised is what happens
// Read against packages/core/src/train/watch.ts (checkpointPlan: the last checkpoint has no next window, so it is queued late
// and never missed; newWatch: 409 for a release with no item) and server/watch.server.ts (only a read queues a checkpoint).
const WATCH_SRC = fs.readFileSync('packages/core/src/train/watch.ts', 'utf8');
ok('watch: the code still refuses a release with no item (409) and leaves the last checkpoint with no next window',
  /status: 409, error: `release \$\{relId\} carries no item to watch`/.test(WATCH_SRC) && /if \(next && Date\.parse\(next\.due\) <= nowMs/.test(WATCH_SRC));
const HIST = blankComments(fs.readFileSync('apps/web/src/components/ledger/train/release/History.tsx', 'utf8'));
const watchBtn = /data-role="tr-rel-watch"[\s\S]*?<\/button>/.exec(HIST)?.[0] ?? '';
ok('watch tooltip: the Watch outcomes button is found', /Watch outcomes/.test(watchBtn));
ok('watch tooltip: it states the condition: checkpoints are queued when the Release tab is opened', /open(ed|s)?\b.*Release tab|Release tab.*open/i.test(flat(watchBtn)), flat(watchBtn).slice(0, 300));
ok('watch tooltip: it says a checkpoint whose window passed before that is missed', /\bmissed\b/i.test(watchBtn), flat(watchBtn).slice(0, 300));
const rowOf = (verb: string) => flat(UI_DOC.split(/\r?\n/).find((l) => l.startsWith('| `' + verb + ' /api/products/<slug>/releases/watch`')) ?? '');
const getRow = rowOf('GET'), postRow = rowOf('POST');
ok('watch rows: both rows of the guide are found', getRow.length > 0 && postRow.length > 0);
ok('watch rows: the GET row says day 30 has an open window, queued late rather than missed', /day 30/i.test(getRow) && /open window/i.test(getRow) && /queued/i.test(getRow), getRow.slice(-400));
ok('watch rows: the GET row says days 1 and 7 can be missed', /days? 1 and (?:day )?7\b[^|]*\bmissed\b/i.test(getRow), getRow.slice(-400));
ok('watch rows: the POST row lists the 409 for a release carrying no item', /\*\*409\*\*[^|]*\bno item\b/i.test(postRow), postRow.slice(-300));
const watchHead = WATCH_SRC.split(/\r?\n/).filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/\s*/, '')).join(' ');
ok('watch header: it no longer says every passed checkpoint is "never queued late"', !/missed, never queued late/.test(watchHead), watchHead.slice(0, 300));
ok('watch header: it says day 30 has an open window while days 1 and 7 can be missed', /day 30[^.]*open window/i.test(watchHead) && /days? 1 and (?:day )?7\b[^.]*\bmissed\b/i.test(watchHead), watchHead.slice(0, 300));
ok('ui guide release tab: the bullet names the Watch outcomes control', /Watch outcomes/.test(bulletOf(UI_DOC, 'The Release tab')), 'the bullet never names it');
if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nclaims ok');
