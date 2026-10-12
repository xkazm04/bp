// Pins how the timeline words a scan run (timeline/run.ts): the guarded lens accessor, progress against the run's scope,
// duration, and the age wording shared with the header pill. Run: node src/components/timeline/check-run.ts. Exit 1 on failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmtDur, runAgeMs, runFacts, runLenses, runMs, runProgress, scopeFeatures } from './run.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => { if (ok) held++; else failures.push(what); };

const min = 60000, T0 = Date.parse('2026-10-08T14:02:00Z');
const run = { id: 'r1', started_at: '2026-10-08T14:02:00Z', updated_at: '2026-10-08T14:43:00Z', ended_at: '2026-10-08T14:43:00Z', status: 'done', lenses: ['quality', 'security'] };
const feats = [{ id: 'a', domain: 'Pay', capability: 'cap1' }, { id: 'b', domain: 'Pay', capability: 'cap2' }, { id: 'c', domain: 'Ops', capability: 'cap3' }];
const meas = [{ run_id: 'r1', feature: 'a' }, { run_id: 'r1', feature: 'a' }, { run_id: 'r1', feature: 'c' }, { run_id: 'r0', feature: 'b' }];
const ago = (ms: number) => Math.round(ms / min) + ' min ago';

expect(runLenses(null).length === 0 && runLenses({} as never).length === 0 && runLenses(run).join() === 'quality,security', 'runLenses is not guarded');
expect(scopeFeatures({}, feats).length === 3 && scopeFeatures({ scope: { group: 'pay' } }, feats).length === 2 && scopeFeatures({ scope: { group: 'nope' } }, feats).length === 3, 'scope: none / matching / unmatched');
const p = runProgress(run, meas, feats);
expect(p.done === 2 && p.total === 3, `progress counts distinct features of this run only (${p.done}/${p.total})`);
expect(runProgress(run, meas, []).total === 2, 'total is never below done');
expect(runMs(run, T0 + 999 * min) === 41 * min, 'finished run: duration is ended - started');
expect(runMs({ ...run, ended_at: undefined, status: 'running' }, T0 + 6 * min) === 6 * min, 'running run: duration is now - started');
expect(runMs({ ...run, ended_at: undefined, status: 'failed' }, T0 + 999 * min) === 41 * min, 'ended without ended_at: up to its last update');
expect(fmtDur(38000) === '38 s' && fmtDur(41 * min) === '41 min' && fmtDur(65 * min) === '1 h 05 min', 'fmtDur');
expect(runAgeMs(run, T0 + 41 * min + 2 * 60 * min) === 120 * min, 'age counts from ended_at');
const done = runFacts(run, p, T0 + 41 * min + 2 * 60 * min, ago);
expect(done.time === '120 min ago · 41 min' && done.progress === '2 / 3 features', `finished facts: ${done.time} / ${done.progress}`);
expect(runFacts({ ...run, ended_at: undefined, status: 'running' }, p, T0 + 6 * min, ago).time === '6 min elapsed', 'running facts');
// the header pill words the age with the same `ago`
expect(/\bago\b/.test(fs.readFileSync(path.join(HERE, '../Header.tsx'), 'utf8')) && /from '\.\.\/Header'/.test(fs.readFileSync(path.join(HERE, 'shared.ts'), 'utf8')), 'the timeline does not use the header\'s ago');

if (failures.length) {
  console.error(`check-run: ${failures.length} failure(s), ${held} held`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`check-run: ${held} expectations held (guarded lenses, scope progress, duration, age wording)`);
