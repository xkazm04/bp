// Pure: one catalog tool call -> the one HTTP request that performs it (spark companion-upgrade, P3). The tool door's three
// executors share it, so a tool means the same request whichever door runs it: the MCP server (apps/mcp/bp-mcp.mjs, over
// HTTP), the cards route (an approved or policy-covered card, in-process fetch to its own origin) and apps/server's athena
// host (its own route table). Path params fill the route template, URI-encoded and refused when a dot segment or empty (a
// `..` would fold the path into another route); the rest go to the body for a write and to the query string for a GET.
// Imports only the catalog (relative, `.ts`), so plain Node runs it from the MCP process with no loader.
import { TOOLS, classOf, wireName, type ToolSpec } from '../../../companion/catalog.ts';

/** Body fields a tool's route needs that are not the model's to choose. CONTRACT AMENDMENT pending (report P3): the catalog
 *  should carry these as `route.fixed`; until it does, this is the one place they live. finding.decline shares
 *  decision.answer's route, which refuses a body without `decision`. */

/** The largest result text a tool hands back to the model (untrusted-result-handling: a cap is door policy). */
export const RESULT_CAP = 8000;
export const bounded = (text: string): string => (text.length > RESULT_CAP ? text.slice(0, RESULT_CAP) + ' (truncated)' : text);

/** A tool by its dotted or wire name. */
export const toolOf = (name: unknown): ToolSpec | undefined =>
  typeof name === 'string' ? TOOLS.find((t) => t.name === name || wireName(t.name) === name) : undefined;
export const isGated = (t: ToolSpec): boolean => classOf(t) === 'GATED';

export interface ToolRequest { method: ToolSpec['route']['method']; path: string; body?: Record<string, unknown> }

const DOT = /^\.{1,2}$/;
/** The request for `args`, or the reason there is none (a missing required param, a bad path param). */
export function toolRequest(t: ToolSpec, args: unknown): ToolRequest | { error: string } {
  if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))) return { error: `${wireName(t.name)}: arguments must be an object` };
  const a = { ...(args as Record<string, unknown> | undefined) };
  const missing = (t.params_schema.required ?? []).filter((k) => a[k] === undefined || a[k] === null || a[k] === '');
  if (missing.length) return { error: `${wireName(t.name)}: missing ${missing.join(', ')}` };
  let bad = '';
  const path = t.route.path.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = a[k];
    delete a[k];
    if (typeof v !== 'string' || !v || DOT.test(v)) { bad ||= `${k} must be a non-empty id`; return '_'; }
    return encodeURIComponent(v);
  });
  if (bad) return { error: `${wireName(t.name)}: ${bad}` };
  if (t.route.method === 'GET') {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(a)) if (v !== undefined && v !== null) q.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    // a GET's fixed fields are query parameters that are not the model's to choose (morning.brief's view=agent)
    for (const [k, v] of Object.entries(t.route.fixed ?? {})) q.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    const qs = q.toString();
    return { method: 'GET', path: qs ? `${path}?${qs}` : path };
  }
  return { method: t.route.method, path, body: { ...a, ...t.route.fixed } };
}

/** The product a call is about: `slug`, else `product`, when a string. */
export const productOf = (args: unknown): string | undefined => {
  const a = (args ?? {}) as Record<string, unknown>;
  return typeof a.slug === 'string' ? a.slug : typeof a.product === 'string' ? a.product : undefined;
};
