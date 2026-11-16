#!/usr/bin/env node
// The UE channel's vocabularies (schema-definitions:B): packages/schema/generate.mjs writes
// packages/schema/generated/ue/BpSchemaVocab.h, one namespace per struct field holding a string enum
// (BpVocab::<Struct>::<Field>::<Value> = TEXT("<value>"), plus AllValues[] and NumValues), and this check refuses a NEW
// hand-typed schema value in the VR client.
//   header    the fresh header holds the constants (BpVocab::Wave::Status::Draft is TEXT("draft"), ScanJob's Running,
//             Proposal's Proposed), one namespace per enum field of the model, each value once; two generations are
//             byte-identical and the committed file is the fresh one; a value added to wave.status appears, one removed
//             is gone; two values folding to one C++ name throw, naming the struct, the field and both values
//   ratchet   apps/vr/Source (.cpp/.h, comments and string literals stripped by check-bplink's stripCxx) compared
//             `<x>.<field> ==/!= TEXT("v")` (or `->`) against schema enum fields 37 times before the header existed. Those sites
//             are BASELINE below (file, Struct.field, value, count): they stay until someone migrates them (the operator's
//             decision, deck 2026-11-07: no apps/vr edit in this card). A site beyond its baseline count fails, naming
//             file:line and the BpVocab constant to use; a value that is in no enum of its field fails always; a baseline
//             count the tree no longer reaches fails too (lower it: the ratchet only tightens)
//   controls  seeded texts run through the same scanner: a new literal is reported, the same text in a comment or a
//             string is not, a value outside the enum names the enum, a migrated site reads as a stale baseline
// The receiver's struct comes from the nearest `FBp<Struct>[&*] <name>` declaration above the comparison, else from a
// receiver named as a struct (`Wave.status`), walked through member structs (`Job->scope.kind`); an unresolved receiver
// counts only when its value is in some enum of that field name.
// Run: node scripts/check-ue-vocab.mjs              exit 1 on any failure
//      node scripts/check-ue-vocab.mjs --baseline   print the BASELINE literal for the tree as it is now (to paste)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from './lib/expect.ts';
import { stripCxx } from './check-bplink.mjs';
import * as G from '../packages/schema/generate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VR = 'apps/vr/Source';
const HEADER = 'packages/schema/generated/ue/BpSchemaVocab.h';
const h = harness('check-ue-vocab');

// The raw vocabulary literals in apps/vr/Source on 2026-11-07, `<file> <Struct>.<field> <value>`: count. Only lowers.
const BASELINE = {
  'apps/vr/Source/BpLink/Private/BpLink.cpp ScanJob.status queued': 1,
  'apps/vr/Source/BpLink/Private/BpLink.cpp ScanJob.status running': 1,
  'apps/vr/Source/BpLink/Private/BpLink.cpp Wave.status draft': 1,
  'apps/vr/Source/BpLink/Public/BpLink.h BriefAdvice.say withdraw': 1,
  'apps/vr/Source/bp/BpDeck.cpp BriefFact.key declined': 1,
  'apps/vr/Source/bp/BpDeck.cpp Proposal.kind fix': 1,
  'apps/vr/Source/bp/BpDeck.cpp Proposal.status proposed': 3,
  'apps/vr/Source/bp/BpDeck.cpp Wave.status draft': 2,
  'apps/vr/Source/bp/BpMarks.cpp Activity.kind measured': 5,
  'apps/vr/Source/bp/BpMarks.cpp Activity.kind reading': 3,
  'apps/vr/Source/bp/BpMarks.cpp BriefAdvice.say withdraw': 1,
  'apps/vr/Source/bp/BpMarks.cpp BriefFact.key declined': 1,
  'apps/vr/Source/bp/BpMarks.cpp Proposal.status proposed': 2,
  'apps/vr/Source/bp/BpMarks.cpp Run.phase measure': 1,
  'apps/vr/Source/bp/BpMarks.cpp Run.status done': 1,
  'apps/vr/Source/bp/BpMarks.cpp ScanJob.kind measure': 1,
  'apps/vr/Source/bp/BpMarks.cpp ScanJob.status running': 1,
  'apps/vr/Source/bp/BpMarks.cpp ScanScope.kind all': 1,
  'apps/vr/Source/bp/BpRoom.cpp Proposal.status proposed': 1,
  'apps/vr/Source/bp/BpSwitch.cpp Proposal.status proposed': 3,
  'apps/vr/Source/bp/BpTour.cpp Proposal.status proposed': 1,
  'apps/vr/Source/bp/BpWrist.cpp Wave.status dispatched': 2,
  'apps/vr/Source/bp/BpWrist.cpp Wave.status draft': 2,
};

