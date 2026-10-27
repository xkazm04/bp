#!/usr/bin/env node
// bp's MCP server (spark companion-upgrade, P3): the ONE tool door the companion's claude CLI (--mcp-config, server name
// `bp`, so its tools read mcp__bp__<wire name>) and any other agent use. stdio, JSON-RPC 2.0 over newline-delimited
// stdin/stdout, Node builtins only (no SDK); every log line goes to stderr, stdout carries protocol only.
// Methods: initialize (echoes the client's protocolVersion, serverInfo { name: 'bp' }, capabilities { tools: {} }),
// notifications/initialized, ping, tools/list and tools/call. The tool table is read at run time from
// packages/core/src/companion/catalog.ts (Node strips its types), never copied: tools/list is TOOLS projected to
// { name: wireName, description (+ ' [needs the person]' when GATED), inputSchema: params_schema }.
// tools/call is one HTTP call to bp at BP_URL (default http://127.0.0.1:3100), with `content-type: application/json` and
// `x-bp-conversation: $BP_CONVERSATION`, so the companion is a principal on the same door as every other client
// (registry mcp-tools first-party-agent-is-a-principal). The request comes from tool-call.ts, the one builder the cards
// route and athena host also use. An AUTO tool calls its route. A GATED tool NEVER calls its route: it POSTs
// /api/companion/cards { tool, args } and answers { card, state: 'pending' } (or the card a live policy grant ran). This
// process never holds the human token, so it cannot approve its own card (door.server.ts).
// Results are text, bounded to 8000 chars ("(truncated)"); an HTTP error or a refused call is `isError: true` with bp's
// error. Run: node apps/mcp/bp-mcp.mjs   (env BP_URL, BP_CONVERSATION)
import { createInterface } from 'node:readline';
import { TOOLS, classOf, wireName } from '../../packages/core/src/companion/catalog.ts';
import { bounded, toolOf, toolRequest } from '../../packages/core/src/server/api/companion/tool-call.ts';

const BASE = (process.env.BP_URL || 'http://127.0.0.1:3100').replace(/\/+$/, '');
const CONVERSATION = process.env.BP_CONVERSATION || '';
const log = (...a) => console.error('[bp-mcp]', ...a);

export const toolList = () => TOOLS.map((t) => ({
  name: wireName(t.name),
  description: t.description + (classOf(t) === 'GATED' ? ' [needs the person]' : ''),
  inputSchema: t.params_schema,
}));

const text = (s, isError = false) => ({ content: [{ type: 'text', text: bounded(s) }], ...(isError ? { isError: true } : {}) });

async function http(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(CONVERSATION ? { 'x-bp-conversation': CONVERSATION } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    redirect: 'manual',
    signal: AbortSignal.timeout(60000),
  });
  const raw = await res.text();
  let json;
  try { json = JSON.parse(raw); } catch { json = undefined; }
  return { ok: res.ok, status: res.status, raw, json };
}

async function callTool(name, args) {
  const t = toolOf(name);
  if (!t || wireName(t.name) !== name) return text(`no tool ${name}`, true);
  const req = toolRequest(t, args ?? {});
  if ('error' in req) return text(req.error, true);
  try {
    if (classOf(t) === 'GATED') {
      const r = await http('POST', '/api/companion/cards', { tool: t.name, args: args ?? {} });
      if (!r.ok) return text(`${r.status} ${r.json?.error ?? r.raw}`, true);
      const c = r.json;
      const out = c.state === 'pending'
        ? { card: c.id, state: 'pending', note: 'waiting for the person to approve it in bp; do not retry' }
        : { card: c.id, state: c.state, decidedBy: c.decidedBy, policy: c.policy, result: c.result };
      return text(JSON.stringify(out), c.state === 'failed');
    }
    const r = await http(req.method, req.path, req.body);
    if (!r.ok) return text(`${r.status} ${r.json?.error ?? r.raw}`, true);
    return text(r.json !== undefined ? JSON.stringify(r.json) : r.raw);
  } catch (e) {
    return text(`bp unreachable at ${BASE}: ${e.message}`, true);
  }
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case 'initialize':
      return reply(id, { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'bp', version: '1' } });
    case 'notifications/initialized': case 'notifications/cancelled': return;
    case 'ping': return reply(id, {});
    case 'tools/list': return reply(id, { tools: toolList() });
    case 'tools/call': {
      if (typeof params?.name !== 'string') return fail(id, -32602, 'tools/call needs params.name');
      return reply(id, await callTool(params.name, params.arguments));
    }
    default:
      if (isRequest) fail(id, -32601, `method not found: ${method}`);
  }
}

if (process.argv[1] && import.meta.filename === (await import('node:path')).resolve(process.argv[1])) {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let pending = 0, closed = false;
  const maybeExit = () => { if (closed && !pending) process.exit(0); };
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return send({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'invalid request' } });
    }
    pending++;
    handle(msg).catch((e) => { log('handler failed', e); if (msg.id !== undefined) fail(msg.id, -32603, `internal error: ${e.message}`); })
      .finally(() => { pending--; maybeExit(); });
  });
  rl.on('close', () => { closed = true; maybeExit(); });
  log(`ready, ${TOOLS.length} tools, bp at ${BASE}`);
}
