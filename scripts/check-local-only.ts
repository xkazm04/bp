// Checks the localhost request guards (src/lib/scan/local-only.ts): Host allow/deny for reads and writes,
// Origin / Sec-Fetch-Site / X-Forwarded-For for writes, Content-Type for JSON bodies - including the branches
// no obvious case reaches: an unparseable Origin, an IPv4-mapped loopback hop, a non-.1 loopback octet, a
// same-site fetch, and the bare `::1` Host that hostOnly makes unreachable. Also the shared isLoopbackAddr table (the node
// mount's socket-peer check calls it too) and the reason the web mount binds loopback (scripts/check-web-bind.mjs).
// And the refusal record (packages/core/src/scan/refusals.ts): every refusal a guard returns writes exactly one line from
// a closed reason vocabulary (localOnly running the host rule inside still writes one, not two), a passing request writes
// none, the line carries only status, reason, verb, path and a peer-is-loopback flag (no header value, no query), it is
// injection-safe and clipped, and a burst is rate-capped with the dropped count carried onto the next line.
// Run: node scripts/check-local-only.ts  (Node's type stripping). Exit 1 on any failure.
import { isLoopbackAddr, jsonOnly, localHost, localOnly } from '../packages/core/src/scan/local-only.ts';
import { REFUSAL_REASONS, createRefusalLog, formatRefusal, setRefusalLog } from '../packages/core/src/scan/refusals.ts';

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else { failed++; console.log('FAIL ' + name + (detail ? `  (${detail})` : '')); } };
const req = (h: Record<string, string>) => new Request('http://x/', { headers: h });
// Every guard call below records into `lines`, uncapped, so a case can count what one call wrote.
const lines: string[] = [];
setRefusalLog(createRefusalLog({ sink: (l) => lines.push(l), cap: Infinity }));
const take = () => lines.splice(0);

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
check('read denies foreign X-Forwarded-For', localHost(req({ ...L, 'x-forwarded-for': '203.0.113.9' })) !== null);
check('read denies a foreign hop after a loopback one', localHost(req({ ...L, 'x-forwarded-for': '127.0.0.1, 8.8.8.8' })) !== null);
check('read allows loopback X-Forwarded-For', localHost(req({ ...L, 'x-forwarded-for': '127.0.0.1, ::1' })) === null);
check('json allows application/json', jsonOnly(req({ 'content-type': 'application/json' })) === null);
check('json allows charset suffix', jsonOnly(req({ 'content-type': 'Application/JSON; charset=utf-8' })) === null);
check('json denies text/plain', jsonOnly(req({ 'content-type': 'text/plain' })) !== null);
check('json denies form type', jsonOnly(req({ 'content-type': 'application/x-www-form-urlencoded' })) !== null);
check('json denies none', jsonOnly(req({})) !== null);
// Branches of local-only.ts that no case above reaches: measured 2026-10-21, dropping the `::ffff:` alternative from
// isLoopbackAddr, or accepting an unparseable Origin instead of refusing it, left every case above green.
// A bare `::1` Host is REFUSED although LOOPBACK_HOST lists `::1`: hostOnly cuts at the first colon unless the host is
// bracketed, so that alternative is unreachable. Pinned as it behaves, so a change to hostOnly says so here.
check('read denies a bare ::1 host (hostOnly cuts at the first colon)', localHost(req({ host: '::1' })) !== null);
check('write denies a bare ::1 host', localOnly(req({ host: '::1' })) !== null);
check('read allows another loopback octet (127.1.2.3)', localHost(req({ host: '127.1.2.3:3000' })) === null);
check('write denies an unparseable Origin', localOnly(req({ ...L, origin: 'not a url' })) !== null);
check('write allows a bracketed IPv6 loopback Origin', localOnly(req({ ...L, origin: 'http://[::1]:3000' })) === null);
check('write allows an IPv4-mapped loopback X-Forwarded-For hop', localOnly(req({ ...L, 'x-forwarded-for': '::ffff:127.0.0.1' })) === null);
check('read allows an IPv4-mapped loopback X-Forwarded-For hop', localHost(req({ ...L, 'x-forwarded-for': '::ffff:127.0.0.1' })) === null);
check('write allows a same-site fetch (only cross-site is refused)', localOnly(req({ ...L, 'sec-fetch-site': 'same-site' })) === null);