/** The C++ text files under apps/vr/Source, [repo-relative path, text]; a junction or symlink is not followed. */
function vrFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (!fs.lstatSync(path.join(ROOT, rel)).isSymbolicLink()) walk(rel); }
      else if (/\.(cpp|h)$/.test(e.name)) out.push([rel, fs.readFileSync(path.join(ROOT, rel), 'utf8')]);
    }
  };
  walk(VR);
  return out.sort(([a], [b]) => (a < b ? -1 : 1));
}

/** The struct a node holds (directly, as array items or map values), or null. */
const heldStruct = (n) => (n?.k === 'struct' ? n.name : n?.k === 'array' ? heldStruct(n.item) : n?.k === 'map' ? heldStruct(n.value) : null);

/**
 * Every `<receiver>.<field> ==/!= TEXT("v")` (either side) whose field is a schema enum field, in `files` ([rel, text]):
 * [{ rel, line, struct, field, value, constant | null, enumValues, text }]. `constant` is null when v is not in the enum.
 */
export function vocabLiterals(files, m, vocab) {
  const byField = new Map(vocab.map((f) => [`${f.struct}.${f.field}`, f]));
  const hits = [];
  const CHAIN = String.raw`((?:[A-Za-z_]\w*(?:\s*\[[^\]\n]*\])?\s*(?:\.|->)\s*)+)([A-Za-z_]\w*)`;
  const LIT = String.raw`TEXT\s*\(\s*"([^"\n]*)"\s*\)`;
  const OP = String.raw`\s*(==|!=)\s*`;
  const forms = [new RegExp(CHAIN + OP + LIT, 'gd'), new RegExp(LIT + OP + CHAIN, 'gd')];
  for (const [rel, text] of files) {
    const code = stripCxx(text), lit = stripCxx(text, true); // the same length: a literal blanked in `code` is read in `lit`
    for (const [fi, re] of forms.entries()) for (const x of code.matchAll(re)) {
      const [chain, field, litGroup] = fi === 0 ? [x[1], x[2], 4] : [x[3], x[4], 1];
      const value = lit.slice(...x.indices[litGroup]);
      const segs = chain.split(/\.|->/).map((s) => s.replace(/\[[^\]]*\]/g, '').trim()).filter(Boolean);
      const head = segs[0];
      // the receiver's struct: the nearest declaration above, else a receiver named as a struct, then member by member
      let struct = null;
      const decl = [...code.slice(0, x.index).matchAll(new RegExp(String.raw`\bFBp(\w+)\b[\s*&]*(?:const\b[\s*&]*)?\b${head}\b`, 'g'))].pop();
      if (decl && m.structs.has(decl[1])) struct = decl[1];
      else if (m.structs.has(head)) struct = head;
      for (const s of segs.slice(1)) {
        if (!struct) break;
        struct = heldStruct(m.structs.get(struct).props.find((p) => p.key === s)?.node);
      }
      let entry = null;
      if (struct) {
        const prop = m.structs.get(struct).props.find((p) => p.key === field);
        if (!prop) struct = null; // not this struct's field after all: fall back to the field name
        else entry = byField.get(`${struct}.${field}`) ?? null;
        if (prop && !entry) continue; // a field of the struct that holds no enum
      }
      if (!entry) entry = vocab.find((f) => f.field === field && f.values.includes(value)) ?? null;
      if (!entry) continue;
      const line = code.slice(0, x.index).split('\n').length; // `code`, not `text`: stripCxx keeps every \n but drops a \r before one
      hits.push({ rel, line, struct: entry.struct, field, value, constant: entry.names.get(value) ?? null, enumValues: entry.values, text: lit.slice(x.index, x.index + x[0].length).replace(/\s+/g, ' ') });
    }
  }
  return hits.sort((a, b) => (a.rel === b.rel ? a.line - b.line : a.rel < b.rel ? -1 : 1));
}

