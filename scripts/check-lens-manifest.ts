// Checks checkLensManifest (src/lib/scan/manifest-check.ts), the gate a lens manifest passes before the blueprint
// writes it into a map or offers it from the onboarding chat (spec 8.1, 8.2, 8.6):
//   - ids: a tmp. id in temporary mode, a reverse-DNS id in project mode, and never the other way round or a built-in;
//   - scans: judgement, or steps (script yields name numeric metric fields, conform only, budget 1..50, 1..8 steps);
//   - glyph paths: inside the 16x16 box, relative commands and arcs included, and at least 2 strokes;
//   - looks: a glyph+line pair another enabled lens draws is refused (same name, or the same path up to whitespace);
//   - the built-in business, operations and quality manifests carry a scan block the check accepts.
// Run: node scripts/check-lens-manifest.ts  (Node's type stripping; no build step). Exit 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLensManifest, checkTempManifest, type TakenLook } from '../src/lib/scan/manifest-check.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')) as Record<string, any>;

let held = 0;
const failures: string[] = [];
/** `want`: null = accepted; a string = refused with a message containing it. */
const expect = (what: string, got: string | null, want: string | null) => {
  const ok = want === null ? got === null : got !== null && got.includes(want);
  if (ok) held++; else failures.push(`${what}: got ${JSON.stringify(got)}, expected ${want === null ? 'accepted' : JSON.stringify(want)}`);
};

const steps = read('docs/standard/schema/fixtures/valid-steps-lens.json');
const base = () => structuredClone(steps);
const withId = (id: string) => ({ ...base(), id });
const proj = (m: unknown, taken?: TakenLook[]) => checkLensManifest(m, { mode: 'project', taken });
const temp = (m: unknown, taken?: TakenLook[]) => checkLensManifest(m, { mode: 'temporary', taken });

// ------------------------------------------------------------------ ids
expect('project id in project mode', proj(base()), null);
expect('project id in temporary mode', temp(base()), 'id must be tmp.<kebab>');
expect('tmp id in temporary mode', temp(withId('tmp.registry-check')), null);
expect('tmp id in project mode', proj(withId('tmp.registry-check')), 'id must be reverse-DNS');
expect('tmp.a.b in project mode (reverse-DNS shape, still a tmp. id)', proj(withId('tmp.example.lens')), 'id must be reverse-DNS');
expect('built-in id in project mode', proj(withId('operations')), 'is a built-in lens');
expect('checkTempManifest is the temporary mode', checkTempManifest(base()), 'id must be tmp.<kebab>');
expect('checkTempManifest accepts a tmp lens', checkTempManifest(withId('tmp.registry-check')), null);

// ------------------------------------------------------------------ scans
const scan = (f: (m: Record<string, any>) => void) => { const m = base(); f(m); return proj(m); };
expect('judgement scan', scan((m) => { m.scan = { method: 'judgement', instructions: 'Count deviations.' }; }), null);
expect('judgement scan without instructions', scan((m) => { m.scan = { method: 'judgement', instructions: ' ' }; }), 'needs instructions');
expect('no scan', scan((m) => { delete m.scan; }), "scan must be { method: 'judgement'");
expect('unknown method', scan((m) => { m.scan.method = 'probe'; }), "scan must be { method: 'judgement'");
expect('steps scan with instructions too', scan((m) => { m.scan.instructions = 'x'; }), 'takes only method and steps');
expect('no steps', scan((m) => { m.scan.steps = []; }), 'must list 1 to 8 steps');
expect('nine steps', scan((m) => { m.scan.steps = Array.from({ length: 9 }, () => ({ kind: 'skill', skill: 'conform' })); }), 'must list 1 to 8 steps');
expect('yields an unknown field', scan((m) => { m.scan.steps[0].yields = ['leadsLanded']; }), 'yields "leadsLanded", which is not a numeric metric field');
expect('yields a field with no metric', scan((m) => { m.fields.push({ key: 'note', label: 'Note', type: 'integer' }); m.scan.steps[0].yields = ['note']; }), 'not a numeric metric field');
expect('script without yields', scan((m) => { m.scan.steps[0].yields = []; }), 'needs yields');
expect('script without run', scan((m) => { m.scan.steps[0].run = ''; }), 'needs run');
expect('skill other than conform', scan((m) => { m.scan.steps[1].skill = 'lint'; }), 'the skill must be one of conform');
expect('budget 51', scan((m) => { m.scan.steps[1].budget = 51; }), 'budget must be an integer 1 to 50');
expect('budget 1.5', scan((m) => { m.scan.steps[1].budget = 1.5; }), 'budget must be an integer');
expect('skill with args', scan((m) => { m.scan.steps[1].args = '--topics auth'; }), null);
expect('judgement step without instructions', scan((m) => { m.scan.steps[2].instructions = ''; }), 'a judgement step needs instructions');
expect('unknown step kind', scan((m) => { m.scan.steps[2].kind = 'probe'; }), 'kind must be script, skill or judgement');
expect('extra key on a step', scan((m) => { m.scan.steps[0].env = 'x'; }), 'takes only kind, run and yields');

