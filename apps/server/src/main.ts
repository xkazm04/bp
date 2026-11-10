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
// Opt-in, the ceremony alone (table link v2, docs/concepts/vr-light-table/table-link-v2.md section 4): --pair serves the
// pairing routes on the loopback listener only (a headset on the USB tether pairs over the cable), with no LAN listener.
// Either way, a loopback request that carries `Authorization: Bearer <token>` is authenticated against $BP_HOME/lan/paired.json
// (device-auth.ts): a live pairing's device id (and, with `decide`, the decider seal) joins the request; any other Bearer is 401.
// Always, bp's Headsets page's routes (headsets.ts, /api/companion/headsets*, the page's human token only): pair a headset by
// the code it shows, list and revoke pairings, and switch the door on (as --pair or --lan) for this run only, never saved.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostKettleSims } from './kettle-sim.ts';
import { listener, loadRoutes } from './mount.ts';
import { loopbackDevice } from './device-auth.ts';
import { headsetRoutes, type DoorMode } from './headsets.ts';
import { LAN_PORT as DEFAULT_LAN_PORT, lanAddress } from './lan-door.ts';
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
const PAIR_ONLY = !LAN && process.argv.includes('--pair');
const lanHostFlag = arg('--lan-host'), lanPortFlag = arg('--lan-port');
if (!LAN && (lanHostFlag !== undefined || lanPortFlag !== undefined)) die('--lan-host and --lan-port need --lan');
let door = LAN || PAIR_ONLY ? await import('./lan-door.ts') : null;
const LAN_PORT = Number(lanPortFlag ?? door?.LAN_PORT ?? 0);
if (LAN && !(/^\d{1,5}$/.test(lanPortFlag ?? '0') && LAN_PORT >= 0 && LAN_PORT <= 65535)) die(`not a port: ${JSON.stringify(lanPortFlag)} (an integer 0-65535)`);
const LAN_HOST = LAN ? lanHostFlag ?? door?.lanAddress() ?? die('--lan: no private-range IPv4 interface found; name one with --lan-host') : '';
if (LAN && !/^\d{1,3}(\.\d{1,3}){3}$/.test(LAN_HOST)) die(`--lan-host takes an IPv4 address, not ${JSON.stringify(LAN_HOST)}`);
if (LAN && LAN_HOST === '0.0.0.0') die('--lan-host 0.0.0.0 is every interface; the door binds one LAN address');
// the handler tree, found through the package (any module in it resolves; its directory's parent is api/)
const API = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@bp/core/server/api/products/route'))), '..');

// a sim that cannot be built or a handler module that cannot be imported ends with one line too, not an uncaught stack
try { hostKettleSims(); } catch (e) { die(`cannot build the Kettle sims: ${(e as Error).message}`); }
const routes = await loadRoutes(API).catch((e: unknown) => die(`cannot load the routes: ${(e as Error).message}`));
// the Headsets page's routes (headsets.ts), on every start: the page shows a door that is off and can switch it on
routes.push(...headsetRoutes({
  door: () => lanDoor,
  mode: () => doorMode,
  started: LAN ? 'lan' : PAIR_ONLY ? 'pair' : 'off',
  wifiAt: () => ({ address: LAN ? LAN_HOST : lanAddress(), port: LAN ? LAN_PORT : DEFAULT_LAN_PORT }),
  switchOn: (m) => (switching = switching.then(() => switchDoorOn(m))),
}));
for (const r of routes) console.log(`route ${r.methods.join(',')} ${r.path}`);
const server = http.createServer(listener(routes, (authorization) => loopbackDevice(authorization)));
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
  boundPort = port;
  if (door) attachDoor(port, LAN_HOST, LAN_PORT, LAN).catch((e: unknown) => die(`cannot open the LAN door: ${(e as Error).message}`));
  if (PAIR_ONLY) console.log('lan door: --pair: the pairing ceremony on this loopback listener only (POST /pair, /pair/claim), no LAN listener');
});

let lanDoor: import('./lan-door.ts').LanDoor | null = null;
let doorMode: DoorMode = LAN ? 'lan' : PAIR_ONLY ? 'pair' : 'off';
let boundPort = 0;
let switching: Promise<string | null> = Promise.resolve(null);
/** Open the LAN door: its owner routes join the loopback mount, then the door listens when there is a reason to. The route
 *  table is one array that dispatch walks per request, so routes pushed after the server listens are served from the next
 *  request on (the athena host joins the same way). */
async function attachDoor(loopbackPort: number, host: string, port: number, lan: boolean): Promise<void> {
  if (!door) return;
  lanDoor = new door.LanDoor({ routes, loopbackPort, host, port, lan });
  const mine = lanDoor.adminRoutes();
  routes.push(...mine);
  for (const r of mine) console.log(`route ${r.methods.join(',')} ${r.path}`);
  await lanDoor.start();
}
/** The Headsets page's switch (headsets.ts), for THIS run only: nothing is saved, and a restart goes back to what the command
 *  line said. off -> pair attaches the door as --pair does; off or pair -> lan as --lan does, on the first private-range
 *  interface and port 3101 (the defaults --lan uses). Never off again from the page: stopping the server does that.
 *  Calls are serialized (main.ts chains them), so two clicks never attach two doors. */
async function switchDoorOn(want: 'pair' | 'lan'): Promise<string | null> {
  if (doorMode === 'lan' || doorMode === want) return null;
  if (!boundPort) return 'the server is still starting: try again in a moment';
  door ??= await import('./lan-door.ts');
  const host = want === 'lan' ? door.lanAddress() : '';
  if (want === 'lan' && !host) return 'this PC has no home-network address (no private-range IPv4 interface): start the server with --lan --lan-host <address>';
  const port = want === 'lan' ? DEFAULT_LAN_PORT : 0;
  if (!lanDoor) await attachDoor(boundPort, host as string, port, want === 'lan');
  else await lanDoor.widen(host as string, port);
  doorMode = want;
  lanDoor?.ledger({ event: 'door-on', mode: want, by: 'page', until: 'this run of the server', ...(want === 'lan' ? { address: `${host}:${port}` } : {}) });
  console.log(want === 'lan'
    ? `lan door: Wi-Fi switched on from bp's Headsets page, for this run only: http://${host}:${port} (private-range peers only)`
    : "lan door: pairing over the cable switched on from bp's Headsets page, for this run only (POST /pair, /pair/claim on this listener)");
  return null;
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
