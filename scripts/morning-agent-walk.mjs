#!/usr/bin/env node
// An agent walks the Morning Watch through bp's MCP door - scripted, no model: it speaks MCP over stdio to the real
// door (apps/mcp/bp-mcp.mjs, through scripts/lib/mcp-door.mjs, the client the overnight agent brief-agent-demo.mjs uses),
// calls `morning_brief`, then `focus_show` for every card that shows a place, one every few seconds, with the card's
// headline as the line to say. Every following screen (web windows, the phone, the VR table or its stand-in) flies with
// it, and the lamp's focus moves the shared focus as "Glim". It is what a companion turn would do with the two tools;
// the choice of what to show is a fixed walk here where a model would decide.
// The agent hears the same brief the person reads: each decision card carries it (touches, the declines quoted, undo,
// cost), and on a repeat it says the brief's recommendation in the person's own words - and leaves the decision to them
// (it files nothing). A decision already taken this morning (on the deck, the plan or elsewhere) is said as taken and
// not shown again.
//   node scripts/morning-agent-walk.mjs [--base http://127.0.0.1:3313] [--every 4]
import { openDoor } from './lib/mcp-door.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const BASE = opt('--base', 'http://127.0.0.1:3313'), EVERY = Number(opt('--every', '4')) * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VERB = { approve: 'approved', defer: 'deferred', hold: 'held', decline: 'declined as a repeat' };

const door = await openDoor({ url: BASE, name: 'morning-agent-walk' }), call = (t, a) => door.call(t, a, { soft: true });
const deck = await call('morning_brief', {});
if (!Array.isArray(deck.cards)) { console.error('morning_brief answered no deck:', deck.error ?? deck.text ?? deck); door.close(); process.exit(1); }
console.log(`morning_brief: ${deck.cards.length} cards across ${deck.products.length} products (an agent's read of the door; no model is called)`);
// what this morning already decided: a deck verdict, or a decision taken elsewhere (its card drops off the next read)
const open = new Set();
try {
  const { items } = await call('inbox_list', { limit: 500 });
  for (const x of items ?? []) if (x.kind === 'proposal') open.add(x.product + ' ' + x.id);
} catch { /* without the inbox, the deck's own marks are all it knows */ }
for (const c of deck.cards) {
  const d = c.decision;
  const taken = d && (d.steered?.at >= deck.since ? VERB[d.steered.verdict] ?? d.steered.verdict : open.size && !open.has(c.product + ' ' + d.proposal) ? 'decided elsewhere' : null);
  if (taken) { console.log(`\n${c.headline}\n  · already ${taken} this morning: not shown again`); continue; }
  console.log(`\n${c.headline}`);
  for (const l of c.lines.slice(0, 3)) console.log(`  · ${l}`);
  if (d?.brief) {
    console.log('  brief (the lines the person reads on the card):');
    for (const l of d.brief.lines) console.log(`    ${l}`);
    if (d.brief.recommend === 'decline') console.log(`  -> the brief recommends Decline: ${d.brief.note} (the person decides; Enter on the deck)`);
    else if (d.brief.advice === 'ask') console.log('  -> like an idea they declined: it is theirs to decide; nothing is recommended');
  }
  const t = c.place?.target;
  if (!t || !['feature', 'room', 'wing'].includes(t.kind)) continue;
  const r = await call('focus_show', { product: c.place.product, kind: t.kind, id: t.id, say: c.headline.slice(0, 280) });
  console.log(`  -> focus_show ${c.place.product} ${t.kind} ${t.id}: ${r.id ? 'shown (every following screen flies)' : JSON.stringify(r).slice(0, 160)}`);
  await sleep(EVERY);
}
door.close();
