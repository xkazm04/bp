#!/usr/bin/env node
// A stand-in for `claude -p --output-format stream-json --verbose` running the adopt-bp skill (the server's `adopt` job,
// packages/core/src/server/jobs.server.ts), so onboarding can be checked end to end without paying for a run. Point
// BP_CLAUDE_BIN at this file. It reads the prompt on stdin, streams stream-json lines (init, assistant text, tool calls
// on real repo files, the result) and writes the files adopt-bp writes under `<cwd>/.ai/lens-scan/`, in adopt-bp's order,
// spread over FAKE_ADOPT_MS (default 20000):
//   context-supplement -> seed (map skeleton + inventory) -> product-tree.d/<NN>-<domain>.json, one per domain ->
//   product tree merged into the map -> events.jsonl -> batches -> one judgement file per batch -> the judged map -> ADOPT.md
// and, as adopt-bp 1.6.0 narrates, lines appended to work/progress.jsonl: a `step` line at each step, a `domain` line the
// moment each domain is decided (before its product-tree.d file; in the REAL mode the files then land in one burst just
// before the tree, as a real model wrote them on 2026-11-02, while the lines arrive seconds apart), a `batch` line as each
// judgement batch is dispatched.
// Two sources for the content:
//   synthetic (default)  stages() below, from packages/schema/schema/fixtures/valid-map.json: hermetic, a few KB.
//                        scripts/check-onboarding.ts drives the server's feed with the same stages.
//   FAKE_ADOPT_REAL=1    the real `adopt.mjs supplement / seed / tree / events / measure / batches` of the skill the prompt
//                        names (S=...), in the cwd (a THROWAWAY clone: it writes there), with a product tree built from
//                        the inventory (a domain per group) and judgements made up per batch: the real shapes, no model.
// FAKE_ADOPT_FAIL=<step> exits 1 after that step (supplement, seed, outline, tree, events, batches, judge) with an error
// result line. Refuses (exit 2) an argv without `--output-format stream-json --verbose` or a prompt that is not adopt-bp's.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VALID_MAP = path.join(HERE, '..', '..', 'packages', 'schema', 'schema', 'fixtures', 'valid-map.json');

/**
 * The synthetic run, as the files each step leaves: [{ step, files: { <path under .ai/lens-scan>: content } }]. A string is
 * written as it is, anything else as JSON. From valid-map.json: one domain (Payments, one capability, two features).
 */
export function stages() {
  const m = JSON.parse(fs.readFileSync(VALID_MAP, 'utf8'));
  // it is Kettle's (the sample's named wings): as a product of its own, each domain is its own wing (`0:<domain>`), as on
  // every product adopt-bp onboards
  m.project = { ...m.project, slug: 'synthetic', name: 'Synthetic' };
  m.domains = m.domains.map((d) => ({ ...d, slug: 'subscriptions' }));
  m.capabilities = m.capabilities.map((c) => ({ ...c, domain: 'subscriptions' }));
  const skeleton = { ...m, domains: [], capabilities: [], features: [], facets: {} };
  const merged = { ...m, facets: {} };
  const inventory = { root: '.', project: m.project, groups: m.groups, contexts: m.contexts.map((c, i) => ({ ...c, files: 3 + i, loc: 120 * (i + 1), first_commit: '2026-06-01', last_commit: '2026-10-01' })) };
  const supplement = { contexts: [{ name: 'billing-docs', group: 'Payments', file_paths: ['docs/billing.md'], entry_points: [] }] };
  const tree = { domains: m.domains, capabilities: m.capabilities, features: m.features };
  const events = m.features.map((f, i) => JSON.stringify({ at: `2026-0${6 + i}-02T09:00:00Z`, type: 'feature-added', feature: f.slug })).join('\n') + '\n';
  const batch = { batch: '01', features: m.features.map((f) => ({ slug: f.slug, name: f.name })) };
  const judgement = { batch: '01', features: Object.fromEntries(m.features.map((f, i) => [f.slug, { security: { findingsCritical: 0, findingsHigh: 0, findingsMedium: i }, development: { techDebt: 1 }, design: { undesignedStates: 0 } }])) };
  return [
    { step: 'supplement', files: { 'work/context-supplement.json': supplement } },
    { step: 'seed', files: { 'app-structure.json': skeleton, 'work/inventory.json': inventory, [PROGRESS]: [stepLine('product-tree', 'Reading the inventory to name the product', 'Decide the first domain')] } },
    ...m.domains.map((d) => ({ step: 'decide', files: { [PROGRESS]: [domainLine(d, m.capabilities.filter((c) => c.domain === d.slug)), stepLine('product-tree', `Decided ${d.name}; placing its features`, 'Write the product tree')] } })),
    ...m.domains.map((d, i) => ({ step: 'outline', files: { [`work/product-tree.d/${String(i + 1).padStart(2, '0')}-${d.slug}.json`]: { domain: d, capabilities: m.capabilities.filter((c) => c.domain === d.slug) } } })),
    { step: 'tree', files: { 'work/product-tree.json': tree, 'app-structure.json': merged } },
    { step: 'events', files: { 'events.jsonl': events } },
    { step: 'batches', files: { 'work/batches/01.json': batch, [PROGRESS]: [{ kind: 'batch', n: 1, of: 1, features: batch.features.map((f) => f.slug) }] } },
    { step: 'judge', files: { 'work/judgement/01.json': judgement, [PROGRESS]: [stepLine('judge', 'Merging the judgements', 'Validate and register')] } },
    { step: 'merge', files: { 'app-structure.json': m } },
    { step: 'report', files: { 'ADOPT.md': '# Adopted\n\nA synthetic onboarding (scripts/fixtures/fake-adopt.mjs).\n' } },
  ];
}

