// The VR table, headless: a stand-in reader of the shared focus (packages/core/src/session/focus.ts) for when the headset
// is not on. It says hello as `VR table (stand-in)`, follows whoever moves, hears `event: shared` on the companion stream,
// resolves each place on the product's own plan (GET /api/products/<slug>/plan: a room, a bay's room, a wing, or a
// feature's room - the same resolution the table makes) and "flies" there: an eased 0.8 s move printed as the table's
// framing, with the line the publisher said. It never applies its own writes and never publishes what it was sent.
// With --lead, `n` moves the stand-in to the next room on its own and publishes it (the headset leading; the web follows).
//   node --import @bp/core/register scripts/focus-standin.ts [--base http://127.0.0.1:3313] [--lead] [--once] [--reader vr:standin]
// --once exits 0 after the first place it applied (scripts/check-morning-watch.ts drives it that way), 1 after 20 s without one.
import { toApply, type FocusPlace, type SharedView } from '../packages/core/src/session/focus.ts';

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const BASE = opt('--base', 'http://127.0.0.1:3313').replace(/\/$/, ''), ONCE = argv.includes('--once'), LEAD = argv.includes('--lead');
const ME = opt('--reader', 'vr:standin'), LABEL = opt('--label', 'VR table (stand-in)');
const tty = process.stdout.isTTY, dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s), hi = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s);

interface Node { id: string; name: string; parentId?: string }
interface Plan { wings: Node[]; rooms: Node[]; bays: Node[]; tiles: Node[] }
const plans = new Map<string, Plan>();
async function planOf(product: string): Promise<Plan | null> {
  if (plans.has(product)) return plans.get(product)!;
  try { const r = await fetch(`${BASE}/api/products/${encodeURIComponent(product)}/plan`); if (!r.ok) return null; const p = (await r.json()) as Plan; plans.set(product, p); return p; } catch { return null; }
}
/** Where the table frames a place: its room (and the wing), from a room, a bay, a wing or a feature id. */
function resolve(plan: Plan, p: FocusPlace): { room?: Node; wing?: Node; what: string } {
  const by = (xs: Node[], id?: string) => xs.find((x) => x.id === id);
  const t = p.target, id = t?.id;
  if (!t || t.kind === 'site') return { what: 'the whole site' };
  const tile = t.kind === 'feature' ? by(plan.tiles, id) : undefined;
  const bay = tile ? by(plan.bays, tile.parentId) : by(plan.bays, id);
  const room = by(plan.rooms, bay?.parentId ?? id);
  const wing = by(plan.wings, room?.parentId ?? id);
  return { room, wing, what: tile ? `${tile.name}, in ${room?.name ?? '?'}` : bay ? `${bay.name}, in ${room?.name ?? '?'}` : room ? room.name : wing ? `wing ${wing.name}` : `${t.kind} ${id} (not on this plan: the table stays)` };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let framed = 'the whole site', applied = 0, flights = 0;
async function fly(p: FocusPlace, from: string): Promise<void> {
  const plan = await planOf(p.product), where = plan ? resolve(plan, p) : { what: `${p.target?.kind ?? 'site'} ${p.target?.id ?? ''} (no plan for ${p.product})` };
  const n = ++flights;
  console.log(`\n${hi('▸ Following ' + from)} ${dim('·')} ${p.product}${p.say ? dim('  "' + p.say + '"') : ''}`);
  // the table's move, eased (cubic in-out) over 0.8 s: the framing slides from where it was to where it goes
  const W = 28;
  for (let i = 1; i <= 8; i++) {
    if (n !== flights) return; // a newer place arrived mid-flight: it wins
    const x = i / 8, e = x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2, k = Math.round(e * W);
    if (tty) process.stdout.write(`\r  ${dim(framed.slice(0, 24).padEnd(24))} [${'='.repeat(k)}>${' '.repeat(W - k)}] ${where.what.slice(0, 40)}`);
    await sleep(100);
  }
  framed = where.what;
  console.log(`${tty ? '\r' : '  '}  table framed on ${hi(where.what)}${where.wing && where.room ? dim(' · wing ' + where.wing.name) : ''}${' '.repeat(20)}`);
}

async function post(body: Record<string, unknown>): Promise<SharedView | null> {
  try {
    const r = await fetch(`${BASE}/api/session/focus`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reader: ME, surface: 'standin', label: LABEL, ...body }) });
    const j = (await r.json()) as { view?: SharedView; error?: string };
    if (!r.ok) { console.error(`focus ${body.op}: ${r.status} ${j.error ?? ''}`); return null; }
    return j.view ?? null;
  } catch (e) { console.error(`focus ${body.op}: ${(e as Error).message}`); return null; }
}

