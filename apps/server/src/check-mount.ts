// The request guards of mount.ts, through loadRoutes + listener over a throwaway handler tree (no @bp/core, no products):
//   decode    a malformed percent-escape in a path segment answers 400, and the server keeps serving
//   host      a Host header no URL can carry answers 400, and the server keeps serving
//   body      a body past MAX_BODY answers 413 (declared by Content-Length, or streamed chunked); one under it reaches the handler
//   errors    a handler that throws answers 500 without the exception's message (that goes to stderr only)
//   late      a stream a handler answers after its client has gone is cancelled (its timer, proven to have been
//             running, stops), not piped to the closed socket and left running
//   verbs     HEAD runs the route's GET and sends no body; OPTIONS answers 204 with Allow; both name HEAD and OPTIONS
//             in Allow, and a verb the route does not serve still answers 405 — this is the pair with the Next mount,
//             which implements both verbs itself (apps/web/src/app/api/**, the thin re-exports)
//   peer      a request from a non-loopback socket answers 403 whatever its Host: always over a pipe / unix socket,
//             whose peer has no address at all, and additionally through this machine's own LAN address when it has
//             one (the server listens on 0.0.0.0 here, as `--host 0.0.0.0` would). The LAN leg is the only skippable
//             check in this file and it prints `SKIP` so check-all.mjs's summary counts it.
// And one source rule over the real mounted tree (no server needed):
//   text      no handler source carries a raw NUL byte. One did (structure/route.ts held a literal 0x00 where `'\0'`
//             was meant): ripgrep then skips the file, so a content search over the handler tree silently returns
//             fewer matches than there are, and `git diff`/`git log -p` report "Binary files differ" for every
//             change to it. A gate is the only thing that notices, because the file still compiles and still runs.
// Run: node apps/server/src/check-mount.ts   Exit 1 on any failure.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_BODY, listener, loadRoutes } from './mount.ts';

let failed = 0, passed = 0, skips = 0;
const check = (name: string, ok: boolean, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };

const api = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-mount-'));
const handler = (dir: string, src: string) => { fs.mkdirSync(path.join(api, dir), { recursive: true }); fs.writeFileSync(path.join(api, dir, 'route.ts'), src); };
handler('echo/[slug]', 'export const GET = async (_r, { params }) => Response.json(await params);\n');
handler('boom', "export const GET = () => { throw new Error('detail from C:/Users/someone/secret.json'); };\n");
// Answers after 300 ms with an endless stream; its cancel (or a timer that keeps going) is counted on globalThis.
// The stream is BUILT FIRST and the wait happens after, so its timer is demonstrably running by the time the handler
// returns: building it after the wait left lateTicks at 0, and "its timer stops" then compared 0 with 0.
handler('late', 'export const GET = async () => { const g = globalThis; g.lateTicks = 0; let t; const res = new Response(new ReadableStream({ start(c) { t = setInterval(() => { g.lateTicks++; c.enqueue(new TextEncoder().encode("x")); }, 20); }, cancel() { clearInterval(t); g.lateCancelled = true; } })); await new Promise((r) => setTimeout(r, 300)); return res; };\n');
handler('body', 'export const POST = async (r) => Response.json({ bytes: (await r.arrayBuffer()).byteLength });\n');

const crashes: unknown[] = [];
process.on('unhandledRejection', (e) => crashes.push(e));
process.on('uncaughtException', (e) => crashes.push(e));

const routes = await loadRoutes(api);
const server = http.createServer(listener(routes));
await new Promise<void>((r) => server.listen(0, '0.0.0.0', r));
const port = (server.address() as net.AddressInfo).port;