/** Write one stage's files under `ls` (the repo's .ai/lens-scan). A string is written as it is; an array under a `.jsonl`
 *  path is APPENDED, one JSON line per item (work/progress.jsonl); anything else is written as JSON. */
export function writeStage(ls, stage) {
  for (const [rel, v] of Object.entries(stage.files)) {
    const f = path.join(ls, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (Array.isArray(v) && rel.endsWith('.jsonl')) fs.appendFileSync(f, v.map((x) => JSON.stringify(x) + '\n').join(''));
    else fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v, null, 1));
  }
}
const PROGRESS = 'work/progress.jsonl';
const stepLine = (phase, text, next = null) => ({ kind: 'step', phase, text, next });
const domainLine = (d, caps) => ({ kind: 'domain', slug: d.slug, name: d.name, summary: d.summary ?? null, capabilities: caps.map((c) => ({ slug: c.slug, name: c.name })) });

// --------------------------------------------------------------------------------------------- the CLI
async function main() {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--output-format');
  if (at < 0 || argv[at + 1] !== 'stream-json' || !argv.includes('--verbose')) { process.stderr.write('fake-adopt: needs --output-format stream-json --verbose\n'); process.exit(2); }
  const prompt = await new Promise((resolve) => { let s = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (d) => { s += d; }); process.stdin.on('end', () => resolve(s)); });
  if (!/adopt-bp/.test(prompt)) { process.stderr.write('fake-adopt: not an adopt-bp prompt\n'); process.exit(2); }
  const S = /S=(\S+) and/.exec(prompt)?.[1] ?? null;
  const BP = /--bp (\S+)\.\r?\n/.exec(prompt)?.[1] ?? null;
  const SLUG = /--slug (\S+)/.exec(prompt)?.[1] ?? 'fake';
  const NAME = /--name "([^"]*)"/.exec(prompt)?.[1] ?? SLUG;
  const TOTAL = Math.max(200, Number(process.env.FAKE_ADOPT_MS ?? 20000));
  const FAIL = process.env.FAKE_ADOPT_FAIL ?? '';
  const REAL = process.env.FAKE_ADOPT_REAL === '1';
  const ROOT = process.cwd(), LS = path.join(ROOT, '.ai', 'lens-scan');
  const t0 = Date.now();
  const out = (j) => process.stdout.write(JSON.stringify(j) + '\n');
  const say = (text) => out({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
  const tool = (name, input) => out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't' + Math.random().toString(36).slice(2, 8), name, input } ] } });
  const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
  const until = (frac) => sleep(t0 + TOTAL * frac - Date.now());
  const tracked = (() => { const r = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }); return (r.stdout ?? '').split('\n').filter(Boolean); })();
  const readSome = (k) => { for (let i = 0; i < k && tracked.length; i++) tool('Read', { file_path: path.join(ROOT, tracked[(i * 7 + Math.floor((Date.now() - t0) / 97)) % tracked.length]) }); };
  const adopt = (...a) => {
    tool('Bash', { command: `node ${S}/scripts/adopt.mjs ${a.join(' ')} --root . --bp ${BP}` });
    const r = spawnSync(process.execPath, [path.join(S, 'scripts', 'adopt.mjs'), ...a, '--root', ROOT, '--bp', BP], { cwd: ROOT, encoding: 'utf8' });
    say(`adopt.mjs ${a[0]}: ${(r.stdout || r.stderr || '').trim().split('\n').pop() ?? ''}`.slice(0, 300));
    return r.status === 0;
  };
  const fail = (step) => {
    if (FAIL !== step) return;
    out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: `fake-adopt: stopped at ${step} (FAKE_ADOPT_FAIL)`, num_turns: 3, duration_ms: Date.now() - t0 });
    process.exit(1);
  };
  if (REAL && (!S || !BP)) { process.stderr.write('fake-adopt: FAKE_ADOPT_REAL needs S= and --bp in the prompt\n'); process.exit(2); }

  out({ type: 'system', subtype: 'init', model: 'fake-adopt', cwd: ROOT });
  say(`Onboarding ${NAME} (${SLUG}) with adopt-bp${REAL ? ' (real adopt.mjs steps, made-up product tree and judgements)' : ' (synthetic)'}.`);
  tool('Read', { file_path: `${S ?? '<skill>'}/SKILL.md` });
  readSome(2);
  await until(0.05);

  if (!REAL) {
    const st = stages();
    const marks = { supplement: 0.08, seed: 0.15, tree: 0.5, events: 0.55, batches: 0.62, judge: 0.85, merge: 0.92, report: 0.97 };
    const outlines = st.filter((s) => s.step === 'outline'), decides = st.filter((s) => s.step === 'decide');
    for (const s of st) {
      const frac = s.step === 'outline' ? 0.25 + (0.2 * (outlines.indexOf(s) + 1)) / outlines.length
        : s.step === 'decide' ? 0.18 + (0.06 * (decides.indexOf(s) + 1)) / decides.length : marks[s.step];
      await until(frac);
      readSome(1);
      for (const rel of Object.keys(s.files)) tool('Write', { file_path: path.join(LS, rel) });
      writeStage(LS, s);
      fail(s.step);
    }
  } else {
    await until(0.08); adopt('supplement'); fail('supplement');
    await until(0.15);
    if (!adopt('seed', '--slug', SLUG, '--name', NAME)) say('seed refused');
    fail('seed');
    const inv = JSON.parse(fs.readFileSync(path.join(LS, 'work', 'inventory.json'), 'utf8'));
    const tree = treeFrom(inv);
    const narrate = (...lines) => { tool('Bash', { command: `echo '<line>' >> .ai/lens-scan/${PROGRESS}` }); writeStage(LS, { files: { [PROGRESS]: lines } }); };
    await until(0.17);
    narrate(stepLine('product-tree', `Reading the inventory: ${inv.contexts?.length ?? 0} code areas to name`, 'Decide the first domain'));
    // each domain is decided over a few seconds: read its code, then its line (the files come later, in one burst)
    for (let i = 0; i < tree.domains.length; i++) {
      const d = tree.domains[i], next = tree.domains[i + 1];
      const caps = tree.capabilities.filter((c) => c.domain === d.slug);
      const from = 0.2 + (0.25 * i) / tree.domains.length, span = 0.25 / tree.domains.length;
      await until(from);
      narrate(stepLine('product-tree', `Reading the ${d.name.toLowerCase()} code to name it`, `Decide ${d.name} and its capabilities`));
      readSome(2);
      await until(from + span * 0.7);
      readSome(1);
      narrate(domainLine(d, caps), stepLine('product-tree', `Decided ${d.name}: ${caps.length} capabilities`, next ? `Read the next code area (${next.name.toLowerCase()})` : 'Settle stages and write the product tree'));
    }
    await until(0.46);
    narrate(stepLine('product-tree', 'Settling each feature’s stage from its entry points', 'Write the merged product tree'));
    await until(0.48);
    for (let i = 0; i < tree.domains.length; i++) { // the burst a real model wrote on 2026-11-02
      const d = tree.domains[i];
      const f = path.join(LS, 'work', 'product-tree.d', `${String(i + 1).padStart(2, '0')}-${d.slug}.json`);
      tool('Write', { file_path: f });
      writeStage(LS, { files: { [path.relative(LS, f)]: { domain: d, capabilities: tree.capabilities.filter((c) => c.domain === d.slug) } } });
    }
    fail('outline');
    await until(0.5);
    writeStage(LS, { files: { 'work/product-tree.json': tree } });
    tool('Write', { file_path: path.join(LS, 'work', 'product-tree.json') });
    if (!adopt('tree')) { out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'adopt.mjs tree refused the made-up tree', duration_ms: Date.now() - t0 }); process.exit(1); }
    fail('tree');
    await until(0.55); adopt('events'); fail('events');
    await until(0.58); adopt('measure');
    await until(0.62); adopt('batches', '--size', '8'); fail('batches');
    const bdir = path.join(LS, 'work', 'batches');
    const batches = fs.existsSync(bdir) ? fs.readdirSync(bdir).filter((n) => n.endsWith('.json')).sort() : [];
    for (let i = 0; i < batches.length; i++) {
      const b = JSON.parse(fs.readFileSync(path.join(bdir, batches[i]), 'utf8'));
      const feats = (b.features ?? []).map((f) => (typeof f === 'string' ? f : f.slug ?? f.id)).filter(Boolean);
      await until(0.65 + (0.25 * i) / batches.length + 0.01);
      narrate({ kind: 'batch', n: i + 1, of: batches.length, features: feats },
        stepLine('judge', `Judging batch ${i + 1}: reading the largest files of ${feats.length} features`, i + 1 < batches.length ? `Judge batch ${i + 2} of ${batches.length}` : 'Merge the judgements'));
      await until(0.65 + (0.25 * (i + 1)) / batches.length);
      readSome(3);
      const j = { batch: batches[i].replace(/\.json$/, ''), features: Object.fromEntries(feats.map((s, k) => [s, { security: { findingsCritical: 0, findingsHigh: k % 5 === 4 ? 1 : 0, findingsMedium: k % 3 }, development: { techDebt: k % 4 }, design: { undesignedStates: k % 2 } }])) };
      tool('Write', { file_path: path.join(LS, 'work', 'judgement', batches[i]) });
      writeStage(LS, { files: { [`work/judgement/${batches[i]}`]: j } });
    }
    fail('judge');
    narrate(stepLine('judge', 'Merging the judgements into the map', 'Validate, register and write the report'));
    await until(0.93);
    // the judge merge rewrites the map (the real one also writes facets; here the measured ones stay)
    const mf = path.join(LS, 'app-structure.json');
    fs.writeFileSync(mf, fs.readFileSync(mf, 'utf8'));
    await until(0.97);
    writeStage(LS, { files: { 'ADOPT.md': `# ${NAME} adopted (fake-adopt, real adopt.mjs steps)\n` } });
  }
  await until(1);
  say('Onboarding finished.');
  out({ type: 'result', subtype: 'success', is_error: false, result: 'done', num_turns: 42, total_cost_usd: 0, duration_ms: Date.now() - t0 });
}

