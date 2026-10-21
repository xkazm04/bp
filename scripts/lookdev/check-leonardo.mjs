#!/usr/bin/env node
// leonardo.mjs's local guards, through its exports only: no generation, no network, no .env read.
//   redact    the key never survives into text bound for log.jsonl or stdout (an API error that echoed it)
//   backdrop  an entry with `rules` (city-backdrop) swaps the sheet rules for its own and still restates the style block
//   prop      prop prompts restate the style block's palette and materials, carry the TRELLIS sheet rules, and cover every variant
//   cap       a call that would pass the stop or HARD_CAP is refused; a prop --out stays inside apps/vr/ArtSource
//   out       --out stays inside lookdev/: a name that would resolve outside it is refused before any call
// Run: node scripts/lookdev/check-leonardo.mjs   Exit 1 on any failure.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { artFile, composePropPrompt, composePrompt, nightTotal, outFile, parseSize, redact, spendWindow, withinCap } from './leonardo.mjs';

let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };
const throws = (f) => { try { f(); return false; } catch { return true; } };

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/concepts/vr-light-table/lookdev');
const fake = '00000000-test-0000-key0-000000000000';

const echoed = `POST https://cloud.leonardo.ai/api/rest/v2/generations -> HTTP 401: {"error":"bad token Bearer ${fake}","again":"${fake}"}`;
check('redact: every copy of the key is gone', !redact(echoed, fake).includes(fake), redact(echoed, fake));
check('redact: the rest of the message stays', redact(echoed, fake).includes('HTTP 401'));
check('redact: no key, text unchanged', redact('plain', '') === 'plain' && redact('plain', undefined) === 'plain');

check('out: an explore frame lands under lookdev/explore', outFile('explore/x-a-s1-low.png') === path.join(DIR, 'explore', 'x-a-s1-low.png'), outFile('explore/x-a-s1-low.png'));
check('out: a pick name lands under lookdev/', outFile('00-hero.jpg') === path.join(DIR, '00-hero.jpg'));
for (const bad of ['../../../package.json', '..\\..\\x.png', 'explore/../../x.png', path.resolve('/tmp/x.png'), 'C:/Windows/x.png', '']) {
  check(`out: ${JSON.stringify(bad)} is refused`, throws(() => outFile(bad)));
}

const style = JSON.parse(fs.readFileSync(path.join(DIR, 'style-block.json'), 'utf8'));
const props = JSON.parse(fs.readFileSync(path.join(DIR, 'props.json'), 'utf8'));
const expected = { 'lamp-agent': ['A', 'B', 'C', 'D'], 'studio-shelves': ['A', 'B'], 'studio-desk-lamp': ['A', 'B'], 'studio-mug': ['A', 'B'], 'studio-drawing-tubes': ['A', 'B'], 'studio-pinned-drawings': ['A', 'B'] };
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

console.log(`
check-leonardo: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
