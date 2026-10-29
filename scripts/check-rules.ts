// Gate for the owner's standing rules (hackathon pack "Rules you set once"): packages/core/src/scan/rules.ts (the gate, the
// backtest, the draft check) and the doors that honour it, end to end through apps/server and the bp MCP door.
//   pure     gate: a hold leaves out what it covers and refuses an act all of whose items it holds; `only` holds other
//            lenses; a cap holds only above its effort (and only its model); expired and revoked rules hold nothing;
//            grants never refuse. backtest: decided/matched/differed/abstained on a hand-counted record. RED CASE: a
//            grant that would approve a stop-ship is flagged (stop-ship + any-tier) and not trustworthy, and a backlog
//            grant over the same record is not flagged. Draft check refusals; ids never reused.
//   doors    a throwaway product (scan-demo.mjs --dir <tmp> --no-register + seed-rules-history.mjs, both --now fixed) on
//            apps/server (cwd <tmp>, its own registry and BP_HOME, BP_CLAUDE_BIN = the fake): preview writes nothing; a
//            write without the human token is 403; a hold is written to work/bp-rules.json with its author; wave.compose
//            over MCP leaves the held item out and cites O-1, all-held is refused; scan.place and /dispatch are refused
//            with the order; rules.list lists it; a tier-3 grant lets decision.answer run on a covered finding without a
//            card (decidedBy policy, the grant's id) but not on a stop-ship; revoking lifts the hold; a corrupt file reads
//            as no rules and is moved aside on the next write.
// Run: node scripts/check-rules.ts     Exit 1 on any miss.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
((await import('./lib/src-hooks.mjs')) as { registerSrcHooks: (root: string) => void }).registerSrcHooks(ROOT);
const R = await import('../packages/core/src/scan/rules.ts');
type Rule = import('../packages/core/src/scan/rules.ts').Rule;
type Row = import('../packages/core/src/scan/rules.ts').DecidedRow;

