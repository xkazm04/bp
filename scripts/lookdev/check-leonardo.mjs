#!/usr/bin/env node
// leonardo.mjs's local guards, through its exports only: no generation, no network, no .env read.
//   redact    the key never survives into text bound for log.jsonl or stdout (an API error that echoed it)
//   out       --out stays inside lookdev/: a name that would resolve outside it is refused before any call
// Run: node scripts/lookdev/check-leonardo.mjs   Exit 1 on any failure.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { outFile, redact } from './leonardo.mjs';

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

console.log(`\ncheck-leonardo: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