async function take(v: SharedView): Promise<void> {
  const p = toApply(v, ME, '*', applied);
  if (v.rev > applied) applied = v.rev;
  if (!p || !v.shared) return;
  await fly(p, v.shared.label);
  if (ONCE) { await post({ op: 'forget' }); process.exit(0); }
}

async function stream(): Promise<void> {
  for (;;) {
    try {
      const r = await fetch(`${BASE}/api/companion/stream`, { headers: { accept: 'text/event-stream' } });
      if (!r.ok || !r.body) throw new Error(`stream ${r.status}`);
      const dec = new TextDecoder();
      let buf = '';
      for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
        buf += dec.decode(chunk, { stream: true }).replace(/\r/g, '');
        let k: number;
        while ((k = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, k); buf = buf.slice(k + 2);
          const ev = /^event: (.*)$/m.exec(block)?.[1], data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
          if (ev !== 'shared' || !data) continue;
          try { const e = JSON.parse(data) as { shared?: SharedView }; if (e.shared) void take(e.shared); } catch { /* malformed: skipped */ }
        }
      }
    } catch (e) { console.error(dim(`(stream: ${(e as Error).message}; again in 2 s)`)); }
    await sleep(2000);
  }
}

console.log(`${hi(LABEL)} ${dim('- a headless stand-in for the VR light table, following the shared focus at ' + BASE)}`);
const first = await post({ op: 'hello' });
if (!first) { console.error('the server is not reachable: start bp first (see .hackathon/DEMO.md)'); process.exit(2); }
await post({ op: 'follow', of: '*' });
applied = first.rev; // the place already shared is where the table opens; it moves with the next one
console.log(dim(first.shared ? `opening at ${first.shared.place.product} ${first.shared.place.target?.id ?? 'site'} (shared by ${first.shared.label})` : 'nothing shared yet: waiting'));
if (first.shared) { const plan = await planOf(first.shared.place.product); framed = plan ? resolve(plan, first.shared.place).what : framed; }
setInterval(() => void post({ op: 'hello' }), 15_000);
if (ONCE) setTimeout(() => { console.error('no place in 20 s'); process.exit(1); }, 20_000);
if (LEAD && process.stdin.isTTY) {
  console.log(dim('--lead: press n to move the table to the next room (it publishes; following screens fly), q to quit'));
  process.stdin.setRawMode(true); process.stdin.resume();
  let k = 0;
  process.stdin.on('data', async (b) => {
    const c = b.toString();
    if (c === 'q' || c === '\u0003') { await post({ op: 'forget' }); process.exit(0); }
    if (c !== 'n') return;
    const v = await post({ op: 'hello' }), product = v?.shared?.place.product ?? 'kettle', plan = await planOf(product);
    if (!plan?.rooms.length) return;
    const room = plan.rooms[k++ % plan.rooms.length];
    framed = room.name;
    console.log(`\n${hi('◂ The table leads')}: ${room.name} ${dim('(' + product + ')')}`);
    await post({ op: 'publish', place: { product, target: { kind: 'room', id: room.id }, level: 'L2', say: `The table moved to ${room.name}` } });
  });
}
void stream();
