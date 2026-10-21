// Pins src/engine/lines.ts against the real scale-4 sample model: the engine's product-line fan-out, used by
// Engine.morningShow to target "the same place on every line" from one feature id.
//
// Why it exists: morningShow stripped only LINE ONE's suffix ('-S'), so an id from any other line kept its
// own ('sign-in-G') and the fan-out built 'sign-in-G-S', 'sign-in-G-G', ... - ids that exist nowhere. The
// targets came out empty, and morningShow closes the watch before it checks, so at ?scale=4 three of the four
// lines made "Show these places on the plan" close the panel and do nothing at all, silently.
//
// Half 2 is the part that matters: the ids come from the model, not from a list in this file, so the assertion
// is against the ground truth and not against the implementation's own idea of what a line suffix looks like.
// Run: node --import @bp/core/register scripts/check-engine-lines.ts     Exit 1 on any miss.
// Control: BP_ENGINE_LINES_SEED=1 replays the line-one-only strip, so both halves can be seen red.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { lineSiblings } from '../apps/web/src/engine/lines.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const core = (p: string) => import(pathToFileURL(path.join(ROOT, 'packages/core', p)).href);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const { LINES }: Any = await core('src/model/constants.ts');
const { buildModel }: Any = await core('src/model/sample.ts');

let held = 0;
const failures: string[] = [];
const expect = (ok: boolean, what: string, got?: string) => { if (ok) held++; else failures.push(what + (got === undefined ? '' : ` (got ${got})`)); };
const SEED = !!process.env.BP_ENGINE_LINES_SEED;

/** The old line-one-only strip, for the seeded control. */
const seededSiblings = (fid: string, sfx: readonly string[]): string[] => {
  if (!sfx.length) return [fid];
  const base = fid.endsWith(sfx[0]) ? fid.slice(0, -sfx[0].length) : fid;
  return sfx.map((s) => base + s);
};
const fan = SEED ? seededSiblings : lineSiblings;

// ------------------------------------------------------------------------- 1. the fan-out, on its own terms
{
  const sfx = ['-S', '-G', '-P', '-C'];
  for (const s of sfx) {
    const out = fan('sign-in' + s, sfx);
    expect(out.join(',') === 'sign-in-S,sign-in-G,sign-in-P,sign-in-C', `an id on line ${s} does not fan out to every line`, out.join(','));
  }
  expect(fan('sign-in', sfx).join(',') === 'sign-in-S,sign-in-G,sign-in-P,sign-in-C', 'an unsuffixed id does not fan out');
  expect(fan('sign-in-S', []).join(',') === 'sign-in-S', 'at scale 1 the id must come back untouched', fan('sign-in-S', []).join(','));
  // only a trailing suffix is a suffix: a hyphen-S inside the slug is part of the name
  const inner = fan('sign-in-Sms-G', sfx);
  expect(inner[0] === 'sign-in-Sms-S', 'a suffix-looking fragment inside the slug was stripped', inner[0]);
}

// ------------------------------------------- 2. ground truth: every line of the real scale-4 model round-trips
{
  const M: Any = buildModel(4, () => 0, null), P = M.P, sc = P.scale;
  const sfx: string[] = LINES.slice(0, sc).map((l: Any) => '-' + l[1]);
  const all: string[] = P.features.map((f: Any) => f.id);
  expect(all.length > 100 && sfx.length === 4, `the scale-4 model looks wrong (${all.length} features, ${sfx.length} lines): the probe stopped matching`);
  const dead: string[] = [];
  for (let b = 0; b < sc; b++) {
    const mine = all.filter((id) => id.endsWith(sfx[b]));
    expect(mine.length > 0, `line ${sfx[b]} has no features in the scale-4 model`);
    // every one of this line's features must fan out to a full set of ids the model actually holds
    for (const id of mine.slice(0, 25)) {
      const out = fan(id, sfx).filter((x) => P.F[x]);
      if (out.length !== sc) dead.push(`${id} -> ${out.length}/${sc}`);
    }
  }
  expect(dead.length === 0, `${dead.length} feature id(s) fan out to fewer than ${sc} real places: ${dead.slice(0, 4).join(', ')}`);
  // and the whole thing Engine.morningShow does: a watch event on ANY line must target something
  const empties: string[] = [];
  for (let b = 0; b < sc; b++) {
    const sample = all.filter((id) => id.endsWith(sfx[b])).slice(0, 3);
    const ids: Record<string, 1> = {};
    for (const f of sample) for (const id of fan(f, sfx)) if (P.F[id]) ids[id] = 1;
    if (!Object.keys(ids).length) empties.push(sfx[b]);
  }
  expect(empties.length === 0, `"Show these places on the plan" targets nothing for ${empties.length} of ${sc} product lines (${empties.join(', ')})`);
}

if (failures.length) { console.log(failures.map((f) => 'FAIL ' + f).join('\n')); console.log(`check-engine-lines: ${failures.length} failed, ${held} held${SEED ? ' [seeded]' : ''}`); process.exit(1); }
console.log(`check-engine-lines: ${held} expectations held${SEED ? ' [seeded]' : ''}`);