let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`); };
const j = (x: unknown) => JSON.stringify(x)?.slice(0, 400) ?? String(x);

// ------------------------------------------------------------------------------------------------ pure
const T0 = Date.parse('2026-10-20T12:00:00Z');
const rule = (x: Partial<Rule> & Pick<Rule, 'id' | 'kind'>): Rule => ({ text: x.kind, by: 'user:owner', at: '2026-10-20T10:00:00Z', scope: { kind: 'room', id: 'pay', label: 'Payments', features: ['card', 'refund'] }, ...x });
const hold = rule({ id: 'O-1', kind: 'hold' });
const only = rule({ id: 'O-2', kind: 'only', lenses: ['security'], scope: { kind: 'room', id: 'book', label: 'Booking', features: ['book'] } });
const cap = rule({ id: 'O-3', kind: 'cap', maxEffort: 'medium', model: 'opus', scope: { kind: 'all', label: 'Everything', features: [] } });
const gone = rule({ id: 'O-4', kind: 'hold', scope: { kind: 'feature', id: 'quiz', label: 'Quiz', features: ['quiz'] }, expiresAt: '2026-10-20T11:00:00Z' });
const lifted = rule({ id: 'O-5', kind: 'hold', scope: { kind: 'feature', id: 'quiz', label: 'Quiz', features: ['quiz'] }, revokedAt: '2026-10-20T11:30:00Z' });
const grant = rule({ id: 'G-1', kind: 'grant', minTier: 3, scope: { kind: 'all', label: 'Everything', features: [] } });
const RULES = [hold, only, cap, gone, lifted, grant];
const it = (id: string, feature: string, lens = 'design') => ({ id, feature, lens });
{
  const g = R.gate(RULES, { kind: 'build', tool: 'wave.compose', items: [it('a', 'card'), it('b', 'quiz'), it('c', 'book')] }, T0);
  check('gate: a hold leaves out what it covers, cites it; the rest goes', g.held.length === 2 && g.held[0].id === 'a' && g.held[0].order.id === 'O-1' && !g.refused, j(g));
  check('gate: `only` holds another lens in its place', g.held[1]?.id === 'c' && g.held[1]?.order.id === 'O-2', j(g.held));
  check('gate: expired and revoked orders hold nothing', !g.held.some((h) => h.id === 'b'));
  const all = R.gate(RULES, { kind: 'build', tool: 'wave.dispatch', items: [it('a', 'card'), it('r', 'refund')] }, T0);
  check('gate: an act all of whose items are held is refused by the first order', all.refused?.id === 'O-1' && all.held.length === 2, j(all));
  check('gate: words cite the order id, its author and the count left out', /held by order O-1 \(user:owner, 2026-10-20 10:00\).*2 items left out/.test(R.gateWords(all)), R.gateWords(all));
  const sec = R.gate(RULES, { kind: 'build', tool: 'wave.compose', items: [it('c', 'book', 'security')] }, T0);
  check('gate: `only` lets its own lens through', !sec.held.length && !sec.refused, j(sec));
  const hi = R.gate(RULES, { kind: 'build', tool: 'wave.compose', items: [it('q', 'quiz')], model: 'opus', effort: 'xhigh' }, T0);
  const lo = R.gate(RULES, { kind: 'build', tool: 'wave.compose', items: [it('q', 'quiz')], model: 'opus', effort: 'medium' }, T0);
  const so = R.gate(RULES, { kind: 'build', tool: 'wave.compose', items: [it('q', 'quiz')], model: 'sonnet', effort: 'xhigh' }, T0);
  check('gate: a cap holds above its effort, on its model only', hi.refused?.id === 'O-3' && !lo.held.length && !so.held.length, j([hi, lo, so]));
  const sc = R.gate(RULES, { kind: 'scan', tool: 'scan.place', lens: 'design', scope: { kind: 'feature', id: 'refund', label: 'Refund', features: ['refund'] } }, T0);
  const sc2 = R.gate(RULES, { kind: 'scan', tool: 'scan.place', lens: 'security', scope: { kind: 'room', id: 'book', label: 'Booking', features: ['book'] } }, T0);
  const sc3 = R.gate([only], { kind: 'scan', tool: 'scan.place', lens: 'design', scope: { kind: 'all', label: 'Everything', features: [] } }, T0);
  check('gate: a scan in a held place is refused; `only` lets its lens scan; an all-scan touches every place', sc.refused?.id === 'O-1' && !sc2.refused && sc3.refused?.id === 'O-2', j([sc, sc2, sc3]));
  check('gate: grants never refuse', !R.gate([grant], { kind: 'build', tool: 'wave.compose', items: [it('a', 'card')] }, T0).held.length);
  check('grantFor: covers tier >= floor in its place, never untiered or a stop-ship', R.grantFor(RULES, 'decision.answer', [{ feature: 'card', tier: 3 }], T0)?.id === 'G-1'
    && !R.grantFor(RULES, 'decision.answer', [{ feature: 'card' }], T0) && !R.grantFor(RULES, 'decision.answer', [{ feature: 'card', tier: 0 }], T0) && !R.grantFor(RULES, 'triage.set', [{ feature: 'card', tier: 3 }], T0));
}
{
  const row = (id: string, feature: string, owner: 'approve' | 'decline', tier?: number, extra: Partial<Row> = {}): Row => ({ id, title: 'T ' + id, feature, lens: 'design', owner, by: 'user:owner', at: '2026-10-1' + id.length + 'T00:00:00Z', ...(tier !== undefined ? { tier } : {}), ...extra });
  const rec = [row('a', 'card', 'decline', 2), row('bb', 'card', 'approve', 1), row('ccc', 'book', 'approve', 3), row('dddd', 'book', 'decline', 3), row('eeeee', 'quiz', 'approve', 0), row('ffffff', 'quiz', 'approve')];
  const bh = R.backtest(hold, rec);
  check('backtest: a hold over its place: decided 6, matched 1 (a decline), differed 1 (an approve), abstained 4', bh.decided === 6 && bh.matched === 1 && bh.differed === 1 && bh.abstained === 4, j(bh));
  check('backtest: the differing rows come first and carry both verdicts', bh.rows[0]?.id === 'bb' && bh.rows[0].owner === 'approve' && bh.rows[0].rule === 'hold' && bh.rows[0].agree === false, j(bh.rows[0]));
  const any = R.backtest({ kind: 'grant', scope: { kind: 'all', label: 'Everything', features: [] } }, rec);
  check('RED CASE: a grant over every tier that would approve a stop-ship is flagged and not trustworthy', any.flags.some((f) => f.key === 'stop-ship' && f.ids?.includes('eeeee')) && any.flags.some((f) => f.key === 'any-tier') && !R.trustworthy(any), j(any.flags));
  const back = R.backtest({ kind: 'grant', minTier: 3, scope: { kind: 'all', label: 'Everything', features: [] } }, rec);
  check('backtest: a backlog grant over the same record speaks on tier 3 only, no stop-ship flag', back.matched === 1 && back.differed === 1 && back.abstained === 4 && !back.flags.some((f) => f.key === 'stop-ship' || f.key === 'any-tier'), j(back));
  const capB = R.backtest(cap, [row('x', 'card', 'approve', 2, { model: 'opus', effort: 'xhigh' }), row('y', 'card', 'approve', 2, { model: 'opus', effort: 'low' }), row('z', 'card', 'approve', 2)]);
  check('backtest: a cap speaks only on builds above its effort', capB.differed === 1 && capB.abstained === 2, j(capB));
  check('backtest: a rule that never spoke is flagged silent', R.backtest({ kind: 'hold', scope: { kind: 'feature', id: 'zz', label: 'Z', features: ['zz'] } }, rec).flags.some((f) => f.key === 'silent'));
  check('backtest: synthetic rows are counted', R.backtest(hold, [row('s', 'card', 'approve', 2, { synthetic: true })]).synthetic === 1);
}
{
  const known = { feature: (f: string) => ['card', 'book'].includes(f), lens: (l: string) => l === 'security', tool: (t: string) => t === 'decision.answer' };
  const sc = { kind: 'room', id: 'pay', label: 'Payments', features: ['card'] };
  check('draft: a hold over a known place passes, its text from the template', (R.checkRuleBody({ kind: 'hold', scope: sc }, known) as { text: string }).text === R.RULE_TEMPLATES.hold);
  const bad = [{ kind: 'nope', scope: sc }, { kind: 'hold', scope: { ...sc, features: ['ghost'] } }, { kind: 'only', scope: sc, lenses: ['design'] }, { kind: 'cap', scope: sc, maxEffort: 'max' },
    { kind: 'grant', scope: sc }, { kind: 'grant', scope: sc, hours: 24, minTier: 7 }, { kind: 'hold', scope: { ...sc, features: [] } }, { kind: 'hold', scope: sc, hours: 9999 }];
  const refused = bad.map((b) => typeof R.checkRuleBody(b, known) === 'string');
  check('draft: bad kind, unknown feature or lens, bad effort, an unexpiring grant, a bad tier, an empty place, too long: all refused', refused.every(Boolean), j(refused));
  check('ids: O-n and G-n count apart and are never reused', R.nextRuleId(RULES, 'hold') === 'O-6' && R.nextRuleId(RULES, 'grant') === 'G-2');
}

// ------------------------------------------------------------------------------------------------ the doors
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-check-rules-'));
const KL = path.join(tmp, 'kl'), NOW = '2026-10-20T12:00:00.000Z';
const seed = spawnSync(process.execPath, [path.join(ROOT, 'scripts/scan-demo.mjs'), '--dir', KL, '--no-register', '--now', NOW], { encoding: 'utf8' });
const hist = spawnSync(process.execPath, [path.join(ROOT, 'scripts/seed-rules-history.mjs'), '--dir', KL, '--now', NOW], { encoding: 'utf8' });
check('the throwaway product seeds (scan-demo + the labelled synthetic history)', seed.status === 0 && hist.status === 0 && /96 SYNTHETIC/.test(hist.stdout), (seed.stderr || '') + (hist.stderr || ''));
fs.writeFileSync(path.join(tmp, 'bp.products.local.json'), JSON.stringify({ products: [{ slug: 'kl', name: 'KL', root: KL }] }));
{
  const db = new DatabaseSync(path.join(KL, '.ai', 'lens-scan', 'scan.db'));
  const p = db.prepare("INSERT INTO proposals (id, run_id, feature, lens, title, standard, kind, status, tier, created_at, updated_at) VALUES (?, 'run-demo-b', ?, ?, ?, 'none', 'fix', 'proposed', ?, ?, ?)");
  p.run('q-pay', 'card-payments', 'security', 'Pay item', 2, NOW, NOW);
  p.run('q-book', 'book-a-class', 'design', 'Booking backlog item', 3, NOW, NOW);
  p.run('q-book0', 'book-a-class', 'design', 'Booking stop-ship', 0, NOW, NOW);
  db.close();
}
const map = JSON.parse(fs.readFileSync(path.join(KL, '.ai', 'lens-scan', 'app-structure.json'), 'utf8')) as { features: { slug: string; capability: string }[] };
const room = (c: string) => map.features.filter((f) => f.capability === c).map((f) => f.slug);
const BILLING = { kind: 'room', id: 'payments.billing', label: 'Billing', features: room('payments.billing') };
const BOOKING = { kind: 'room', id: 'booking.booking', label: 'Booking', features: room('booking.booking') };

const server = spawn(process.execPath, ['--import', pathToFileURL(path.join(ROOT, 'packages/core/register.mjs')).href, path.join(ROOT, 'apps/server/src/main.ts'), '--port', '0'],
  { cwd: tmp, env: { ...process.env, BP_HOME: path.join(tmp, 'home'), BP_CLAUDE_BIN: path.join(ROOT, 'scripts/fixtures/fake-claude.mjs'), BP_GH_BIN: path.join(tmp, 'no-gh.mjs') }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let out = '';
server.stdout!.on('data', (d) => (out += d));
server.stderr!.on('data', (d) => (out += d));
const port: number = await new Promise((resolve) => {
  const t = setTimeout(() => resolve(0), 30000);
  const look = () => { const x = /listening on http:\/\/[^:]+:(\d+)/.exec(out); if (x) { clearTimeout(t); resolve(Number(x[1])); } };
  server.stdout!.on('data', look);
  server.on('exit', () => { clearTimeout(t); resolve(0); });
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Res = { status: number; json: any; raw: string };
const req = (method: string, p: string, headers: Record<string, string> = {}, body?: unknown): Promise<Res> => new Promise((resolve) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: `localhost:${port}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
    let s = ''; res.on('data', (d) => (s += d)); res.on('end', () => { let json; try { json = JSON.parse(s); } catch { /* raw */ } resolve({ status: res.statusCode ?? 0, json, raw: s }); });
  });
  r.on('error', (e) => resolve({ status: 0, json: undefined, raw: e.message }));
  if (body !== undefined) r.write(JSON.stringify(body));
  r.end();
});
let mcp: ChildProcess | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const waiting = new Map<number, (m: any) => void>();
let nextId = 1;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (method: string, params?: unknown): Promise<any> => new Promise((resolve) => {
  const id = nextId++;
  const t = setTimeout(() => { waiting.delete(id); resolve({ error: { message: 'timeout' } }); }, 60000);
  waiting.set(id, (m) => { clearTimeout(t); resolve(m); });
  mcp!.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) }) + '\n');
});
const call = async (name: string, args: unknown) => {
  const r = await rpc('tools/call', { name, arguments: args });
  const text: string = r.result?.content?.[0]?.text ?? '';
  let json; try { json = JSON.parse(text); } catch { /* text */ }
  return { isError: r.result?.isError === true, text, json };
};
const API = '/api/products/kl/rules', FILE = path.join(KL, '.ai', 'lens-scan', 'work', 'bp-rules.json');