/** The ratchet over `hits`: { fresh: [lines], outside: [lines], stale: [lines], counts }. */
export function ratchet(hits, baseline) {
  const by = new Map();
  for (const x of hits) if (x.constant) { const k = `${x.rel} ${x.struct}.${x.field} ${x.value}`; (by.get(k) ?? by.set(k, []).get(k)).push(x); }
  const fresh = [], stale = [];
  for (const [k, xs] of by) {
    const allowed = baseline[k] ?? 0;
    if (xs.length > allowed) for (const x of xs.slice(allowed)) fresh.push(`${x.rel}:${x.line}: ${x.text} is a raw vocabulary literal on ${x.struct}.${x.field}: use ${x.constant}${allowed ? ` (${xs.length} sites, the baseline allows ${allowed})` : ''}`);
  }
  for (const [k, n] of Object.entries(baseline)) {
    const have = by.get(k)?.length ?? 0;
    if (have < n) stale.push(`${k}: the baseline allows ${n}, the tree has ${have}: lower BASELINE in scripts/check-ue-vocab.mjs (the ratchet only tightens)`);
  }
  const outside = hits.filter((x) => !x.constant).map((x) => `${x.rel}:${x.line}: ${x.struct}.${x.field}: "${x.value}" is not a value of the schema enum (${x.enumValues.join(', ')})`);
  return { fresh, outside, stale, counts: Object.fromEntries([...by].map(([k, xs]) => [k, xs.length])) };
}

const ready = typeof G.emitUeVocab === 'function' && typeof G.ueVocab === 'function';
h.expect(ready, 'generate.mjs exports emitUeVocab and ueVocab (the UE vocabulary channel)');
const schemas = G.readSchemas();
const m = G.model(schemas);
const vocab = ready ? G.ueVocab(m) : [];

if (process.argv.includes('--baseline')) {
  const { counts } = ratchet(vocabLiterals(vrFiles(), m, vocab), {});
  console.log('const BASELINE = {');
  for (const k of Object.keys(counts).sort()) console.log(`  '${k}': ${counts[k]},`);
  console.log('};');
  h.done();
  process.exit(0);
}

