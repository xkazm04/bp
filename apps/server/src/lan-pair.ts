// The owner's side of the S8 LAN door (lan-door.ts): `npm run server -- pair <command>`, run on this machine, from the repo
// root (as the server is). It talks to the running server's loopback-only /lan/pair routes, a surface the LAN cannot reach,
// so the headset can ask but only a person here can say yes.
//   pair list                                   pending requests and pairings (never a token or a fingerprint)
//   pair open                                   open a 2-minute pairing window
//   pair approve <code> [--scope read,place] [--days 30]   (decide, a repeat declined from the headset, only when named here)
//                                               the one mint gate: type the code the headset shows; narrow the scopes
//                                               (read, standup, place; default: what the device asked for) and the days
//   pair deny <code>                            refuse a request
//   pair revoke <id>                            remove a pairing: through the server when it runs (its requests in flight
//                                               are cut), else straight from $BP_HOME/lan/paired.json
// The server's port: --port, else BP_SERVER_PORT, else 3100.
import { readRegistry, writeRegistry, registryFile, deviceId, SCOPES, type Scope } from './lan-door.ts';

const die = (msg: string): never => { console.error(`bp server pair: ${msg}`); process.exit(1); };
const argv = process.argv.slice(process.argv.indexOf('pair') + 1);
const flag = (k: string): string | undefined => {
  const i = argv.indexOf(k);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? die(`${k} needs a value`) : v;
};
const words = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const [cmd, subject] = words;
const portText = flag('--port') ?? process.env.BP_SERVER_PORT ?? '3100';
if (!/^\d{1,5}$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) die(`not a port: ${portText}`);
const BASE = `http://127.0.0.1:${portText}`;

type Answer = { status: number; body: Record<string, unknown> } | 'down';
async function call(method: 'GET' | 'POST', route: string, body?: unknown): Promise<Answer> {
  try {
    const r = await fetch(BASE + route, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  } catch { return 'down'; }
}
const needServer = (a: Answer): { status: number; body: Record<string, unknown> } => {
  if (a === 'down') return die(`no bp server answers on ${BASE}; start it with \`npm run server -- --lan\``);
  if (a.status === 404 && /no route/.test(String(a.body.error))) return die(`the server on ${BASE} was started without --lan`);
  if (a.status >= 400) return die(String(a.body.error ?? `HTTP ${a.status}`));
  return a;
};

switch (cmd) {
  case 'list': {
    const a = await call('GET', '/lan/pair');
    if (a === 'down' || a.status !== 200) {
      console.log(`(no --lan server on ${BASE}; pairings from ${registryFile()})`);
      for (const r of readRegistry()) console.log(`paired  ${r.id}  ${deviceId(r)}  ${r.scopes.join(',')}  until ${r.expiresAt}`);
      break;
    }
    const s = a.body as { window: string | null; listening: string | null; pending: { code: string; device: string; peer: string; state: string; scopes: string[]; until: string }[]; paired: { id: string; device: string; scopes: string[]; expiresAt: string; expired: boolean }[] };
    console.log(`door     ${s.listening ?? 'closed'}${s.window ? `, pairing window open until ${s.window}` : ''}`);
    for (const p of s.pending) console.log(`${p.state.padEnd(8)} ${p.code}  ${p.device} at ${p.peer}  asks ${p.scopes.join(',')}  until ${p.until}`);
    for (const p of s.paired) console.log(`paired   ${p.id}  ${p.device}  ${p.scopes.join(',')}  ${p.expired ? 'EXPIRED' : 'until'} ${p.expiresAt}`);
    if (!s.pending.length && !s.paired.length) console.log('nothing pending, nothing paired');
    break;
  }
  case 'open': {
    const a = needServer(await call('POST', '/lan/pair/open', {}));
    console.log(`pairing window open until ${a.body.window}; the door is ${a.body.listening ?? 'closed (see the server log)'}`);
    break;
  }
  case 'approve': {
    if (!subject) die('usage: pair approve <code> [--scope read,standup,place,focus,decide] [--days 1-30]');
    const scopeText = flag('--scope'), daysText = flag('--days');
    const scopes = scopeText?.split(',').map((s) => s.trim()).filter(Boolean);
    if (scopes && !scopes.every((s) => (SCOPES as readonly string[]).includes(s))) die(`--scope takes ${SCOPES.join(', ')}`);
    if (daysText !== undefined && !/^\d{1,2}$/.test(daysText)) die('--days takes an integer 1-30');
    const a = needServer(await call('POST', '/lan/pair/approve', { code: subject, ...(scopes ? { scopes: scopes as Scope[] } : {}), ...(daysText ? { days: Number(daysText) } : {}) }));
    const b = a.body as { device: string; peer: string; scopes: string[]; days: number };
    console.log(`approved ${b.device} at ${b.peer}: ${b.scopes.join(',')} for ${b.days} days, once it claims its token (2 min).`);
    console.log('The token travels as cleartext HTTP: a home network or a tailnet only (S8). `pair revoke <id>` ends it.');
    break;
  }
  case 'deny': {
    if (!subject) die('usage: pair deny <code>');
    needServer(await call('POST', '/lan/pair/deny', { code: subject }));
    console.log(`denied ${subject}`);
    break;
  }
  case 'revoke': {
    if (!subject || !/^[0-9a-f]{8}$/.test(subject)) die('usage: pair revoke <id> (the 8-hex id `pair list` shows)');
    const a = await call('POST', '/lan/pair/revoke', { id: subject });
    if (a !== 'down' && a.status === 200) { console.log(`revoked ${subject} (its requests in flight were cut)`); break; }
    if (a !== 'down' && a.status !== 404) die(String(a.body.error ?? `HTTP ${a.status}`));
    // no server with a door: the file is the registry, and a door started later reads it per request
    const rows = readRegistry();
    if (!rows.some((r) => r.id === subject)) die(`no pairing ${subject} in ${registryFile()}`);
    writeRegistry(rows.filter((r) => r.id !== subject));
    console.log(`revoked ${subject} in ${registryFile()}`);
    break;
  }
  default:
    die('usage: npm run server -- pair <list | open | approve <code> [--scope ..] [--days ..] | deny <code> | revoke <id>>');
}
