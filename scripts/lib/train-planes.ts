// The two planes apps/web/src/lib/scan/actions.ts answers the release train and the waves from, built for a parity check
// (scripts/check-train-parity.ts):
//   - sim: a ScanSim bound to the Kettle map (packages/core/data/kettle.app-structure.json), as check-train-sim binds it,
//     with a fake clock and a Map standing in for localStorage (the sample waves);
//   - live: a temp product whose lens-scan store is built from docs/standard/lens-scan-store.sql and written FROM a sim's
//     snapshot (every runs, packs, releases, proposals, measurements, activity and shots row), so both planes start from
//     the same rows; the routes behind it run over the fake Claude Code CLI (scripts/fixtures/fake-claude.mjs) and a fake
//     gh (BP_GH_BIN, signed out while FAKE_GH_OUT=1), store.mjs resolved as release.server.ts resolves it, and a fetch stub
//     hands the client's requests (client.ts) to the route handlers, as the dev server would route them.
// The caller registers scripts/overlays-loader.mjs before importing this (the routes import through '@/' and '@bp/core').
// reap() cancels every live job, disposes every sim, restores fetch, cwd, env and localStorage, and removes the temp dir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export interface LivePlane { slug: string; root: string; file: string; ctx: { slug: string; sim: null } }
export interface Planes {
  dir: string;
  /** The modules both planes run through (loaded through the caller's loader). */
  actions: Any;
  ScanSim: Any;
  jobs: Any;
  snapshotOf: (file: string) => Any;
  /** store.mjs as the routes resolve it; null when lens-scan is not installed here. */
  storeScript: string | null;
  /** A ScanSim bound to the Kettle map on the shared fake clock (the sample train seeded). */
  newSim(findings?: readonly Any[]): Any;
  /** A live product `slug` whose store is written from `snap` (a sim's snapshot). */
  liveFrom(slug: string, snap: Any): LivePlane;
  /** The shared fake clock (ms). */
  clock: { now: number };
  /** gh signed out (sim toggle ghOff on `sim`, FAKE_GH_OUT=1 for the live routes) or back in. */
  ghOut(sim: Any, on: boolean): void;
  reap(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The snapshot tables in the order their rows are written (parents first). */
const TABLES = ['runs', 'packs', 'releases', 'proposals', 'measurements', 'activity', 'shots'] as const;

/** Write `snap`'s rows into a fresh store at `file` (the DDL first). A snapshot key with no column throws, naming it. */
export function writeStore(root: string, file: string, snap: Any): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec(fs.readFileSync(path.join(root, 'docs/standard/lens-scan-store.sql'), 'utf8'));
    for (const t of TABLES) {
      const cols = new Set((db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name));
      for (const row of (snap[t] ?? []) as Record<string, unknown>[]) {
        const keys = Object.keys(row).filter((k) => row[k] !== undefined);
        const lost = keys.filter((k) => !cols.has(k));
        if (lost.length) throw new Error(`the ${t} table has no column for ${lost.join(', ')} (row ${String(row.id)}): the live plane would not hold the sim's row`);
        const vals = keys.map((k) => { const v = row[k]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v; });
        db.prepare(`INSERT INTO ${t} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...(vals as (string | number | null)[]));
      }
    }
  } finally { db.close(); }
}

/** The route handlers the client's requests reach: [path pattern, route module under apps/web/src/app/api, param names]. */
const ROUTES: [RegExp, string, string[]][] = [
  [/^\/api\/products\/([^/]+)\/triage$/, 'products/[slug]/triage/route.ts', ['slug']],
  [/^\/api\/products\/([^/]+)\/releases$/, 'products/[slug]/releases/route.ts', ['slug']],
  [/^\/api\/products\/([^/]+)\/releases\/suggest$/, 'products/[slug]/releases/suggest/route.ts', ['slug']],
  [/^\/api\/products\/([^/]+)\/releases\/([^/]+)\/build$/, 'products/[slug]/releases/[id]/build/route.ts', ['slug', 'id']],
  [/^\/api\/products\/([^/]+)\/releases\/([^/]+)\/finish$/, 'products/[slug]/releases/[id]/finish/route.ts', ['slug', 'id']],
  [/^\/api\/products\/([^/]+)\/commits\/([^/]+)$/, 'products/[slug]/commits/[sha]/route.ts', ['slug', 'sha']],
  [/^\/api\/products\/([^/]+)\/scans\/([^/]+)$/, 'products/[slug]/scans/[job]/route.ts', ['slug', 'job']],
  [/^\/api\/products\/([^/]+)\/waves$/, 'products/[slug]/waves/route.ts', ['slug']],
  [/^\/api\/products\/([^/]+)\/waves\/([^/]+)$/, 'products/[slug]/waves/[wave]/route.ts', ['slug', 'wave']],
  [/^\/api\/products\/([^/]+)\/waves\/([^/]+)\/dispatch$/, 'products/[slug]/waves/[wave]/dispatch/route.ts', ['slug', 'wave']],
];

export async function openPlanes(root: string): Promise<Planes> {
  const imp = (rel: string): Promise<Any> => import(pathToFileURL(path.join(root, rel)).href);
  const env0 = { BP_CLAUDE_BIN: process.env.BP_CLAUDE_BIN, BP_GH_BIN: process.env.BP_GH_BIN, FAKE_GH_OUT: process.env.FAKE_GH_OUT };
  process.env.BP_CLAUDE_BIN = path.join(root, 'scripts/fixtures/fake-claude.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-train-parity-'));
  const gh = path.join(dir, 'fake-gh.mjs');
  fs.writeFileSync(gh, "if (process.env.FAKE_GH_OUT === '1') { console.error('You are not logged into any GitHub hosts.'); process.exit(1); }\n"
    + "if (process.argv[2] === 'api') console.log('octocat');\nprocess.exit(0);\n");
  process.env.BP_GH_BIN = gh;
  delete process.env.FAKE_GH_OUT;
  delete (globalThis as { __bpGhBy?: unknown }).__bpGhBy;

  // the sample waves live in localStorage: a Map stands in, as check-waves does
  const G = globalThis as { localStorage?: unknown };
  const ls0 = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } } });

  const [actions, simMod, jobs, storeMod, relMod] = await Promise.all([imp('apps/web/src/lib/scan/actions.ts'), imp('packages/core/src/model/scan-sim.ts'),
    imp('packages/core/src/server/jobs.server.ts'), imp('packages/core/src/server/store.server.ts'), imp('packages/core/src/server/release.server.ts')]);
  const handlers = await Promise.all(ROUTES.map(([, rel]) => imp('apps/web/src/app/api/' + rel)));

  const structure = JSON.parse(fs.readFileSync(path.join(root, 'packages/core/data/kettle.app-structure.json'), 'utf8')) as { features: { slug: string }[]; lenses: { id: string; manifest: Any }[]; facets: Record<string, Record<string, { values?: Record<string, unknown> }>> };
  const order = structure.features.map((f) => f.slug), manifests = new Map(structure.lenses.map((l) => [l.id, l.manifest]));
  const mapValue = (f: string, l: string, k: string): number | undefined => { const v = structure.facets[f]?.[l]?.values?.[k]; return typeof v === 'number' ? v : undefined; };
  const clock = { now: Date.parse('2026-10-15T12:00:00.000Z') };
  const sims: Any[] = [];
  const newSim = (findings: readonly Any[] = []) => {
    const s = new simMod.ScanSim({ now: () => clock.now, findings });
    s.bind({ order, manifest: (l: string) => manifests.get(l), value: mapValue });
    sims.push(s);
    return s;
  };

  const products: { slug: string; name: string; root: string }[] = [];
  const liveFrom = (slug: string, snap: Any): LivePlane => {
    const proot = path.join(dir, slug), file = path.join(proot, '.ai/lens-scan/scan.db');
    writeStore(root, file, snap);
    products.push({ slug, name: slug, root: proot });
    fs.writeFileSync(path.join(dir, 'bp.products.local.json'), JSON.stringify({ products }));
    return { slug, root: proot, file, ctx: { slug, sim: null } };
  };

  const cwd0 = process.cwd();
  process.chdir(dir);
  const fetch0 = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input), 'http://localhost:3000');
    const req = new Request(u, { ...init, headers: { host: 'localhost:3000', ...(init?.headers as Record<string, string> | undefined) } });
    for (let i = 0; i < ROUTES.length; i++) {
      const [re, rel, names] = ROUTES[i], m = u.pathname.match(re);
      if (!m) continue;
      const fn = handlers[i][req.method];
      if (typeof fn !== 'function') throw new Error(`unrouted ${req.method} ${u.pathname} (${rel} has no ${req.method})`);
      return fn(req, { params: Promise.resolve(Object.fromEntries(names.map((n, j) => [n, decodeURIComponent(m[j + 1])]))) });
    }
    throw new Error('unrouted request ' + u.pathname);
  }) as typeof fetch;

  const ghOut = (sim: Any, on: boolean) => {
    sim.setTrainToggles({ ghOff: on, conflict: false, gateFails: false });
    if (on) process.env.FAKE_GH_OUT = '1'; else delete process.env.FAKE_GH_OUT;
  };

  const reap = async () => {
    for (const p of products) for (const j of jobs.list(p.slug)) if (j.status === 'queued' || j.status === 'running') jobs.cancel(p.slug, j.id);
    for (const s of sims) s.dispose();
    globalThis.fetch = fetch0;
    process.chdir(cwd0);
    for (const [k, v] of Object.entries(env0)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    if (ls0) Object.defineProperty(globalThis, 'localStorage', ls0); else delete G.localStorage;
    await sleep(300); // a cancelled child lets go of its files
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a dying child still holds a file */ }
  };

  return { dir, actions, ScanSim: simMod.ScanSim, jobs, snapshotOf: storeMod.snapshotOf, storeScript: relMod.storeScript(), newSim, liveFrom, clock, ghOut, reap };
}