// ---------------------------------------------------------------- the header
const header = ready ? G.emitUeVocab(m) : '';
{
  const want = ['inline constexpr const TCHAR* Draft = TEXT("draft");', 'inline constexpr const TCHAR* Running = TEXT("running");', 'inline constexpr const TCHAR* Proposed = TEXT("proposed");'];
  const ns = (s, f) => new RegExp(`namespace ${s}\\s*\\{[\\s\\S]*?namespace ${f}\\s*\\{([\\s\\S]*?)\\n\\t\\t\\}`).exec(header)?.[1] ?? '';
  const got = [ns('Wave', 'Status').includes(want[0]), ns('ScanJob', 'Status').includes(want[1]), ns('Proposal', 'Status').includes(want[2])];
  h.expect(got.every(Boolean), 'header: BpVocab::Wave::Status::Draft is TEXT("draft"), BpVocab::ScanJob::Status::Running and BpVocab::Proposal::Status::Proposed exist', got);
  const enumFields = [...m.structs.values()].flatMap((st) => st.props.filter((p) => p.node.k === 'string' && p.node.enum?.length > 1).map((p) => `${st.name}.${p.key}`));
  const fieldNs = (header.match(/^\t\tnamespace \w+$/gm) ?? []).length;
  h.expect(enumFields.length >= 70 && fieldNs === enumFields.length && vocab.length === enumFields.length,
    `header: one namespace per struct field holding a string enum (${enumFields.length} fields in the model, ${fieldNs} field namespaces, ${vocab.length} vocab rows; 78 on 2026-11-07, floor 70)`);
  const dup = vocab.filter((f) => new Set(f.values).size !== f.values.length).map((f) => `${f.struct}.${f.field}`);
  const constLines = header.split('\n').filter((l) => /^\t\t\tinline constexpr const TCHAR\* \w+ = TEXT\(/.test(l)).length;
  const valueCount = vocab.reduce((n, f) => n + f.values.length, 0);
  h.expect(!dup.length && constLines === valueCount && valueCount > 0, `header: each value once (${constLines} constants for ${valueCount} enum values)`);
  const again = ready ? G.emitUeVocab(G.model(G.readSchemas())) : null;
  h.expect(ready && again === header, 'header: two generations from the same schemas are byte-identical');
  const committed = fs.existsSync(path.join(ROOT, HEADER)) ? fs.readFileSync(path.join(ROOT, HEADER), 'utf8').replace(/\r\n/g, '\n') : null;
  h.expect(committed !== null && committed === header, `header: the committed ${HEADER} is the fresh generation`, committed === null ? 'missing: run npm run schema:generate' : 'stale: run npm run schema:generate');
  const outs = typeof G.outputsOf === 'function' ? G.outputsOf(G.generate(schemas)).map(([f]) => path.relative(ROOT, f).split(path.sep).join('/')) : [];
  h.expect(outs.includes(HEADER), 'header: it is one of generate.mjs outputsOf (written by schema:generate, read by the stale loop)', outs);
}
// seeded schemas: a value added and a value removed
{
  const emit = ready ? G.emitUeVocab : () => '';
  const waveStatus = (s) => s['scan-wire-1.schema.json'].$defs.wave.properties.status;
  const added = structuredClone(schemas); waveStatus(added).enum.push('zzProbe');
  const addedText = emit(G.model(added));
  h.expect(addedText.includes('inline constexpr const TCHAR* ZzProbe = TEXT("zzProbe");'), 'seeded: wave.status gains zzProbe -> the fresh header holds BpVocab::Wave::Status::ZzProbe');
  const removed = structuredClone(schemas); waveStatus(removed).enum = waveStatus(removed).enum.filter((v) => v !== 'dispatched');
  const removedText = emit(G.model(removed));
  h.expect(header.includes('Dispatched = TEXT("dispatched")') && !removedText.includes('Dispatched = TEXT("dispatched")'), 'seeded: dispatched removed from wave.status -> BpVocab::Wave::Status::Dispatched is gone');
  const folded = structuredClone(schemas); waveStatus(folded).enum.push('in-dev', 'in_dev');
  let threw = '';
  try { emit(G.model(folded)); } catch (e) { threw = e.message; }
  h.expect(/Wave/.test(threw) && /status/.test(threw) && threw.includes('in-dev') && threw.includes('in_dev'), 'seeded: in-dev and in_dev in one enum fold to one C++ name -> generation throws naming the struct, the field and both values', threw || 'no throw');
}

// ---------------------------------------------------------------- the ratchet over apps/vr/Source
const files = vrFiles();
h.expect(files.filter(([f]) => f.endsWith('.cpp')).length + files.filter(([f]) => f.endsWith('.h')).length >= 15, `the scan read >= 15 .cpp/.h files under ${VR} (${files.length})`);
const hits = vocabLiterals(files, m, vocab);
const real = ratchet(hits, BASELINE);
h.expect(Object.keys(BASELINE).length > 0 && hits.length > 0, `the scanner finds the baseline's literals (${hits.length} on ${new Set(hits.map((x) => `${x.rel}:${x.line}`)).size} lines in ${new Set(hits.map((x) => x.rel)).size} files)`);
h.expect(!real.fresh.length, `no NEW raw vocabulary literal in ${VR} (a schema value is spelled BpVocab::<Struct>::<Field>::<Value>, ${HEADER})`, real.fresh.join('\n'));
h.expect(!real.outside.length, `every literal compared with a schema enum field in ${VR} is a value of that enum`, real.outside.join('\n'));
h.expect(!real.stale.length, 'every BASELINE count is still reached (a migrated site lowers it)', real.stale.join('\n'));

// ---------------------------------------------------------------- seeded controls through the same scanner
{
  const deck = files.find(([f]) => f === 'apps/vr/Source/bp/BpDeck.cpp');
  const seed = (extra) => files.map(([f, t]) => [f, f === deck?.[0] ? `${t}\n${extra}\n` : t]);
  const at = (deck?.[1].split('\n').length ?? 0) + 1;
  const probe = 'static bool ZzProbe(const FBpProposal& Proposal) { return Proposal.status == TEXT("proposed"); }';
  const bit = ratchet(vocabLiterals(seed(probe), m, vocab), BASELINE).fresh;
  h.expect(deck && bit.length === 1 && bit[0].startsWith(`${deck[0]}:${at}: `) && bit[0].includes('BpVocab::Proposal::Status::Proposed'),
    `control: a seeded \`Proposal.status == TEXT("proposed")\` in BpDeck.cpp is reported at its file:line naming BpVocab::Proposal::Status::Proposed`, bit);
  const quiet = [`// ${probe}`, `/* ${probe} */`, `static const TCHAR* ZzQuote = TEXT("Proposal.status == TEXT(\\"proposed\\")");`].map((t) => ratchet(vocabLiterals(seed(t), m, vocab), BASELINE).fresh.length);
  h.expect(quiet.every((n) => n === 0), 'control: the same text in a // comment, a /* */ comment or a string literal is not reported (stripCxx)', quiet);
  const open = ratchet(vocabLiterals(seed('static bool ZzOpen(const FBpWave& Wave) { return Wave.status != TEXT("open"); }'), m, vocab), BASELINE).outside;
  h.expect(open.length === 1 && open[0].endsWith('Wave.status: "open" is not a value of the schema enum (draft, dispatched)'), 'control: a seeded `Wave.status != TEXT("open")` fails with "Wave.status: \\"open\\" is not a value of the schema enum (draft, dispatched)"', open);
  const chained = ratchet(vocabLiterals(seed('static bool ZzAll(const FBpScanJob* Job) { return TEXT("all") == Job->scope.kind; }'), m, vocab), BASELINE).fresh;
  h.expect(chained.length === 1 && chained[0].includes('BpVocab::ScanScope::Kind::All'), 'control: a reversed comparison through a member struct (`TEXT("all") == Job->scope.kind`) is reported as BpVocab::ScanScope::Kind::All', chained);
  const wrist = files.find(([f]) => f === 'apps/vr/Source/bp/BpWrist.cpp');
  const migrated = files.map(([f, t]) => [f, f === wrist?.[0] ? t.replace('Each.status == TEXT("dispatched")', 'Each.status == BpVocab::Wave::Status::Dispatched') : t]);
  const lowered = ratchet(vocabLiterals(migrated, m, vocab), BASELINE).stale;
  h.expect(lowered.length === 1 && lowered[0].startsWith('apps/vr/Source/bp/BpWrist.cpp Wave.status dispatched: the baseline allows 2, the tree has 1'), 'control: a migrated site (BpWrist.cpp\'s dispatched) reads as a baseline to lower', lowered);
}
h.done();