// isLoopbackAddr is the one loopback-address rule: the X-Forwarded-For hop check here and apps/server's socket-peer check.
for (const a of ['127.0.0.1', '127.9.9.9', '::1', '::ffff:127.0.0.1']) check(`isLoopbackAddr ${a}`, isLoopbackAddr(a) === true);
for (const a of ['10.0.0.1', '127.0.0.1.evil', '::ffff:10.0.0.1', '', '0.0.0.0', '::']) check(`not isLoopbackAddr ${JSON.stringify(a)}`, isLoopbackAddr(a) === false);
// GUARD - why the web mount must bind loopback: the headers a LAN client controls pass both guards. Next fills
// X-Forwarded-For with `??=`, so a client-sent hop survives; only the socket (next dev|start -H 127.0.0.1) is a boundary.
check('a LAN client claiming Host localhost + X-Forwarded-For 127.0.0.1 passes the read guard (only the bind stops it)', localHost(req({ host: 'localhost', 'x-forwarded-for': '127.0.0.1' })) === null);
check('...and the write guard', localOnly(req({ host: 'localhost', 'x-forwarded-for': '127.0.0.1' })) === null);

// --- the refusal record ---
const at = (method: string, target: string, h: Record<string, string>) => new Request(`http://x${target}`, { method, headers: h });
take();
// GUARD: the strings the handlers answer with do not move (the handler modules and the route door return them as `error`).
const fh = localHost(at('GET', '/api/products', { host: 'evil.example' }));
const fhLines = take();
check('record: localHost foreign Host still returns its string', fh === 'only served on localhost (Host: evil.example)');
check('record: localHost foreign Host writes exactly 1 line, foreign-host', fhLines.length === 1 && /^refused 403 \(foreign-host\) "GET" "\/api\/products" /.test(fhLines[0]));
const fw = localOnly(at('POST', '/api/products', { host: 'evil.example' }));
const fwLines = take();
check('record: localOnly foreign Host still returns its string', fw === 'writes are only accepted on localhost (Host: evil.example)');
check('record: localOnly foreign Host writes 1 line, not 2 (it runs the host rule inside)', fwLines.length === 1 && /^refused 403 \(foreign-host\) "POST" /.test(fwLines[0]));
const one = (name: string, run: () => string | null, want: string, line: RegExp): string => {
  take();
  const got = run(), ls = take();
  check(`record: ${name} still returns its string`, got === want);
  check(`record: ${name} writes 1 line ${line}`, ls.length === 1 && line.test(ls[0]));
  return ls[0] ?? '';
};
const LH = { host: 'localhost:3000' };
const nj = one('jsonOnly text/plain', () => jsonOnly(at('POST', '/api/products', { ...LH, 'content-type': 'text/plain' })), 'body must be application/json (Content-Type: text/plain)', /^refused 415 \(not-json\) "POST" "\/api\/products" /);
const fo = one('foreign Origin', () => localOnly(at('POST', '/api/products', { ...LH, origin: 'https://evil.example' })), 'writes are only accepted from a localhost page (Origin: https://evil.example)', /^refused 403 \(foreign-origin\) "POST" /);
one('opaque Origin', () => localOnly(at('POST', '/api/products', { ...LH, origin: 'null' })), 'writes are not accepted from an opaque origin', /^refused 403 \(opaque-origin\) "POST" /);
one('cross-site fetch', () => localOnly(at('POST', '/api/products', { ...LH, 'sec-fetch-site': 'cross-site' })), 'cross-site writes are refused', /^refused 403 \(cross-site\) "POST" /);
const fx = one('foreign X-Forwarded-For hop', () => localHost(at('GET', '/api/products?token=s3cret', { ...LH, 'x-forwarded-for': '203.0.113.9' })), 'only served on this machine (X-Forwarded-For: 203.0.113.9)', /^refused 403 \(foreign-hop\) "GET" "\/api\/products" peer=foreign$/);
one('a write behind a foreign hop', () => localOnly(at('POST', '/api/products', { ...LH, 'x-forwarded-for': '203.0.113.9' })), 'writes are only accepted on this machine (X-Forwarded-For: 203.0.113.9)', /^refused 403 \(foreign-hop\) "POST" /);
// The flag: the nearest X-Forwarded-For hop (the socket peer on apps/server, which appends it); unknown with no hop.
one('a hop the node mount appended (loopback socket)', () => localOnly(at('POST', '/api/products', { ...LH, 'x-forwarded-for': '203.0.113.9, 127.0.0.1' })), 'writes are only accepted on this machine (X-Forwarded-For: 203.0.113.9, 127.0.0.1)', / peer=loopback$/);
check('record: no hop -> peer=unknown', / peer=unknown$/.test(fhLines[0] ?? '') && / peer=unknown$/.test(nj));
// It stores no more than it needs: no header value, no query string.
check('record: the line carries no header value and no query', fhLines.length === 1 && ![...fhLines, ...fwLines, nj, fo, fx].some((l) => /evil\.example|text\/plain|203\.0\.113\.9|token|s3cret/.test(l)), JSON.stringify([fhLines, fx]));
// Every passing request writes nothing.
take();
for (const host of ['localhost:3000', 'localhost', '127.0.0.1:3000', '127.0.0.1', '[::1]:3000']) { localHost(req({ host })); localOnly(req({ host })); }
localHost(req({ ...LH, 'x-forwarded-for': '127.0.0.1, ::1' })); localOnly(req({ ...LH, 'x-forwarded-for': '::ffff:127.0.0.1' }));
localOnly(req({ ...LH, origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin' })); jsonOnly(req({ 'content-type': 'application/json' }));
check('record: passing requests write 0 lines', take().length === 0);
// Rate cap, injected clock: 200 refusals in one window write the cap; the first line after it says what was dropped.
{
  let t = 1000;
  const out: string[] = [];
  const log = createRefusalLog({ sink: (l) => out.push(l), now: () => t, cap: 20, windowMs: 60_000 });
  const r = { status: 403, reason: 'foreign-host', method: 'GET', path: '/api/products', peer: null } as const;
  for (let i = 0; i < 200; i++) { t += 10; log.record(r); }
  check('record: a burst of 200 in one window writes at most the cap (20)', out.length === 20, `${out.length}`);
  check('record: no line inside the cap claims drops', out.length > 0 && !out.some((l) => /dropped/.test(l)));
  t += 60_000; log.record(r);
  check('record: the first line after the window carries (+180 dropped)', out.length === 21 && / \(\+180 dropped\)$/.test(out[20]), out[20]);
  log.record(r);
  check('record: and the count resets once reported', out.length === 22 && !/dropped/.test(out[21]), out[21]);
  const quiet = createRefusalLog({ sink: () => { throw new Error('sink down'); } });
  let threw = false;
  try { quiet.record(r); } catch { threw = true; }
  check('record: a failing sink never breaks the refusal', !threw);
}
// Injection: a target with a newline and a quote is one line, JSON-quoted (no forged second record), clipped to 200.
{
  const forged = formatRefusal({ status: 403, reason: 'foreign-host', method: 'GET\nrefused', path: '/api/x\n"refused 200' + 'y'.repeat(400), peer: false });
  check('record: a hostile target stays one line', !/[\r\n]/.test(forged), forged.slice(0, 80));
  check('record: the target is JSON-quoted (newline and quote escaped)', forged.includes('"/api/x\\n\\"refused 200'), forged.slice(0, 80));
  const quoted = /^refused 403 \(foreign-host\) ("(?:[^"\\]|\\.)*") ("(?:[^"\\]|\\.)*") peer=foreign$/.exec(forged);
  check('record: the target is clipped to 200 characters', !!quoted && (JSON.parse(quoted[2]) as string).length === 200, String(forged.length));
}
// The vocabulary is closed: a reason outside REFUSAL_REASONS is a type error (npm run typecheck) and a runtime throw.
{
  check('record: the vocabulary has the ten reasons', REFUSAL_REASONS.length === 10 && new Set(REFUSAL_REASONS).size === 10);
  let threw = false;
  // @ts-expect-error - 'made-up' is not a RefusalReason; if the type opened up, this directive would fail typecheck.
  try { formatRefusal({ status: 403, reason: 'made-up', method: 'GET', path: '/', peer: null }); } catch { threw = true; }
  check('record: a reason outside the vocabulary throws', threw);
}

console.log(`local-only: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
