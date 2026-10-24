#!/usr/bin/env node
// schema:generate --since <ref>: packages/schema/compat.mjs's diff(oldModel, newModel) classifies every schema edit by
// what it does to each channel (the VR client's USTRUCTs, the TS readers), so a breaking edit is seen before a write.
// Asserts, on in-memory edits of the committed schemas (one line each):
//   identity     diff(model(S), model(S)) is [] for the six committed schemas
//   added        an optional `zz` on app-structure-3 $defs.feature is exactly one change, added, not breaking
//   removed      scan-wire-1 wave.dispatched_at deleted is removed + breaking; its ue note says FBpWave.dispatched_at
//                keeps its default (a silent empty)
//   enum         'xhigh' dropped from waveEffort is enum-narrowed + breaking at BOTH WavePackage.effort and
//                ScanJob.effort (the $ref is followed, one change per holding field) and nowhere else
//   ue-type      plan-1 planBox.x number -> integer is a breaking ue-type change (double -> int32, FBpPlanBox)
//   req-dropped  planWing.letter made optional is required-dropped, breaking for the TS readers only
//   req-added    wave.dispatched_at made required is required-added + breaking; the report line names
//                scan-wire-1.schema.json and says its version suffix is unchanged
//   cli          `generate.mjs --since HEAD --dry-run` prints `no schema change since HEAD` on a clean schema tree (a
//                change line otherwise), writes none of the generated files, exits 0
//   GUARD        `generate.mjs --check` exits 0 and prints no change report (the card leaves --check alone)
// Run: node scripts/check-schema-compat.mjs   (exit 1 on any failure)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEN = path.join(ROOT, 'packages/schema/generate.mjs');
let passed = 0, failed = 0;
const check = (name, ok, detail) => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
};
const load = async (p) => { try { return await import(pathToFileURL(path.join(ROOT, p)).href); } catch (e) { return { __error: e.message.split('\n')[0] }; } };

const G = await load('packages/schema/generate.mjs');
const C = await load('packages/schema/compat.mjs');
const ready = typeof C.diff === 'function' && typeof C.report === 'function';
const why = ready ? '' : `compat.mjs exports no diff / report${C.__error ? ': ' + C.__error : ''}`;
const S = G.readSchemas();
/** The changes from the committed schemas to a copy edited by `edit`. */
const changes = (edit) => {
  if (!ready) return null;
  const s = structuredClone(S); edit?.(s);
  return C.diff(G.model(structuredClone(S)), G.model(s));
};
const show = (cs) => (cs ? JSON.stringify(cs.map(({ struct, key, kind, breaking, breakingFor }) => ({ struct, key, kind, breaking, breakingFor }))) : why);
const wire = (s) => s['scan-wire-1.schema.json'].$defs, plan = (s) => s['plan-1.schema.json'].$defs;

