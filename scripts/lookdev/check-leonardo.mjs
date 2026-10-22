#!/usr/bin/env node
// leonardo.mjs's local guards, through its exports only: no generation, no network (fetch is stubbed), no .env read.
//   redact    the key never survives into text bound for log.jsonl or stdout (an API error that echoed it)
//   reply     call() (fetch stubbed) redacts a reply before any cut, and sends the key in the Bearer header only
//   backdrop  an entry with `rules` (city-backdrop) swaps the sheet rules for its own and still restates the style block
//   prop      prop prompts restate the style block's palette and materials, carry the TRELLIS sheet rules, and cover every variant
//   cap       a call that would pass the stop or HARD_CAP is refused; a prop --out stays inside apps/vr/ArtSource
//   cost      the figure the cap is fed is the WORST measured credit figure at that quality, never the first
//   report    `total`'s byQuality breakdown plus priorSpend adds up to nightTotal, the figure the cap refuses on
//   out       --out stays inside lookdev/: a name that would resolve outside it is refused before any call
//   egress    redact() is applied at every place text leaves gen() for log.jsonl or stdout (source guard)
//   source    a source guard over leonardo.mjs: it names no absolute machine path, so the .env it reads for
//             LEONARDO_API_KEY is THIS checkout's and no other one's. Comments are stripped before the match.
// Run: node scripts/lookdev/check-leonardo.mjs   Exit 1 on any failure.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import { artFile, call, composePropPrompt, composePrompt, expectedCost, loggedFile, nightTotal, outFile, parseSize, redact, spendWindow, windowReport, withinCap } from './leonardo.mjs';

let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };
const throws = (f) => { try { f(); return false; } catch { return true; } };

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/concepts/vr-light-table/lookdev');
const fake = '00000000-test-0000-key0-000000000000';

const echoed = `POST https://cloud.leonardo.ai/api/rest/v2/generations -> HTTP 401: {"error":"bad token Bearer ${fake}","again":"${fake}"}`;
check('redact: every copy of the key is gone', !redact(echoed, fake).includes(fake), redact(echoed, fake));
check('redact: the rest of the message stays', redact(echoed, fake).includes('HTTP 401'));
check('redact: no key, text unchanged', redact('plain', '') === 'plain' && redact('plain', undefined) === 'plain');

// reply: everything call() hands back - the parsed reply, or the Error for a failed one - is text gen() may cut and log.
// gen() cuts AFTER redact() for entry.error, but its own 'no generationId' message cuts the reply at 300 characters
// first, and a cut through the key leaves a prefix that replaceAll cannot match. So call() must redact the reply body
// before anything parses or cuts it: no piece of the key may be in what it returns or throws. fetch is stubbed here,
// so no request leaves this process. Every cut position the key could straddle is tried, ok and failed, JSON and text.
const seeded = 'K3yS33d-cut0-4b2a-9d8e-0123456789ab';
const realFetch = globalThis.fetch;
const sent = [], replyLeaks = [];
try {
  for (const status of [200, 401]) for (const json of [true, false]) for (let pad = 250; pad < 520; pad++) {
    const echo = `${'x'.repeat(pad)} Bearer ${seeded}`;
    globalThis.fetch = async (url, init) => { sent.push({ url: String(url), init }); return new Response(json ? JSON.stringify({ error: echo }) : echo, { status }); };
    let out;
    try { out = JSON.stringify(await call(seeded, 'POST', 'https://stub.invalid/v2/generations', { prompt: 'p' })); } catch (err) { out = String(err?.message ?? err); }
    if (out.includes(seeded.slice(0, 6))) replyLeaks.push(`${status} ${json ? 'json' : 'text'} pad ${pad}`);
  }
} finally { globalThis.fetch = realFetch; }
check('reply: no piece of the key is in anything call() returns or throws, however the reply is cut', replyLeaks.length === 0, `${replyLeaks.length} leak(s), first ${replyLeaks[0]}`);
check('reply: the key went out in the authorization header only, never in the url or the body',
  sent.length > 0 && sent.every((s) => s.init.headers.authorization === `Bearer ${seeded}` && !s.url.includes(seeded) && !String(s.init.body).includes(seeded)));

