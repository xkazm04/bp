// bp's headless server: the API of apps/web without Next, for channels that do not draw in a browser (the VR client).
// It mounts the same handler functions (packages/core/src/server/api), JSON + SSE, on 127.0.0.1 only: whatever --host
// binds, a request from a non-loopback peer answers 403 (mount.ts).
//   npm run server [-- --port 3100 --host 127.0.0.1]     (env BP_SERVER_PORT / BP_SERVER_HOST)
// Run it from the repo root, as Next is: the working directory is where bp.products.local.json is read.
// Prints `bp server listening on http://<host>:<port>` and one `route <methods> <path>` line per mounted handler.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listener, loadRoutes } from './mount.ts';

const arg = (k: string): string | undefined => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const HOST = arg('--host') ?? process.env.BP_SERVER_HOST ?? '127.0.0.1';
const PORT = Number(arg('--port') ?? process.env.BP_SERVER_PORT ?? 3100);
// the handler tree, found through the package (any module in it resolves; its directory's parent is api/)
const API = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@bp/core/server/api/products/route'))), '..');

const routes = await loadRoutes(API);
for (const r of routes) console.log(`route ${r.methods.join(',')} ${r.path}`);
const server = http.createServer(listener(routes));
server.listen(PORT, HOST, () => {
  const a = server.address();
  console.log(`bp server listening on http://${HOST}:${a && typeof a === 'object' ? a.port : PORT}`);
});
const stop = () => { server.close(); server.closeAllConnections(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