/** One raw HTTP/1.1 exchange (so a test can send what http.request refuses to): status, head and body. */
const raw = (text: string, addr = '127.0.0.1'): Promise<{ status: number; head: string; body: string }> => new Promise((resolve) => {
  let out = '';
  const done = () => resolve({ status: Number(/^HTTP\/1\.1 (\d+)/.exec(out)?.[1] ?? 0), head: out.split('\r\n\r\n')[0], body: out.split('\r\n\r\n').slice(1).join('\r\n\r\n') });
  const s = net.connect(port, addr, () => s.write(text));
  s.on('data', (d) => (out += d));
  s.on('error', done);
  s.on('close', done);
  setTimeout(() => s.destroy(), 3000);
});
const get = (p: string, host = 'localhost', addr = '127.0.0.1') => raw(`GET ${p} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`, addr);
const verb = (m: string, p: string) => raw(`${m} ${p} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
/** One response header out of the head, '' when it was not sent. */
const headerOf = (head: string, name: string): string => (new RegExp(`^${name}:(.*)$`, 'im').exec(head)?.[1] ?? '').trim();
const alive = async () => (await get('/api/echo/ok')).status === 200 && !crashes.length;

try {
  const ok = await get('/api/echo/a%20b');
  check('a well-formed request reaches the handler', ok.status === 200 && ok.body.includes('"a b"'), `${ok.status} ${ok.body.slice(0, 60)}`);

  const bad = await get('/api/echo/%E0%A4%A');
  check('decode: a malformed percent-escape answers 400', bad.status === 400, `${bad.status}`);
  check('decode: the server keeps serving after it', await alive(), `${crashes.length} uncaught`);

  const host = await get('/api/echo/ok', 'a b');
  check('host: an unusable Host answers 400', host.status === 400, `${host.status}`);
  check('host: the server keeps serving after it', await alive(), `${crashes.length} uncaught`);

  const post = (head: string, body: string) => raw(`POST /api/body HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nConnection: close\r\n${head}\r\n${body}`);
  const small = await post('Content-Length: 2\r\n', '{}');
  check('body: a small body reaches the handler', small.status === 200 && small.body.includes('"bytes":2'), `${small.status} ${small.body.slice(0, 60)}`);
  const declared = await post(`Content-Length: ${MAX_BODY + 1}\r\n`, '{');
  check('body: a declared Content-Length past the cap answers 413', declared.status === 413, `${declared.status}`);
  const chunk = 'x'.repeat(256 * 1024), n = Math.ceil(MAX_BODY / chunk.length) + 1;
  const chunked = Array.from({ length: n }, () => `${chunk.length.toString(16)}\r\n${chunk}\r\n`).join('') + '0\r\n\r\n';
  const streamed = await post('Transfer-Encoding: chunked\r\n', chunked);
  check('body: a chunked body past the cap answers 413', streamed.status === 413, `${streamed.status} ${streamed.body.slice(0, 60)}`);
  check('body: the server keeps serving after it', await alive(), `${crashes.length} uncaught`);
  await post('Content-Length: 100\r\n', '{"partial":'); // the client gives up (raw's timeout) before the body is whole
  check('body: the server keeps serving after a client leaves mid-body', await alive(), `${crashes.length} uncaught`);

  const lateG = globalThis as { lateTicks?: number; lateCancelled?: boolean };
  // the client sends the request and leaves after 50 ms, while the handler still waits
  await new Promise<void>((resolve) => { const s = net.connect(port, '127.0.0.1', () => { s.write('GET /api/late HTTP/1.1\r\nHost: localhost\r\n\r\n'); setTimeout(() => { s.destroy(); resolve(); }, 50); }); s.on('error', () => resolve()); });
  await new Promise((r) => setTimeout(r, 700));
  const ticks = lateG.lateTicks ?? -1;
  await new Promise((r) => setTimeout(r, 200));
  check('late: a stream answered after the client left is cancelled', lateG.lateCancelled === true, `cancelled=${lateG.lateCancelled}`);
  // `>= 5`, not `>= 0`: the timer must have RUN before it stopped, or an interval that never started would pass this
  // as readily as one that was cancelled. At 20 ms over the handler's 300 ms wait it ticks about fourteen times.
  check('late: and its timer ran and then stopped', ticks >= 5 && lateG.lateTicks === ticks, `ticks ${ticks} then ${lateG.lateTicks}`);
  check('late: the server keeps serving after it', await alive(), `${crashes.length} uncaught`);

  const boom = await get('/api/boom');
  check('errors: a throwing handler answers 500', boom.status === 500, `${boom.status}`);
  check('errors: the 500 body does not carry the exception message', !boom.body.includes('secret.json'), boom.body.slice(0, 80));

  // verbs: HEAD and OPTIONS, which no handler module exports and both mounts must answer the same way.
  const head = await verb('HEAD', '/api/echo/ok');
  check('verbs: HEAD runs the route GET and answers its status', head.status === 200, `${head.status}`);
  check('verbs: HEAD sends no body', head.body === '', JSON.stringify(head.body.slice(0, 60)));
  // a 405 also answers JSON, so the discriminator is that it would carry Allow and the GET response does not
  check("verbs: HEAD sends the GET response's headers, not a refusal's", /application\/json/.test(headerOf(head.head, 'content-type')) && !headerOf(head.head, 'allow'), `content-type=${headerOf(head.head, 'content-type')} allow=${headerOf(head.head, 'allow') || 'none'}`);
  const opts = await verb('OPTIONS', '/api/echo/ok');
  check('verbs: OPTIONS answers 204', opts.status === 204, `${opts.status}`);
  check('verbs: OPTIONS Allow carries GET, HEAD and OPTIONS', ['GET', 'HEAD', 'OPTIONS'].every((m) => headerOf(opts.head, 'allow').split(',').map((s) => s.trim()).includes(m)), headerOf(opts.head, 'allow') || 'no Allow header');
  const put = await verb('PUT', '/api/echo/ok');
  check('verbs: a verb the route does not serve still answers 405, Allow naming the three it does', put.status === 405 && headerOf(put.head, 'allow') === 'GET, HEAD, OPTIONS', `${put.status} allow=${headerOf(put.head, 'allow')}`);
  const headBoom = await verb('HEAD', '/api/boom');
  check('verbs: HEAD on a throwing handler answers 500 with no body', headBoom.status === 500 && headBoom.body === '', `${headBoom.status} ${JSON.stringify(headBoom.body.slice(0, 40))}`);
  check('verbs: the server keeps serving after them', await alive(), `${crashes.length} uncaught`);

  // peer, unconditionally: a socket the guard cannot place is not loopback either. A pipe (Windows) or unix socket
  // leaves req.socket.remoteAddress undefined, which LOOPBACK_PEER must refuse — and unlike the LAN probe below this
  // one needs no network interface, so the claim in mount.ts's LOOPBACK_PEER comment is proven on every machine.
  {
    const addr = process.platform === 'win32' ? `\\\\.\\pipe\\bp-mount-${process.pid}` : path.join(os.tmpdir(), `bp-mount-${process.pid}.sock`);
    const piped = http.createServer(listener(routes));
    await new Promise<void>((r) => piped.listen(addr, r));
    const answer = await new Promise<string>((resolve) => {
      let out = '';
      const s = net.connect(addr, () => s.write('GET /api/echo/ok HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'));
      s.on('data', (d) => (out += d));
      s.on('close', () => resolve(out));
      s.on('error', () => resolve(out));
      setTimeout(() => s.destroy(), 3000);
    });
    piped.close(); piped.closeAllConnections();
    const status = Number(/^HTTP\/1\.1 (\d+)/.exec(answer)?.[1] ?? 0);
    check('peer: a socket with no remote address (a pipe) answers 403', status === 403, `${status} ${answer.slice(0, 60)}`);
  }
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  if (lan) {
    const far = await get('/api/echo/ok', 'localhost', lan);
    check(`peer: a request from a non-loopback socket (${lan}) answers 403`, far.status === 403, `${far.status}`);
  } else {
    // `SKIP` at the start of the line, UPPERCASE, is check-all.mjs's convention for "this did not run" (matched
    // anchored and case-sensitively at scripts/check-all.mjs:46). Lower case made this line invisible to the
    // aggregate summary, so on a machine with no LAN address the only proof behind mount.ts's `--host 0.0.0.0`
    // argument vanished while the tally still read `N passed, 0 failed`. The pipe check above now carries that
    // proof unconditionally, so this one really is an extra - and it says so where it can be counted.
    skips++;
    console.log('SKIP  peer: this machine has no non-loopback IPv4 address to connect from (the pipe check above covers the guard)');
  }
} finally {
  server.close(); server.closeAllConnections();
  fs.rmSync(api, { recursive: true, force: true });
}

// text: the real sources, read as bytes. Both mounts' trees plus this server's own files.
{
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const srcDirs = ['packages/core/src/server/api', 'apps/web/src/app/api', 'apps/server/src'];
  const sources = (d: string): string[] => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(path.join(d, e.name)) : /\.(ts|tsx|mjs)$/.test(e.name) ? [path.join(d, e.name)] : [])) : []);
  const files = srcDirs.flatMap((d) => sources(path.join(ROOT, d)));
  const withNul = files.filter((f) => fs.readFileSync(f).includes(0)).map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
  check(`text: no NUL byte in the ${files.length} handler, mount and web-mount sources`, files.length > 0 && !withNul.length, withNul.join(' '));
}

console.log(`\ncheck-mount: ${passed} passed, ${failed} failed, ${skips} skipped`);
process.exit(failed ? 1 : 0);
