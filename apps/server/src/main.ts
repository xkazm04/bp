// bp's headless server: the API of apps/web without Next, for channels that do not draw in a browser (the VR client).
// It mounts the same handler functions (packages/core/src/server/api), JSON + SSE, on 127.0.0.1 only: whatever --host
// binds, a request from a non-loopback peer answers 403 (mount.ts).
//   npm run server [-- --port 3100 --host 127.0.0.1]     (env BP_SERVER_PORT / BP_SERVER_HOST)
// Run it from the repo root, as Next is: the working directory is where bp.products.local.json is read.
// Prints `bp server listening on http://<dialable host>:<port>` (127.0.0.1 for a wildcard bind) and one `route <methods> <path>` line per mounted handler.
// It hosts the Kettle sample's sims (kettle-sim.ts), in memory: Kettle's scan, scans, waves, dispatch and stream answer from them.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostKettleSims } from './kettle-sim.ts';
import { listener, loadRoutes } from './mount.ts';

const die = (msg: string): never => { console.error(`bp server: ${msg}`); process.exit(1); };
// A flag given without a value (last position, or followed by another flag) is an error, not a silent fall back to the default.
const arg = (k: string): string | undefined => {
  const i = process.argv.indexOf(k);
  if (i < 1) return undefined;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? die(`${k} needs a value`) : v;
};
const HOST = arg('--host') ?? process.env.BP_SERVER_HOST ?? '127.0.0.1';
// A port is a decimal integer 0..65535 (0 = an ephemeral port, on purpose); Number('abc') is NaN and listen(NaN) would bind a random port.
const portText = String(arg('--port') ?? process.env.BP_SERVER_PORT ?? 3100);
const PORT = /^\d{1,5}$/.test(portText) ? Number(portText) : NaN;
if (!(PORT >= 0 && PORT <= 65535)) die(`not a port: ${JSON.stringify(portText)} (an integer 0-65535)`);
// the handler tree, found through the package (any module in it resolves; its directory's parent is api/)
const API = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@bp/core/server/api/products/route'))), '..');

hostKettleSims();
const routes = await loadRoutes(API);
for (const r of routes) console.log(`route ${r.methods.join(',')} ${r.path}`);
const server = http.createServer(listener(routes));
// listen failures (EADDRINUSE, an unresolvable --host) end with one line and exit 1, not an uncaught throw
server.on('error', (e: NodeJS.ErrnoException) => die(`cannot listen on ${HOST}:${PORT}: ${e.code ?? ''} ${e.message}`));
server.listen(PORT, HOST, () => {
  const a = server.address();
  const port = a && typeof a === 'object' ? a.port : PORT;
  // A wildcard bind address is not an address anyone can open: print the loopback URL, and say separately what was bound.
  const wildcard = HOST === '0.0.0.0' || HOST === '::';
  const dial = wildcard ? '127.0.0.1' : HOST.includes(':') ? `[${HOST}]` : HOST;
  console.log(`bp server listening on http://${dial}:${port}${wildcard ? ` (bound to ${HOST}, every interface; peers off this machine get 403)` : ''}`);
});
const stop = () => { server.close(); server.closeAllConnections(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