check('out: an explore frame lands under lookdev/explore', outFile('explore/x-a-s1-low.png') === path.join(DIR, 'explore', 'x-a-s1-low.png'), outFile('explore/x-a-s1-low.png'));
check('out: a pick name lands under lookdev/', outFile('00-hero.jpg') === path.join(DIR, '00-hero.jpg'));
for (const bad of ['../../../package.json', '..\\..\\x.png', 'explore/../../x.png', path.resolve('/tmp/x.png'), 'C:/Windows/x.png', '']) {
  check(`out: ${JSON.stringify(bad)} is refused`, throws(() => outFile(bad)));
}

const style = JSON.parse(fs.readFileSync(path.join(DIR, 'style-block.json'), 'utf8'));
const props = JSON.parse(fs.readFileSync(path.join(DIR, 'props.json'), 'utf8'));
const expected = { 'lamp-agent': ['A', 'B', 'C', 'D'], 'studio-shelves': ['A', 'B'], 'studio-desk-lamp': ['A', 'B'], 'studio-mug': ['A', 'B'], 'studio-drawing-tubes': ['A', 'B'], 'studio-pinned-drawings': ['A', 'B'] };
// `expected` is a hand-typed list and must stay one - a test that read props.json's variants to decide what props.json
// should contain would assert nothing. What it may NOT do is quietly cover less than props.json holds, so the ground
// truth (props.json's own keys) is reconciled against the two lists that have coverage: `expected`, and the
// city-backdrop block further down, which is the only entry with its own `rules` and so needs its own assertions.
const SHEET_PROPS = Object.keys(expected), RULES_PROPS = ['city-backdrop'];
const uncovered = Object.keys(props.props).filter((id) => !SHEET_PROPS.includes(id) && !RULES_PROPS.includes(id));
const vanished = [...SHEET_PROPS, ...RULES_PROPS].filter((id) => !(id in props.props));
check(`prop: every one of the ${Object.keys(props.props).length} props.json entries has coverage here`, uncovered.length === 0, `no checks for: ${uncovered.join(', ')}`);
check('prop: every prop this file claims to check is still in props.json', vanished.length === 0, `gone from props.json: ${vanished.join(', ')}`);
check('prop: the rules-mode list is exactly the entries that carry a `rules` field', JSON.stringify(Object.keys(props.props).filter((id) => props.props[id].rules).sort()) === JSON.stringify([...RULES_PROPS].sort()),
  `rules in props.json: ${Object.keys(props.props).filter((id) => props.props[id].rules).join(', ')}`);
