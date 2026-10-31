// bp's headless server: the API of apps/web without Next, for channels that do not draw in a browser (the VR client).
// It mounts the same handler functions (packages/core/src/server/api), JSON + SSE, on 127.0.0.1 only: whatever --host
// binds, a request from a non-loopback peer answers 403 (mount.ts).
//   npm run server [-- --port 3100 --host 127.0.0.1]     (env BP_SERVER_PORT / BP_SERVER_HOST)
// Run it from the repo root, as Next is: the working directory is where bp.products.local.json is read.
// Prints `bp server listening on http://<dialable host>:<port>` (127.0.0.1 for a wildcard bind) and one `route <methods> <path>` line per mounted handler.
// It hosts the Kettle sample's sims (kettle-sim.ts), in memory: Kettle's scan, scans, waves, dispatch and stream answer from them.
// Opt-in, the athena host (athena-host.ts, wolf-plan L5.3): --athena <daemon url> (env BP_ATHENA_URL) with --athena-token-file
// <path> (env BP_ATHENA_TOKEN_FILE; default $ATHENA_HOME/daemon.json, the file the daemon's ready line names) registers bp's
// tools with that daemon and serves GET /athena and POST /athena/decisions/<id>. Without --athena none of it loads and the
// output is unchanged; with it, two more route lines and one `athena host: ...` line follow. The token is never printed.
// Opt-in, the S8 LAN door (lan-door.ts, desk-to-table plan D1): --lan starts a second listener for paired headsets, on
// --lan-host (default: the first private-range IPv4 interface) port --lan-port (default 3101). Without --lan none of it
// loads and nothing changes; with it, the /lan/pair route lines and `lan door: ...` lines follow. The owner's side is
// `npm run server -- pair <list|open|approve|deny|revoke>` (lan-pair.ts), against the running server.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostKettleSims } from './kettle-sim.ts';
import { listener, loadRoutes } from './mount.ts';
import { setSelfOrigin } from '@bp/core/server/api/companion/door.server';

// `pair ...` is the owner's command line for the LAN door, not a server start
if (process.argv[2] === 'pair') { await import('./lan-pair.ts'); process.exit(0); }

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
// the athena host, when asked for: its URL and token are read now, so a bad flag or token file fails before anything binds
const ATHENA = arg('--athena') ?? process.env.BP_ATHENA_URL;
const athenaTokenFile = ATHENA ? arg('--athena-token-file') ?? process.env.BP_ATHENA_TOKEN_FILE ?? (process.env.ATHENA_HOME ? path.join(process.env.ATHENA_HOME, 'daemon.json') : undefined) : undefined;
if (ATHENA && !athenaTokenFile) die('--athena needs --athena-token-file <path> (or BP_ATHENA_TOKEN_FILE, or ATHENA_HOME)');
const athena = ATHENA ? await import('./athena-host.ts') : null;
const athenaUrlBad = ATHENA && athena ? athena.daemonUrlProblem(ATHENA) : null;
if (athenaUrlBad) die(athenaUrlBad);
let athenaToken = '';
if (athena && athenaTokenFile) { try { athenaToken = athena.readToken(athenaTokenFile); } catch (e) { die((e as Error).message); } }
// the LAN door, when asked for: its address and port are settled now, so a bad flag fails before anything binds
const LAN = process.argv.includes('--lan');
const lanHostFlag = arg('--lan-host'), lanPortFlag = arg('--lan-port');
if (!LAN && (lanHostFlag !== undefined || lanPortFlag !== undefined)) die('--lan-host and --lan-port need --lan');
const door = LAN ? await import('./lan-door.ts') : null;
const LAN_PORT = Number(lanPortFlag ?? door?.LAN_PORT ?? 0);
if (LAN && !(/^\d{1,5}$/.test(lanPortFlag ?? '0') && LAN_PORT >= 0 && LAN_PORT <= 65535)) die(`not a port: ${JSON.stringify(lanPortFlag)} (an integer 0-65535)`);
const LAN_HOST = door ? lanHostFlag ?? door.lanAddress() ?? die('--lan: no private-range IPv4 interface found; name one with --lan-host') : '';
if (door && !/^\d{1,3}(\.\d{1,3}){3}$/.test(LAN_HOST)) die(`--lan-host takes an IPv4 address, not ${JSON.stringify(LAN_HOST)}`);
if (door && LAN_HOST === '0.0.0.0') die('--lan-host 0.0.0.0 is every interface; the door binds one LAN address');
// the handler tree, found through the package (any module in it resolves; its directory's parent is api/)
const API = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@bp/core/server/api/products/route'))), '..');

// a sim that cannot be built or a handler module that cannot be imported ends with one line too, not an uncaught stack
try { hostKettleSims(); } catch (e) { die(`cannot build the Kettle sims: ${(e as Error).message}`); }
const routes = await loadRoutes(API).catch((e: unknown) => die(`cannot load the routes: ${(e as Error).message}`));
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
  // a card's request runs against this origin, never the Host a client sent (door.server.ts, roadmap I1)
  setSelfOrigin(`http://${dial}:${port}`);
  console.log(`bp server listening on http://${dial}:${port}${wildcard ? ` (bound to ${HOST}, every interface; peers off this machine get 403)` : ''}`);
  if (ATHENA) void attachAthena(ATHENA, port);
  // a door that cannot start (an unwritable or occupied $BP_HOME/lan) ends with one line too, not an unhandled rejection
  if (door) attachDoor(port).catch((e: unknown) => die(`cannot open the LAN door: ${(e as Error).message}`));
});

let lanDoor: import('./lan-door.ts').LanDoor | null = null;
/** Open the LAN door: its owner routes join the loopback mount, then the door listens when there is a reason to. */
async function attachDoor(loopbackPort: number): Promise<void> {
  if (!door) return;
  lanDoor = new door.LanDoor({ routes, loopbackPort, host: LAN_HOST, port: LAN_PORT });
  const mine = lanDoor.adminRoutes();
  routes.push(...mine);
  for (const r of mine) console.log(`route ${r.methods.join(',')} ${r.path}`);
  await lanDoor.start();
}

/** Register with the daemon. A refusal is one line and the server keeps serving: nothing of bp depends on athena. */
async function attachAthena(url: string, port: number): Promise<void> {
  if (!athena) return;
  // athena admits plain http only on the host `localhost` by exact name (its page_origin_admitted): 127.0.0.1 is refused
  const host = new athena.AthenaHost({ url, token: athenaToken, pageOrigin: `http://localhost:${port}`, routes, selfHost: `127.0.0.1:${port}` });
  const mine = athena.hostRoutes(host);
  routes.push(...mine);
  for (const r of mine) console.log(`route ${r.methods.join(',')} ${r.path}`);
  const r = await host.register();
  console.log(r.ok
    ? `athena host: registered ${r.tools.map((t) => `${t.name} ${t.class}`).join(', ')} with ${host.url} (page origin ${host.pageOrigin})`
    : `athena host: manifest refused by ${host.url}: ${r.status} ${r.reason}: ${r.detail}`);
}
const stop = () => { void lanDoor?.stop(); server.close(); server.closeAllConnections(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