// ------------------------------------------------------------------ glyph paths
const glyph = (g: unknown) => { const m = base(); m.presentation.glyph = g; return proj(m); };
expect('a path inside the box', glyph({ path: 'M2 3h12v10H2zM5 6h6M5 9h4' }), null);
expect('the Kettle cost glyph (arcs, relative)', glyph(read('docs/standard/lenses-custom/com.kettle.cost.json').presentation.glyph), null);
expect('compact arc flags', glyph({ path: 'M2 8a6 6 0 1012 0L8 2' }), null);
expect('an absolute point outside the box', glyph({ path: 'M2 2L20 8L2 14' }), 'leaves the 16x16 box at (20, 8)');
expect('a negative point outside the box', glyph({ path: 'M2 2L8 -1L14 2' }), 'leaves the 16x16 box at (8, -1)');
expect('a relative walk out of the box', glyph({ path: 'M8 8l6 0l6 0' }), 'leaves the 16x16 box at (20, 8)');
expect('a control point out of the box', glyph({ path: 'M2 8C2 30 14 30 14 8L2 8' }), 'leaves the 16x16 box at (2, 30)');
expect('the stroke allowance at 16.5', glyph({ path: 'M0 0L16.5 0L16.5 16' }), null);
expect('one stroke', glyph({ path: 'M2 2L14 14' }), 'fewer than 2 strokes');
expect('a move and a close', glyph({ path: 'M2 2Z' }), 'fewer than 2 strokes');
expect('a command missing a number', glyph({ path: 'M2 2L14' }), 'is missing a number');
expect('markup in a path', glyph({ path: 'M2 2<script>' }), 'presentation.glyph must be one of');
expect('a shared glyph name', glyph('pulse'), null);
expect('an unknown glyph name', glyph('star'), 'presentation.glyph must be one of');

// ------------------------------------------------------------------ looks taken by another enabled lens
const PATH = 'M2 3h12v10H2zM5 6h6M5 9h4';
expect('the same path and line', proj(base(), [{ glyph: { path: PATH }, line: 'solid' }]), 'lens look custom path + solid is already drawn by another lens; pick another glyph or line');
expect('the same path up to whitespace', proj(base(), [{ glyph: { path: `  M2 3h12v10H2z   M5 6h6\nM5 9h4 ` }, line: 'solid' }]), 'is already drawn by another lens');
expect('the same path, another line', proj(base(), [{ glyph: { path: PATH }, line: 'chain' }]), null);
expect('another path, the same line', proj(base(), [{ glyph: { path: 'M2 2h12v12H2z' }, line: 'solid' }]), null);
const named = base(); named.presentation.glyph = 'pulse'; named.presentation.line = 'chain';
expect('a taken name and line', proj(named, [{ glyph: 'pulse', line: 'chain' }]), 'lens look pulse + chain is already drawn');
expect('a taken name, temporary mode too', checkLensManifest({ ...named, id: 'tmp.pulse-check' }, { mode: 'temporary', taken: [{ glyph: 'pulse', line: 'chain' }] }), 'is already drawn');
expect('a name against a path of the same text', proj(named, [{ glyph: { path: 'pulse' }, line: 'chain' }]), null);

// ------------------------------------------------------------------ the built-ins' scan blocks
// Their ids are built-in, so they pass as a project lens under a stand-in id: the check is of the scan block and fields.
for (const id of ['business', 'operations', 'quality']) {
  const m = read(`docs/standard/lenses/${id}.json`);
  expect(`built-in ${id} has a judgement scan`, m.scan?.method === 'judgement' ? null : 'no judgement scan', null);
  expect(`built-in ${id} passes as a lens`, proj({ ...m, id: `com.example.${id}` }), null);
  const unitless = (m.fields as { key: string; type: string; unit?: string; metric?: unknown }[]).filter((f) => f.metric && f.type === 'integer' && !f.unit).map((f) => f.key);
  expect(`built-in ${id}: every count metric has a unit`, unitless.length ? `no unit on ${unitless.join(', ')}` : null, null);
}

const total = held + failures.length;
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`${held} of ${total} lens-manifest expectations hold`);
process.exit(failures.length ? 1 : 0);