for (const [id, variants] of Object.entries(expected)) {
  check(`prop: ${id} has variants ${variants.join('')}`, JSON.stringify(Object.keys(props.props[id]?.variants ?? {})) === JSON.stringify(variants));
  for (const v of variants) {
    const text = composePropPrompt(id, v);
    check(`prop: ${id} ${v} restates every palette colour`, style.palette.every((p) => text.includes(p.name) && p.hex.every((h) => text.includes(h))));
    check(`prop: ${id} ${v} restates finish, never list and materials`, text.includes(style.finish) && style.never.every((n) => text.includes(n)) && text.includes(props.props[id].materials));
    check(`prop: ${id} ${v} is a TRELLIS sheet (one object, grey ground, no text) without scene framing`, text.includes(props.sheet) && /mid-grey/.test(text) && /no text/.test(text) && !text.includes(style.technique) && !text.includes(style.subjectLock));
  }
}
for (const v of ['A', 'B']) {
  const text = composePropPrompt('city-backdrop', v);
  const rules = props.props['city-backdrop'].rules;
  check(`backdrop: city-backdrop ${v} uses its own rules, not the one-object sheet rules`, text.includes(rules) && !text.includes(props.sheet) && !/mid-grey|Concept sheet|Sheet rules/.test(text));
  check(`backdrop: city-backdrop ${v} asks for a wide dim skyline with no foreground, frame or text`, /wide/.test(rules) && /dim/.test(rules) && /no foreground/.test(rules) && /no window frame/.test(rules) && /no text/.test(rules) && /seamlessly/.test(rules));
  check(`backdrop: city-backdrop ${v} restates the palette, finish and never list`, style.palette.every((x) => text.includes(x.name) && x.hex.every((h) => text.includes(h))) && text.includes(style.finish) && style.never.every((n) => text.includes(n)));
}
check('backdrop: a sheet prop is unchanged by the rules field', composePropPrompt('lamp-agent', 'A').includes(`Sheet rules: ${props.sheet}`));
check('size: the 2048x768 backdrop size parses', parseSize('2048x768').join() === '2048,768');
check('prop: an unknown prop is refused', throws(() => composePropPrompt('nope', 'A')));
check('prop: an unknown variant is refused', throws(() => composePropPrompt('lamp-agent', 'Z')));
check('prop: state composition is unchanged (still carries the scene framing)', composePrompt('00-hero', 'a').includes(style.technique));
check('prop: --out lands under apps/vr/ArtSource', artFile('lamp-agent/options/A.png').replaceAll(path.sep, '/').endsWith('apps/vr/ArtSource/lamp-agent/options/A.png'));
for (const bad of ['../x.png', '..\\x.png', 'C:/Windows/x.png', '']) check(`prop: --out ${JSON.stringify(bad)} is refused`, throws(() => artFile(bad)));
check('size: 1024x1024 parses', parseSize('1024x1024').join() === '1024,1024');
check('size: junk is refused', throws(() => parseSize('big')) && throws(() => parseSize('10x10')));
check('cap: a call within the stop goes ahead', withinCap(150, 6, 160));
check('cap: a call over --stop-at is refused', !withinCap(155, 6, 160));
check('cap: --stop-at cannot raise HARD_CAP', !withinCap(386, 6, 9999) && withinCap(384, 6, 9999));
check('cap: at the cap nothing more is allowed', !withinCap(390, 6));

// cost: the figure the cap is FED. withinCap is tested five ways above, but a cap given too small a cost refuses
// nothing it should, so the worst measured credit figure per quality is the only safe input. Cost rises with size
// (measured in log.jsonl: LOW 6 at 1376x768 and 1024x1024, 8 at 2048x768; MEDIUM 14 and 20), and expectedCost cannot
// see --size, so it must take the maximum and not the first entry it finds.
const lo = (credits, extra = {}) => ({ quality: 'LOW', credits, creditsSource: 'api', ...extra });
const cheapFirst = [lo(6), lo(8), lo(6)];
check('cost: the worst measured figure at a quality wins, not the first', expectedCost('LOW', cheapFirst).cost === 8, `${expectedCost('LOW', cheapFirst).cost}`);
check('cost: order does not change it', expectedCost('LOW', [lo(8), lo(6)]).cost === 8 && expectedCost('LOW', [lo(6), lo(8)]).cost === 8);
check('cost: a fallback entry is not a measurement', expectedCost('LOW', [lo(99, { creditsSource: 'fallback' }), lo(6)]).cost === 6);
check('cost: a zero-credit entry is not a measurement', expectedCost('LOW', [lo(0), lo(6)]).cost === 6);
check('cost: with nothing measured, LOW takes its worst measured constant (8)', expectedCost('LOW', []).cost === 8 && expectedCost('LOW', []).measured === true);
check('cost: an unmeasured quality says so', expectedCost('MEDIUM', []).measured === false && expectedCost('HIGH', []).measured === false);
check('cost: the 2048x768 MEDIUM figure is what gates a MEDIUM call', expectedCost('MEDIUM', [{ quality: 'MEDIUM', credits: 14, creditsSource: 'api' }, { quality: 'MEDIUM', credits: 20, creditsSource: 'api' }]).cost === 20);
// The two together: the cap must refuse the call that the cheapest-first figure would have let through.
// 383 + 8 = 391 passes HARD_CAP 390; 383 + 6 = 389 does not. So the cheapest-first figure would have spent over the cap.
check('cost+cap: a wide LOW call 383 into the window is refused, where the 6-credit figure allowed it',
  !withinCap(383, expectedCost('LOW', cheapFirst).cost) && withinCap(383, 6), `cost=${expectedCost('LOW', cheapFirst).cost}`);