try {
  check('apps/server starts and mounts the rules routes', port > 0 && /route GET,POST \/api\/products\/\[slug\]\/rules$/m.test(out) && /route DELETE \/api\/products\/\[slug\]\/rules\/\[id\]$/m.test(out), out.slice(-400));
  if (!port) throw new Error('no server');
  mcp = spawn(process.execPath, [path.join(ROOT, 'apps/mcp/bp-mcp.mjs')], { cwd: tmp, env: { ...process.env, BP_URL: `http://127.0.0.1:${port}` }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  createInterface({ input: mcp.stdout! }).on('line', (line) => { let m; try { m = JSON.parse(line); } catch { return; } waiting.get(m.id)?.(m); waiting.delete(m.id); });
  mcp.stderr!.on('data', () => {});
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'check', version: '0' } });
  const tools = ((await rpc('tools/list')).result?.tools ?? []) as { name: string; description: string }[];
  check('MCP: rules_list (AUTO) and rule_propose (GATED) are on the door', tools.some((t) => t.name === 'rules_list') && tools.some((t) => t.name === 'rule_propose' && /needs the person/.test(t.description)));

  const g0 = await req('GET', API);
  check('GET rules: none yet; the record counts the decided rows and the synthetic ones', g0.status === 200 && g0.json?.rules?.length === 0 && g0.json?.record?.decided >= 96 && g0.json?.record?.synthetic === 96, j(g0.json));
  const pv = await req('POST', API, {}, { kind: 'hold', scope: BILLING, preview: true });
  check('preview: 200 with the replay, nothing written', pv.status === 200 && pv.json?.backtest?.decided >= 96 && pv.json.rule.id === null && !fs.existsSync(FILE), j(pv.json?.backtest));
  const red = await req('POST', API, {}, { kind: 'grant', hours: 24, scope: { kind: 'all', label: 'Everything', features: [] }, preview: true });
  check('RED CASE over the seeded record: a grant over every tier is flagged for the stop-ships it would approve', red.json?.backtest?.flags?.some((f: { key: string }) => f.key === 'stop-ship'), j(red.json?.backtest?.flags));
  const nh = await req('POST', API, {}, { kind: 'hold', scope: BILLING });
  check('setting a rule without the human token: 403', nh.status === 403 && !fs.existsSync(FILE), j(nh.json));
  const tok = (await req('GET', '/api/companion/human-token', { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' })).json?.token as string;
  const H = { 'x-bp-human': tok };
  const set = await req('POST', API, H, { kind: 'hold', scope: BILLING, hours: 72 });
  const file = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : null;
  check('a person sets a hold: 201 O-1, signed, with its evidence and expiry, in work/bp-rules.json v1', set.status === 201 && set.json?.rule?.id === 'O-1' && /^user:/.test(set.json.rule.by) && set.json.rule.evidence?.decided >= 96 && !!set.json.rule.expiresAt && file?.version === 1 && file.rules[0].id === 'O-1', j(set.json));

  const wc = await call('wave_compose', { slug: 'kl', name: 'Agent wave', packages: [{ name: 'mixed', model: 'sonnet', effort: 'medium', ids: ['q-pay', 'q-book'] }] });
  check('MCP wave.compose: the held item is left out and the order cited; the wave keeps the rest', !wc.isError && /held by order O-1/.test(wc.json?.note ?? '') && wc.json?.wave?.packages?.[0]?.ids?.join() === 'q-book' && wc.json?.held?.[0]?.order?.by?.startsWith('user:'), wc.text);
  const wa = await call('wave_compose', { slug: 'kl', name: 'Pay wave', packages: [{ name: 'pay', model: 'sonnet', effort: 'medium', ids: ['q-pay'] }] });
  check('MCP wave.compose: all of it held is refused, citing O-1', wa.isError && /403.*O-1/.test(wa.text), wa.text);
  const sp = await call('scan_place', { slug: 'kl', lens: 'design', scope: { kind: 'feature', id: 'card-payments', label: 'Card payments', features: ['card-payments'] } });
  check('MCP scan.place in the held room is refused, citing O-1', sp.isError && /O-1/.test(sp.text), sp.text);
  const d = await req('POST', '/api/products/kl/dispatch', {}, { ids: ['q-pay'] });
  check('POST /dispatch of a held finding: 403 with the order', d.status === 403 && d.json?.order?.id === 'O-1', j(d.json));
  const rl = await call('rules_list', { slug: 'kl' });
  check('MCP rules.list names the order, its author and place', !rl.isError && rl.json?.rules?.[0]?.id === 'O-1' && rl.json.rules[0].scope?.label === 'Billing', rl.text);

  const gr = await req('POST', API, H, { kind: 'grant', minTier: 3, hours: 24, scope: BOOKING });
  check('a person grants G-1: backlog findings in Booking, 24 h', gr.status === 201 && gr.json?.rule?.id === 'G-1', j(gr.json));
  const da = await call('decision_answer', { slug: 'kl', id: 'q-book', decision: 'approve' });
  check('MCP decision.answer on a covered backlog finding runs at once under G-1 (no card waits)', !da.isError && da.json?.state === 'done' && da.json?.decidedBy === 'policy' && da.json?.policy === 'G-1', da.text);
  const d0 = await call('decision_answer', { slug: 'kl', id: 'q-book0', decision: 'approve' });
  check('MCP decision.answer on a stop-ship in the same place still waits for the person', d0.json?.state === 'pending', d0.text);

  const rv = await req('DELETE', API + '/O-1', H);
  const rv2 = await req('DELETE', API + '/O-1', H);
  check('revoke: 200 with revokedAt and revokedBy; again: 409', rv.status === 200 && !!rv.json?.rule?.revokedAt && /^user:/.test(rv.json.rule.revokedBy) && rv2.status === 409, j([rv.json, rv2.json]));
  const wc2 = await call('wave_compose', { slug: 'kl', name: 'Pay wave 2', packages: [{ name: 'pay', model: 'sonnet', effort: 'medium', ids: ['q-pay'] }] });
  check('after the lift, wave.compose takes the payments item', !wc2.isError && !wc2.json?.held, wc2.text);
  const g1 = await req('GET', API);
  check('GET rules keeps the revoked order as the record', g1.json?.rules?.length === 2 && g1.json.rules[0].revokedAt, j(g1.json?.rules));

  fs.writeFileSync(FILE, '{ not json');
  const gc = await req('GET', API);
  const w = await req('POST', API, H, { kind: 'hold', scope: BILLING });
  check('a corrupt file reads as no rules; the next write moves it aside first', gc.status === 200 && gc.json?.rules?.length === 0 && w.status === 201 && fs.existsSync(FILE.replace(/\.json$/, '.corrupt.json')), j([gc.json, w.json]));
} catch (e) {
  check('the walk ran to the end', false, (e as Error).stack ?? String(e));
} finally {
  mcp?.kill();
  server.kill();
  await new Promise((r) => setTimeout(r, 300));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* a handle still closing on Windows */ }
}
console.log(`check-rules: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
