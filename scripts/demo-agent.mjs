#!/usr/bin/env node
// DEMO: an agent on bp's MCP door, meeting the owner's standing rules (hackathon pack "Rules you set once"). It spawns
// apps/mcp/bp-mcp.mjs (the one door every agent uses) against a running bp (BP_URL, default the entry's headless server
// http://127.0.0.1:3411) and plays five tool calls a building agent would make on the throwaway product, printing what the
// door answered in plain lines. No model is called: this script IS the agent, scripted.
//   1 rules_list      what may I not do here?
//   2 inbox_list      the open findings, with the orders that hold them and the grants that free them
//   3 wave_compose    a wave mixing a held finding and a free one: the held one is left out, the order cited
//   4 scan_place      a scan inside a held place: refused, the order cited
//   5 rule_propose    (with --propose) the agent proposes a rule; the owner sees its replay on the card
//   node scripts/demo-agent.mjs [--slug kettle-live] [--propose]
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const SLUG = opt('--slug') ?? 'kettle-live', URL = process.env.BP_URL ?? 'http://127.0.0.1:3411';
const mcp = spawn(process.execPath, [path.join(ROOT, 'apps/mcp/bp-mcp.mjs')], { env: { ...process.env, BP_URL: URL, BP_CONVERSATION: 'demo-agent' }, stdio: ['pipe', 'pipe', 'inherit'] });
const waiting = new Map(); let next = 1;
createInterface({ input: mcp.stdout }).on('line', (l) => { let m; try { m = JSON.parse(l); } catch { return; } waiting.get(m.id)?.(m); waiting.delete(m.id); });
const rpc = (method, params) => new Promise((resolve) => { const id = next++; waiting.set(id, resolve); mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const call = async (name, args) => {
  const r = await rpc('tools/call', { name, arguments: args });
  const text = r.result?.content?.[0]?.text ?? r.error?.message ?? '';
  let json; try { json = JSON.parse(text); } catch { /* text */ }
  return { err: r.result?.isError === true, text, json };
};
const say = (s = '') => console.log(s);
const head = (n, s) => say(`\n\x1b[1m${n}  ${s}\x1b[0m`);

await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'demo-agent', version: '1' } });

head('1', `rules_list { slug: ${SLUG} }`);
const rl = await call('rules_list', { slug: SLUG });
if (rl.err) { say('  ' + rl.text); process.exit(1); }
const now = Date.now(), live = (rl.json?.rules ?? []).filter((r) => !r.revokedAt && (!r.expiresAt || Date.parse(r.expiresAt) > now));
if (!live.length) say('  no live rules: every door is open (set one in the web app: Rules)');
for (const r of live) say(`  ${r.id}  ${r.kind.padEnd(5)}  "${r.text}"  over ${r.scope.label}  set by ${r.by}`);

head('2', 'inbox_list { limit: 20 }');
const ib = await call('inbox_list', { limit: 20 });
const mine = (ib.json?.items ?? []).filter((x) => x.product === SLUG && x.kind === 'proposal');
for (const x of mine.slice(0, 8)) say(`  ${x.id.padEnd(14)} ${x.heldBy ? `\x1b[33mheld by ${x.heldBy}\x1b[0m` : x.grant ? `\x1b[32m${x.grant} lets me approve it\x1b[0m` : 'open'.padEnd(11)}  ${x.title}`);

const held = mine.find((x) => x.heldBy), free = mine.find((x) => !x.heldBy);
head('3', `wave_compose { packages: [ ${[held?.id, free?.id].filter(Boolean).join(', ')} ] }`);
if (!held && !free) say('  nothing open to compose');
else {
  const wc = await call('wave_compose', { slug: SLUG, name: 'Agent wave (demo)', packages: [{ name: 'fixes', model: 'sonnet', effort: 'medium', ids: [held?.id, free?.id].filter(Boolean) }] });
  if (wc.err) say(`  \x1b[33mREFUSED\x1b[0m ${wc.text}`);
  else {
    say(`  wave ${wc.json.wave.id} drafted with ${wc.json.wave.packages.flatMap((p) => p.ids).join(', ')}`);
    if (wc.json.note) say(`  \x1b[33m${wc.json.note}\x1b[0m`);
  }
}

const cap = live.find((r) => r.kind === 'cap');
if (cap && free) {
  head('3b', `wave_compose { ${free.id} on opus at xhigh effort } under ${cap.id}`);
  const wx = await call('wave_compose', { slug: SLUG, name: 'Big build (demo)', packages: [{ name: 'deep', model: 'opus', effort: 'xhigh', ids: [free.id] }] });
  say(wx.err ? `  \x1b[33mREFUSED\x1b[0m ${wx.json?.error ?? wx.text}` : `  drafted ${wx.json?.wave?.id}${wx.json?.note ? ' - ' + wx.json.note : ''}`);
}

const order = live.find((r) => r.kind === 'hold' && r.scope.features.length);
head('4', `scan_place { lens: design, scope: ${order ? order.scope.features[0] : '(no hold to test)'} }`);
if (order) {
  const f = order.scope.features[0];
  const sp = await call('scan_place', { slug: SLUG, lens: 'design', scope: { kind: 'feature', id: f, label: f, features: [f] } });
  say(sp.err ? `  \x1b[33mREFUSED\x1b[0m ${sp.json?.error ?? sp.text}` : `  queued: ${sp.text.slice(0, 160)}`);
}

if (argv.includes('--propose')) {
  head('5', 'rule_propose { kind: grant, scope: everything, any tier, 24 h }');
  const rp = await call('rule_propose', { slug: SLUG, kind: 'grant', hours: 24, scope: { kind: 'all', label: 'Everything', features: [] }, text: 'Agents may approve any finding on their own' });
  say(rp.err ? '  ' + rp.text : `  card ${rp.json?.card} ${rp.json?.state}: the owner sees it on the lamp with its replay`);
}
say();
mcp.stdin.end();
