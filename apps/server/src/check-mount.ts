// The request guards of mount.ts, through loadRoutes + listener over a throwaway handler tree (no @bp/core, no products):
//   decode    a malformed percent-escape in a path segment answers 400, and the server keeps serving
//   host      a Host header no URL can carry answers 400, and the server keeps serving
//   body      a body past MAX_BODY answers 413 (declared by Content-Length, or streamed chunked); one under it reaches the handler
//   errors    a handler that throws answers 500 without the exception's message (that goes to stderr only)
// Run: node apps/server/src/check-mount.ts   Exit 1 on any failure.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { MAX_BODY, listener, loadRoutes } from './mount.ts';

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { ok ? passed++ : failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };

const api = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-mount-'));
const handler = (dir: string, src: string) => { fs.mkdirSync(path.join(api, dir), { recursive: true }); fs.writeFileSync(path.join(api, dir, 'route.ts'), src); };
handler('echo/[slug]', 'export const GET = async (_r, { params }) => Response.json(await params);\n');
handler('boom', "export const GET = () => { throw new Error('detail from C:/Users/someone/secret.json'); };\n");
handler('body', 'export const POST = async (r) => Response.json({ bytes: (await r.arrayBuffer()).byteLength });\n');

const crashes: unknown[] = [];
process.on('unhandledRejection', (e) => crashes.push(e));
process.on('uncaughtException', (e) => crashes.push(e));

const server = http.createServer(listener(await loadRoutes(api)));
await new Promise<void>((r) => server.listen(0, '0.0.0.0', r));
const port = (server.address() as net.AddressInfo).port;

/** One raw HTTP/1.1 exchange (so a test can send what http.request refuses to), status and body. */
const raw = (text: string, addr = '127.0.0.1'): Promise<{ status: number; body: string }> => new Promise((resolve) => {
  let out = '';
  const done = () => resolve({ status: Number(/^HTTP\/1\.1 (\d+)/.exec(out)?.[1] ?? 0), body: out.split('\r\n\r\n').slice(1).join('\r\n\r\n') });
  const s = net.connect(port, addr, () => s.write(text));
  s.on('data', (d) => (out += d));
  s.on('error', done);
  s.on('close', done);
  setTimeout(() => s.destroy(), 3000);
});
const get = (p: string, host = 'localhost', addr = '127.0.0.1') => raw(`GET ${p} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`, addr);
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

  const boom = await get('/api/boom');
  check('errors: a throwing handler answers 500', boom.status === 500, `${boom.status}`);
  check('errors: the 500 body does not carry the exception message', !boom.body.includes('secret.json'), boom.body.slice(0, 80));
} finally {
  server.close(); server.closeAllConnections();
  fs.rmSync(api, { recursive: true, force: true });
}
console.log(`\ncheck-mount: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
