#!/usr/bin/env node
// leonardo.mjs's local guards, through its exports only: no generation, no network, no .env read.
//   redact    the key never survives into text bound for log.jsonl or stdout (an API error that echoed it)
// Run: node scripts/lookdev/check-leonardo.mjs   Exit 1 on any failure.
import { redact } from './leonardo.mjs';

let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };

const fake = '00000000-test-0000-key0-000000000000';

const echoed = `POST https://cloud.leonardo.ai/api/rest/v2/generations -> HTTP 401: {"error":"bad token Bearer ${fake}","again":"${fake}"}`;
check('redact: every copy of the key is gone', !redact(echoed, fake).includes(fake), redact(echoed, fake));
check('redact: the rest of the message stays', redact(echoed, fake).includes('HTTP 401'));
check('redact: no key, text unchanged', redact('plain', '') === 'plain' && redact('plain', undefined) === 'plain');

console.log(`\ncheck-leonardo: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
