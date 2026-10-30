// bp's MCP door for the scripted agents (no model is called anywhere): spawns apps/mcp/bp-mcp.mjs and speaks MCP over
// stdio JSON-RPC exactly as the companion's CLI would (initialize, tools/list, tools/call). One client for both scripted
// walks of the one story - the overnight agent that reads the brief before proposing (scripts/brief-agent-demo.mjs) and
// the morning walk that reads the standup with every decision card's brief (scripts/morning-agent-walk.mjs) - so they
// stand on the same door, the same data and the same conversation header (BP_CONVERSATION -> the agent trail).
//   const door = await openDoor({ url, conversation, name }); await door.call('morning_brief', {}); door.close();
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The door against a running bp (apps/server or the web) at `url`. `conversation` names the agent's session for the trail. */
export async function openDoor({ url, conversation, name = 'scripted-agent' }) {
  const env = { ...process.env, BP_URL: url, ...(conversation ? { BP_CONVERSATION: conversation } : {}) };
  const mcp = spawn(process.execPath, [path.join(ROOT, 'apps/mcp/bp-mcp.mjs')], { env, stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map();
  createInterface({ input: mcp.stdout }).on('line', (l) => {
    let m;
    try { m = JSON.parse(l); } catch { return; } // not a JSON-RPC line
    waiting.get(m.id)?.(m); waiting.delete(m.id);
  });
  let seq = 0;
  const rpc = (method, params) => new Promise((res) => { const id = ++seq; waiting.set(id, res); mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  /** A tool's JSON answer; a tool error throws, unless `soft` (then `{ error }`). */
  const call = async (tool, args, { soft = false } = {}) => {
    const m = await rpc('tools/call', { name: tool, arguments: args });
    const t = m.result?.content?.[0]?.text ?? m.error?.message ?? '';
    if (m.result?.isError || m.error) { if (soft) return { error: t }; throw new Error(`${tool}: ${t}`); }
    try { return JSON.parse(t); } catch { return { text: t }; }
  };
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version: '1' } });
  return { rpc, call, tools: async () => (await rpc('tools/list', {})).result?.tools ?? [], close: () => { try { mcp.stdin.end(); } catch { /* gone */ } } };
}
