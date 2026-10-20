// Checks the localhost request guards (src/lib/scan/local-only.ts): Host allow/deny for reads and writes,
// Origin / Sec-Fetch-Site / X-Forwarded-For for writes, Content-Type for JSON bodies.
// Run: node scripts/check-local-only.ts  (Node's type stripping). Exit 1 on any failure.
import { jsonOnly, localHost, localOnly } from '../packages/core/src/scan/local-only.ts';

let failed = 0, passed = 0;
const check = (name: string, ok: boolean) => { if (ok) passed++; else { failed++; console.log('FAIL ' + name); } };
const req = (h: Record<string, string>) => new Request('http://x/', { headers: h });

for (const host of ['localhost:3000', 'localhost', '127.0.0.1:3000', '127.0.0.1', '[::1]:3000', 'LOCALHOST:3000']) {
  check(`read allows ${host}`, localHost(req({ host })) === null);
  check(`write allows ${host}`, localOnly(req({ host })) === null);
}
for (const host of ['evil.com', 'evil.com:3000', 'localhost.evil.com', '127.0.0.1.evil.com', '192.168.1.5:3000', '']) {
  check(`read denies ${JSON.stringify(host)}`, localHost(req(host ? { host } : {})) !== null);
  check(`write denies ${JSON.stringify(host)}`, localOnly(req(host ? { host } : {})) !== null);
}
const L = { host: 'localhost:3000' };
check('write allows loopback Origin', localOnly(req({ ...L, origin: 'http://127.0.0.1:3000' })) === null);
check('write denies foreign Origin', localOnly(req({ ...L, origin: 'https://evil.com' })) !== null);
check('write denies opaque Origin', localOnly(req({ ...L, origin: 'null' })) !== null);
check('write denies cross-site fetch', localOnly(req({ ...L, 'sec-fetch-site': 'cross-site' })) !== null);
check('write allows same-origin fetch', localOnly(req({ ...L, 'sec-fetch-site': 'same-origin' })) === null);
check('write denies foreign X-Forwarded-For', localOnly(req({ ...L, 'x-forwarded-for': '8.8.8.8' })) !== null);
check('write allows loopback X-Forwarded-For', localOnly(req({ ...L, 'x-forwarded-for': '127.0.0.1, ::1' })) === null);
check('json allows application/json', jsonOnly(req({ 'content-type': 'application/json' })) === null);
check('json allows charset suffix', jsonOnly(req({ 'content-type': 'Application/JSON; charset=utf-8' })) === null);
check('json denies text/plain', jsonOnly(req({ 'content-type': 'text/plain' })) !== null);
check('json denies form type', jsonOnly(req({ 'content-type': 'application/x-www-form-urlencoded' })) !== null);
check('json denies none', jsonOnly(req({})) !== null);

console.log(`local-only: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