/** A product tree adopt.mjs tree accepts, made from the inventory: a domain per group (ungrouped contexts: "Other"), two
 *  capabilities per domain when it has two contexts or more, a feature per context. */
function treeFrom(inv) {
  const kebab = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
  const byGroup = new Map();
  for (const c of inv.contexts ?? []) { const g = c.group || 'Other'; if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(c); }
  const domains = [], capabilities = [], features = [];
  let di = 0;
  for (const [g, cs] of byGroup) {
    const dslug = kebab(g), code = (dslug.replace(/-/g, '').slice(0, 4) || 'D').toUpperCase() + di++;
    domains.push({ slug: dslug, name: g[0].toUpperCase() + g.slice(1).replace(/-/g, ' '), id: code.slice(0, 6), summary: `What ${g} does for its users.` });
    const caps = cs.length > 1 ? [cs.slice(0, Math.ceil(cs.length / 2)), cs.slice(Math.ceil(cs.length / 2))] : [cs];
    caps.forEach((part, k) => {
      const cslug = `${dslug}-${k ? 'more' : 'core'}`;
      capabilities.push({ slug: cslug, name: `${g} ${k ? 'extras' : 'core'}`, domain: dslug, id: (code.slice(0, 5) + k).slice(0, 8), summary: `The ${k ? 'extra' : 'core'} parts of ${g}.` });
      for (const c of part) features.push({
        slug: kebab(c.name), name: String(c.name).replace(/-/g, ' ').replace(/^./, (x) => x.toUpperCase()), summary: c.description || `The ${c.name} part.`,
        capability: cslug, contexts: [c.name], primary_context: c.name, kind: 'capability', tier: 'standard', stage: 'live',
        stage_evidence: `fake-adopt: ${c.files ?? 0} files, last commit ${c.last_commit ?? 'unknown'}`,
      });
    });
  }
  return { domains, capabilities, features };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
