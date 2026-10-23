#!/usr/bin/env node
// A minimal client for UE 5.8's editor MCP server (ModelContextProtocol plugin, Streamable HTTP at
// http://127.0.0.1:8770/mcp as apps/vr/tools/mcp-editor.mjs starts it, loopback, no auth), so a session that did not load the server at start can still use it,
// and so every call that MAKES content is logged as a replayable step (spark vr-table, 2026-10-23).
//
// The server advertises three meta-tools (tool search on): list_toolsets, describe_toolset, call_tool.
//
//   node apps/vr/tools/mcp-call.mjs toolsets                          # list_toolsets
//   node apps/vr/tools/mcp-call.mjs describe <toolset_name>           # describe_toolset
//   node apps/vr/tools/mcp-call.mjs call <toolset_name> <tool_name> '<json arguments>' [--log <steps.jsonl>]
//   node apps/vr/tools/mcp-call.mjs python <file.py> [--log <steps.jsonl>]   # PoFScriptTools.run_python on a file
//   node apps/vr/tools/mcp-call.mjs replay <steps.jsonl>               # re-run every logged call, in order
//   node apps/vr/tools/mcp-call.mjs raw <method> '<json params>'       # any JSON-RPC method (tools/list, ...)
//
// --log appends {"ts","toolset","tool","arguments","ok"} to the file; a step that failed is logged with ok:false and is
// skipped by replay. Prints the tool result's text. Exit 0 ok, 1 the tool reported an error, 2 transport failure.
// MCP_URL overrides the endpoint.
import fs from 'node:fs';
import path from 'node:path';

const URL_ = process.env.MCP_URL ?? `http://127.0.0.1:${process.env.BP_MCP_PORT ?? 8770}/mcp`;
const POF_SCRIPT = 'pof_toolset.toolsets.script.PoFScriptTools';
let sessionId = null;
let nextId = 1;

async function rpc(method, params, { notify = false } = {}) {
  const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: nextId++, method, params };
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const res = await fetch(URL_, { method: 'POST', headers, body: JSON.stringify(body) });
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  if (notify) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${method}: ${text.slice(0, 400)}`);
  const type = res.headers.get('content-type') ?? '';
  let msg;
  if (type.includes('text/event-stream')) {
    // The response arrives as SSE events; take the JSON-RPC message that answers this id.
    const datas = text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean);
    msg = datas.map((d) => { try { return JSON.parse(d); } catch { return null; } }).find((m) => m && m.id === body.id);
  } else {
    msg = JSON.parse(text);
  }
  if (!msg) throw new Error(`no JSON-RPC answer to ${method} in: ${text.slice(0, 400)}`);
  if (msg.error) throw new Error(`${method}: ${JSON.stringify(msg.error)}`);
  return msg.result;
}

async function connect() {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bp-mcp-call', version: '1' } });
  await rpc('notifications/initialized', {}, { notify: true });
}

const textOf = (result) => (result?.content ?? []).map((c) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n');

async function callTool(toolset_name, tool_name, args) {
  const result = await rpc('tools/call', { name: 'call_tool', arguments: { toolset_name, tool_name, arguments: args } });
  return { ok: !result?.isError, text: textOf(result) };
}

function logStep(file, step) {
  if (!file) return;
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...step })}\n`);
}

const argv = process.argv.slice(2);
const logIdx = argv.indexOf('--log');
const logFile = logIdx >= 0 ? argv.splice(logIdx, 2)[1] : null;
const [cmd, ...rest] = argv;

try {
  await connect();
  let out;
  if (cmd === 'toolsets') {
    out = textOf(await rpc('tools/call', { name: 'list_toolsets', arguments: {} }));
  } else if (cmd === 'describe') {
    out = textOf(await rpc('tools/call', { name: 'describe_toolset', arguments: { toolset_name: rest[0] } }));
  } else if (cmd === 'call') {
    const args = rest[2] ? JSON.parse(rest[2]) : {};
    const r = await callTool(rest[0], rest[1], args);
    logStep(logFile, { toolset: rest[0], tool: rest[1], arguments: args, ok: r.ok });
    console.log(r.text);
    process.exit(r.ok ? 0 : 1);
  } else if (cmd === 'python') {
    const script = fs.readFileSync(rest[0], 'utf8');
    const r = await callTool(POF_SCRIPT, 'run_python', { script });
    logStep(logFile, { toolset: POF_SCRIPT, tool: 'run_python', arguments: { script }, source: rest[0], ok: r.ok });
    console.log(r.text);
    process.exit(r.ok ? 0 : 1);
  } else if (cmd === 'replay') {
    const steps = fs.readFileSync(rest[0], 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)).filter((s) => s.ok);
    for (const [i, s] of steps.entries()) {
      const r = await callTool(s.toolset, s.tool, s.arguments);
      console.log(`step ${i + 1}/${steps.length} ${s.tool}: ${r.ok ? 'ok' : 'FAILED'} ${r.text.slice(0, 200)}`);
      if (!r.ok) process.exit(1);
    }
    process.exit(0);
  } else if (cmd === 'raw') {
    out = JSON.stringify(await rpc(rest[0], rest[1] ? JSON.parse(rest[1]) : {}), null, 2);
  } else {
    console.error('usage: mcp-call.mjs toolsets | describe <toolset> | call <toolset> <tool> <json> | python <file.py> | replay <steps.jsonl> | raw <method> <json>');
    process.exit(2);
  }
  console.log(out);
} catch (e) {
  console.error(`MCP_ERROR: ${e.message} (is the editor up? node apps/vr/tools/mcp-editor.mjs start)`);
  process.exit(2);
}