{
  const cs = changes();
  check('identity: diff(model(S), model(S)) is [] for the six committed schemas', Array.isArray(cs) && cs.length === 0, show(cs));
}
{
  const cs = changes((s) => { s['app-structure-3.schema.json'].$defs.feature.properties.zz = { type: 'string' }; });
  const c = cs?.[0];
  check("added: an optional zz on feature is one change {struct:'Feature', key:'zz', kind:'added', breaking:false}",
    cs?.length === 1 && c.struct === 'Feature' && c.key === 'zz' && c.kind === 'added' && c.breaking === false && c.file === 'app-structure-3.schema.json', show(cs));
}
{
  const cs = changes((s) => { delete wire(s).wave.properties.dispatched_at; });
  const c = cs?.[0];
  check("removed: wave.dispatched_at deleted is {struct:'Wave', key:'dispatched_at', kind:'removed', breaking:true}, ue note 'FBpWave.dispatched_at keeps its default'",
    cs?.length === 1 && c.struct === 'Wave' && c.key === 'dispatched_at' && c.kind === 'removed' && c.breaking === true
      && /FBpWave\.dispatched_at keeps its default/.test(c.ue) && /silent empty/.test(c.ue), show(cs) + (c ? ' ue: ' + c.ue : ''));
}
{
  const cs = changes((s) => { wire(s).waveEffort.enum = wire(s).waveEffort.enum.filter((v) => v !== 'xhigh'); });
  const at = (cs ?? []).map((c) => `${c.struct}.${c.key}:${c.kind}:${c.breaking}`).sort();
  check("enum: 'xhigh' dropped from waveEffort is breaking enum-narrowed at WavePackage.effort AND ScanJob.effort, nothing else",
    JSON.stringify(at) === JSON.stringify(['ScanJob.effort:enum-narrowed:true', 'WavePackage.effort:enum-narrowed:true']) && cs.every((c) => /xhigh/.test(c.ts + c.ue + c.what)), show(cs));
}
{
  const cs = changes((s) => { plan(s).planBox.properties.x = { type: 'integer' }; });
  const c = cs?.[0];
  check("ue-type: planBox.x number -> integer is breaking 'ue-type', double -> int32 on FBpPlanBox",
    cs?.length === 1 && c.struct === 'PlanBox' && c.key === 'x' && c.kind === 'ue-type' && c.breaking === true && /double -> int32/.test(c.ue) && /FBpPlanBox/.test(c.ue), show(cs) + (c ? ' ue: ' + c.ue : ''));
}
{
  const cs = changes((s) => { plan(s).planWing.required = plan(s).planWing.required.filter((k) => k !== 'letter'); });
  const c = cs?.[0];
  check("req-dropped: planWing.letter made optional is 'required-dropped', breaking for the TS readers only",
    cs?.length === 1 && c.struct === 'PlanWing' && c.key === 'letter' && c.kind === 'required-dropped' && c.breaking === true && JSON.stringify(c.breakingFor) === '["ts"]', show(cs));
}
{
  const cs = changes((s) => { wire(s).wave.required.push('dispatched_at'); });
  const c = cs?.[0];
  const lines = ready ? C.report(cs, { since: 'HEAD' }) : [];
  const text = lines.join('\n');
  check("req-added: wave.dispatched_at made required is breaking 'required-added'; the report names scan-wire-1.schema.json and says its version suffix is unchanged",
    cs?.length === 1 && c.kind === 'required-added' && c.breaking === true && /scan-wire-1\.schema\.json/.test(text) && /BREAKING/.test(text) && /version suffix -1 unchanged/.test(text), show(cs) + ' | ' + text);
}
{
  const outs = typeof G.outputsOf === 'function' ? G.outputsOf(G.generate(S)).map(([f]) => f) : [];
  const bytes = () => outs.map((f) => (fs.existsSync(f) ? fs.readFileSync(f).toString('base64') : null)).join('|');
  const before = bytes();
  const r = spawnSync(process.execPath, [GEN, '--since', 'HEAD', '--dry-run'], { cwd: ROOT, encoding: 'utf8' });
  const clean = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', 'packages/schema/schema'], { cwd: ROOT }).status === 0;
  const said = /no schema change since HEAD/.test(r.stdout);
  check(`cli: --since HEAD --dry-run on a ${clean ? 'clean' : 'dirty'} schema tree ${clean ? 'prints "no schema change since HEAD"' : 'reports a change'}, writes none of the ${outs.length} generated files, exits 0`,
    r.status === 0 && said === clean && outs.length === 4 && bytes() === before && !/^wrote /m.test(r.stdout), `exit ${r.status}: ${(r.stdout + r.stderr).trim().split('\n').slice(0, 3).join(' | ')}`);
}
{
  const r = spawnSync(process.execPath, [GEN, '--check'], { cwd: ROOT, encoding: 'utf8' });
  check('GUARD: --check exits 0 and prints no change report', r.status === 0 && !/schema change since|BREAKING/.test(r.stdout), `exit ${r.status}: ${r.stdout.split('\n').filter((l) => l.startsWith('FAIL')).join(' | ')}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
