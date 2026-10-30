#!/usr/bin/env node
// An agent walks the Morning Watch through bp's MCP door - scripted, no model: it speaks MCP over stdio to the real
// door (apps/mcp/bp-mcp.mjs), calls `morning_brief`, then `focus_show` for every card that shows a place, one every
// few seconds, with the card's headline as the line to say. Every following screen (web windows, the phone, the VR
// table or its stand-in) flies with it, and the lamp's focus moves the shared focus as "Glim". It is what a companion
// turn would do with the two tools; the choice of what to show is a fixed walk here where a model would decide.
//   node scripts/morning-agent-walk.mjs [--base http://127.0.0.1:3313] [--every 4]
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const BASE = opt('--base', 'http://127.0.0.1:3313'), EVERY = Number(opt('--every', '4')) * 1000;
const door = spawn(process.execPath, [path.join(ROOT, 'apps/mcp/bp-mcp.mjs')], { env: { ...process.env, BP_URL: BASE }, stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '', id = 0;
const waiting = new Map();
door.stdout.on('data', (b) => {
  buf += String(b);
  let k;
  while ((k = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, k); buf = buf.slice(k + 1);
    try { const m = JSON.parse(line); waiting.get(m.id)?.(m); waiting.delete(m.id); } catch { /* not ours */ }
  }
});
const rpc = (method, params) => new Promise((resolve) => { const n = ++id; waiting.set(n, resolve); door.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
const call = async (name, args) => { const r = await rpc('tools/call', { name, arguments: args }); const t = r.result?.content?.[0]?.text ?? ''; try { return JSON.parse(t); } catch { return { text: t, isError: r.result?.isError }; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'morning-agent-walk', version: '0' } });
const deck = await call('morning_brief', {});
if (!Array.isArray(deck.cards)) { console.error('morning_brief answered no deck:', deck.text ?? deck); door.kill(); process.exit(1); }
console.log(`morning_brief: ${deck.cards.length} cards across ${deck.products.length} products (an agent's read of the door; no model is called)`);
for (const c of deck.cards) {
  console.log(`\n${c.headline}`);
  for (const l of c.lines.slice(0, 3)) console.log(`  · ${l.text}`);
  const t = c.place?.target;
  if (!t || !['feature', 'room', 'wing'].includes(t.kind)) continue;
  const r = await call('focus_show', { product: c.place.product, kind: t.kind, id: t.id, say: c.headline.slice(0, 280) });
  console.log(`  -> focus_show ${c.place.product} ${t.kind} ${t.id}: ${r.id ? 'shown (every following screen flies)' : JSON.stringify(r).slice(0, 160)}`);
  await sleep(EVERY);
}
door.kill();
