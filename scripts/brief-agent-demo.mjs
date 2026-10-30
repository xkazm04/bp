#!/usr/bin/env node
// SCRIPTED AGENT - no model is called. A labelled stand-in for an agent on bp's MCP door, so the decision brief's agent
// half can be shown without spend: it drives apps/mcp/bp-mcp.mjs over stdio JSON-RPC exactly as the companion's CLI
// would (initialize, tools/list, tools/call), against a running apps/server. Its "reasoning" is three fixed rules, said
// out loud as it goes:
//   1. before proposing, find the feature (plan.find) and read its brief (plan.brief) with the draft's words;
//   2. advice 'withdraw' -> do not propose; quote the decline it heard;
//   3. then look for open proposals that repeat a declined idea (inbox.list + plan.brief on each) and recommend
//      declining them in the person's own words (decision.recommend, AUTO: it decides nothing).
// Every call carries BP_CONVERSATION, so bp keeps the agent trail the cards slip shows.
//   node scripts/brief-agent-demo.mjs [--url http://127.0.0.1:3412] [--product kettle-live]
//        [--feature "card payments"] [--draft "Add retry to checkout"] [--quiet]
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const URL_ = opt('--url', 'http://127.0.0.1:3412'), PRODUCT = opt('--product', 'kettle-live');
const PLACE = opt('--feature', 'card payments'), DRAFT = opt('--draft', 'Add retry to checkout');
const CONVERSATION = `demo-agent-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`;

const mcp = spawn(process.execPath, [path.join(ROOT, 'apps/mcp/bp-mcp.mjs')], { env: { ...process.env, BP_URL: URL_, BP_CONVERSATION: CONVERSATION }, stdio: ['pipe', 'pipe', 'inherit'] });
const waiting = new Map();
createInterface({ input: mcp.stdout }).on('line', (l) => { const m = JSON.parse(l); waiting.get(m.id)?.(m); waiting.delete(m.id); });
let seq = 0;
const rpc = (method, params) => new Promise((res) => { const id = ++seq; waiting.set(id, res); mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
async function call(name, args) {
  const m = await rpc('tools/call', { name, arguments: args });
  const t = m.result?.content?.[0]?.text ?? m.error?.message ?? '';
  if (m.result?.isError || m.error) throw new Error(`${name}: ${t}`);
  return JSON.parse(t);
}
const say = (s = '') => console.log(s);
const step = (s) => say(`\n> ${s}`);

try {
  say(`SCRIPTED AGENT (no model is called) · conversation ${CONVERSATION} · bp at ${URL_}`);
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'brief-agent-demo', version: '1' } });
  const { result: { tools } } = await rpc('tools/list', {});
  const brief = tools.find((t) => t.name === 'plan_brief');
  say(`tools/list: ${tools.length} tools from catalog.ts; plan_brief ${brief ? 'is there' + (brief.description.includes('[needs the person]') ? ' (GATED)' : ' (AUTO: runs without asking)') : 'is MISSING'}`);
  if (!brief) process.exit(1);

  step(`I am about to propose "${DRAFT}". Rule 1: find the feature and read its brief first.`);
  const found = await call('plan_find', { product: PRODUCT, q: PLACE, limit: 3 });
  const f = found.matches.find((x) => x.kind === 'feature');
  if (!f) throw new Error(`no feature matches "${PLACE}" on ${PRODUCT}`);
  say(`plan.find "${PLACE}" -> ${f.name} (${f.id}) in ${f.parent ?? 'the plan'}`);
  const b = await call('plan_brief', { product: PRODUCT, feature: f.id, title: DRAFT });
  say('plan.brief ->'); for (const l of b.lines) say('  ' + l);
  say(`advice: ${b.advice.say} - ${b.advice.why}`);

  if (b.advice.say === 'withdraw') {
    step(`Rule 2: a matching decline stands. I withdraw "${DRAFT}" and propose nothing.`);
    const declined = new Set(b.declines.map((d) => d.id));
    step('Rule 3: does an open proposal repeat a declined idea? Reading the inbox.');
    const { items } = await call('inbox_list', { limit: 50 });
    const open = items.filter((x) => x.product === PRODUCT && x.kind === 'proposal');
    say(`inbox.list -> ${open.length} open proposals on ${PRODUCT}`);
    let n = 0;
    for (const x of open) {
      const ob = await call('plan_brief', { product: PRODUCT, id: x.id });
      const d = ob.declines.find((y) => declined.has(y.id));
      if (ob.advice.say !== 'withdraw' || !d) continue;
      const why = `Repeats an idea you declined ${d.at} (${d.id})${d.note ? `: "${d.note}"` : ''}`;
      await call('decision_recommend', { slug: PRODUCT, id: x.id, verdict: 'decline', why });
      say(`decision.recommend decline ${x.id} "${x.title}" -> ${why}`);
      n++;
    }
    if (!n) say('none repeats it: nothing to recommend.');
  } else if (b.advice.say === 'ask') {
    step(`Rule 2: ${b.advice.why}. Not a stand against "${DRAFT}", but close: I would ask the person first; this script stops here.`);
  } else {
    step(`Rule 2: no decline stands against "${DRAFT}" (${b.advice.why}). I would propose it now; this script stops here.`);
  }
  say(`\ndone. The person's cards slip shows this conversation (${CONVERSATION}): the brief it read and what it did next.`);
} catch (e) {
  console.error(`brief-agent-demo: ${e.message}`);
  process.exitCode = 1;
} finally { mcp.stdin.end(); }