check('cost+cap: the real log gates a wide MEDIUM call at its own worst figure',
  expectedCost('MEDIUM', fs.readFileSync(path.join(DIR, 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).cost === 20);

const at = (iso) => new Date(iso);
const e = (time, credits) => ({ time, credits });
check('window: 07:59Z is still the previous window', spendWindow(at('2026-10-21T07:59:00Z')).from === '2026-10-20T08:00:00.000Z');
check('window: 08:00Z opens the new window', spendWindow(at('2026-10-21T08:00:00Z')).from === '2026-10-21T08:00:00.000Z' && spendWindow(at('2026-10-21T08:00:00Z')).to === '2026-10-22T08:00:00.000Z');
const prev = [e('2026-10-20T20:58:00Z', 390)];
check('window: an entry from the previous window does not count', nightTotal(prev, at('2026-10-21T09:00:00Z')) === 0);
check('window: PRIOR_SPEND counts only in the 2026-10-20 window', nightTotal([], at('2026-10-20T21:00:00Z')) === 6 && nightTotal([], at('2026-10-21T09:00:00Z')) === 0);
check('window: 07:59Z counts in the previous window', nightTotal([e('2026-10-21T07:59:00Z', 6)], at('2026-10-21T07:59:30Z')) === 12 && nightTotal([e('2026-10-21T07:59:00Z', 6)], at('2026-10-21T08:00:00Z')) === 0);
check('window: 08:00Z counts in the new window', nightTotal([e('2026-10-21T08:00:00Z', 6)], at('2026-10-21T08:00:01Z')) === 6 && nightTotal([e('2026-10-21T08:00:00Z', 6)], at('2026-10-21T07:59:59Z')) === 6);
check('window: the cap refuses a call that would pass 400 inside one window', !withinCap(nightTotal([e('2026-10-21T09:00:00Z', 386)], at('2026-10-21T10:00:00Z')), 6) && withinCap(nightTotal([e('2026-10-21T09:00:00Z', 384)], at('2026-10-21T10:00:00Z')), 6));
check('window: --stop-at still refuses inside the window', !withinCap(nightTotal([e('2026-10-21T09:00:00Z', 156)], at('2026-10-21T10:00:00Z')), 6, 160));

// Source guard. leonardo.mjs reads the LEONARDO_API_KEY out of an untracked .env, so WHICH .env it opens is a
// security property, not a convenience: an absolute path means a second checkout of this repo reads the first
// checkout's secret instead of its own, and that a key is missing is the only signal the operator would get.
// Comments go first - the header TALKS about .env, and a matcher over raw text would be satisfied by prose (SKILL 7.8).
const LEO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'leonardo.mjs');
const nocomment = fs.readFileSync(LEO, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"\w])\/\/.*$/, '$1')).join('\n');
const abs = [...nocomment.matchAll(/['"`][A-Za-z]:[\\/][^'"`]*/g)].map((m) => m[0]);
check('source: leonardo.mjs names no absolute machine path (the .env it reads is this checkout\'s)', abs.length === 0, abs.join(' , '));
check('source: the key comes from an .env resolved against the module\'s own root', /ENV_FILE\s*=\s*path\.(join|resolve)\(ROOT,/.test(nocomment));

// report: the breakdown `total` prints must add up to the figure the cap refuses on, in every window. The real
// log is the subject, plus the two windows that matter: 2026-10-20, where PRIOR_SPEND counts, and 2026-10-21.
const realLog = fs.readFileSync(path.join(DIR, 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const adds = (r) => Object.values(r.byQuality).reduce((n, q) => n + q.credits, 0) + r.priorSpend === r.nightTotal;
for (const iso of ['2026-10-20T21:00:00Z', '2026-10-21T12:00:00Z', '2026-10-21T07:59:00Z', '2026-10-22T09:00:00Z']) {
  const r = windowReport(realLog, new Date(iso));
  check(`report: at ${iso} the byQuality breakdown plus priorSpend equals nightTotal`, adds(r),
    `${Object.values(r.byQuality).reduce((n, q) => n + q.credits, 0)} + ${r.priorSpend} vs ${r.nightTotal}`);
}
const prior = windowReport(realLog, new Date('2026-10-20T21:00:00Z'));
check('report: the 2026-10-20 window names PRIOR_SPEND as its own 6 credits', prior.priorSpend === 6, `${prior.priorSpend}`);
check('report: a later window does not carry PRIOR_SPEND', windowReport(realLog, new Date('2026-10-21T12:00:00Z')).priorSpend === 0);
check('report: the breakdown counts the same calls nightTotal does',
  Object.values(prior.byQuality).reduce((n, q) => n + q.calls, 0) === realLog.filter((e) => e.time >= prior.window.from && e.time < prior.window.to).length);
check('report: nightTotal is the figure the cap is asked about', prior.cap === 390 && !withinCap(prior.nightTotal, 1, prior.cap), `nightTotal ${prior.nightTotal} of ${prior.cap}`);

// file: the committed log must not point at a machine path. Four city-backdrop lines (the first 66 entries) predate
// loggedFile and carry an absolute temp path; the log is append-only, so they are grandfathered by line number and
// no later line may join them. A committed entry's file is repo-relative (not asserted to still exist: 13 were moved or renamed after logging).
const ISABS = (f) => /^[A-Za-z]:[\\/]|^\//.test(String(f ?? ''));
const LEGACY_LINES = 66;
const absLines = realLog.map((en, i) => (ISABS(en.file) ? i + 1 : 0)).filter(Boolean);
check('file: no log entry after the first 66 lines records an absolute machine path', absLines.every((n) => n <= LEGACY_LINES), `lines ${absLines.join(',')}`);
check('file: every committed entry names a repo-relative file', realLog.filter((en) => en.committed).every((en) => !ISABS(en.file)));
const tmpDest = path.join(os.tmpdir(), 'bp-lookdev', 'x-A-s1-low.jpg');
check('file: an uncommitted frame logs its basename and a note, never the temp path',
  loggedFile(tmpDest, false).file === 'x-A-s1-low.jpg' && !ISABS(loggedFile(tmpDest, false).file) && /not committed/.test(loggedFile(tmpDest, false).fileNote ?? ''), JSON.stringify(loggedFile(tmpDest, false)));
check('file: a committed frame logs a repo-relative path', loggedFile(path.join(DIR, 'explore', 'x.png'), true).file === 'docs/concepts/vr-light-table/lookdev/explore/x.png', loggedFile(path.join(DIR, 'explore', 'x.png'), true).file);

check('file: gen() takes entry.file from loggedFile and assigns it nowhere else', /Object\.assign\(entry,\s*loggedFile\(dest,\s*entry\.committed\)\)/.test(nocomment) && !/entry\.file\s*=[^=]/.test(nocomment));

// egress: redact() is correct (tested above) but only matters if every path that carries text out of gen() passes
// through it. Egress = what reaches log.jsonl (the entry, which is JSON.stringify'd whole) or stdout/stderr (console.*).
// The only attacker-shaped text is an exception message (it can embed an API error body) and the key itself.
// Matched over the comment-stripped source, so prose in the header cannot satisfy any of it.
const genStart = nocomment.indexOf('async function gen()');
const genEnd = nocomment.indexOf("\nif (cmd === 'gen')");
const genBody = genStart >= 0 && genEnd > genStart ? nocomment.slice(genStart, genEnd) : '';
check('egress: gen() body was found in the stripped source', genBody.length > 500, `${genStart}..${genEnd}`);
const msgUses = [...genBody.matchAll(/\be\.message\b/g)];
check('egress: every use of the caught error message in gen() is the argument of redact(', msgUses.length > 0 && msgUses.every((m) => genBody.slice(Math.max(0, m.index - 7), m.index) === 'redact('), `${msgUses.length} use(s)`);
const errAssigns = [...genBody.matchAll(/entry\.error\s*=[^=;]*;/g)].map((m) => m[0]);
check('egress: every entry.error assignment passes through redact(..., key)', errAssigns.length > 0 && errAssigns.every((a) => /redact\([^;]*,\s*key\)/.test(a)), errAssigns.join(' | '));
const consoleCalls = [...genBody.matchAll(/console\.(?:log|error|warn|info|debug)\([^;]*;/g)].map((m) => m[0]);
const leaky = consoleCalls.filter((c) => /\b(?:e|err|created|g|res|json|body|key)\b(?!\w*\s*:)|\be\.message\b/.test(c.replace(/\$\{entry\.error\}/g, '')));
check('egress: no console call in gen() prints an exception, a response object, the request body or the key', consoleCalls.length > 0 && leaky.length === 0, leaky.join(' | '));
const keyTemplates = [...nocomment.matchAll(/`[^`]*\$\{key\}[^`]*`/g)].map((m) => m[0]);
check('egress: the key is interpolated into exactly one string, the Bearer header', keyTemplates.length === 1 && /^`Bearer \$\{key\}`$/.test(keyTemplates[0]), keyTemplates.join(' | '));
const appends = [...nocomment.matchAll(/appendFileSync\([^;]*;/g)].map((m) => m[0]);
check('egress: the log is appended to once, with the entry alone', appends.length === 1 && /appendFileSync\(LOG,\s*JSON\.stringify\(entry\)\s*\+\s*'\\n'\)/.test(appends[0]), appends.join(' | '));

// unverified: a TIMEOUT records the pre-call estimate as creditsSource 'fallback'. It counts inside nightTotal (the
// cap's figure), so the report that explains nightTotal has to separate it from measured spend. gen() itself cannot
// be driven here without reading the key from .env, so the rung is windowReport over a synthetic timed-out entry.
const tNow = new Date('2026-10-21T12:00:00Z');
const timedOut = { time: '2026-10-21T09:00:00Z', quality: 'LOW', status: 'TIMEOUT', credits: 8, creditsSource: 'fallback', generationId: 'x' };
const measuredE = { time: '2026-10-21T09:05:00Z', quality: 'LOW', status: 'COMPLETE', credits: 6, creditsSource: 'api' };
const tr = windowReport([timedOut, measuredE], tNow);
check('unverified: a timed-out fallback entry still counts toward the figure the cap refuses on', tr.nightTotal === 14, `${tr.nightTotal}`);
check('unverified: the report separates the guessed credits from the measured ones', tr.unverified?.credits === 8 && tr.unverified?.calls === 1, JSON.stringify(tr.unverified));
check('unverified: a log with no fallback entry reports none', windowReport(realLog, tNow).unverified?.credits === 0 && windowReport([measuredE], tNow).unverified?.calls === 0);
check('unverified: a fallback entry outside the window is not reported', windowReport([{ ...timedOut, time: '2026-10-20T09:00:00Z' }], tNow).unverified?.credits === 0);

console.log(`
check-leonardo: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
