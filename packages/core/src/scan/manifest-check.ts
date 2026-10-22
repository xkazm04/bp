// The structural check a lens manifest passes before the blueprint writes it into a map (POST /lenses) or
// offers it from the onboarding chat (POST /api/lens-draft): a temporary lens (`tmp.` id) or a permanent
// project lens (reverse-DNS id). Not the schema (ajv is a dev dependency only): the subset that decides
// whether the lens can be drawn and scanned. The full rules stay with scripts/validate-structure.mjs.
// Pure and import-free at runtime, so Node checks load it as-is.
import type { ComputedHealth, Density, FieldType, GlyphName, LineName, MetricMethod } from '@bp/core/standard/types';
import { PROJECT_LENS_ID, TEMP_LENS_ID } from './jobs.ts';
import { isObj } from '@bp/core/scan/guards';

// Records, not lists: a name added to the type without one here fails the typecheck.
const GLYPHS: Record<GlyphName, 1> = { bars: 1, 'set-square': 1, brackets: 1, pulse: 1, padlock: 1, check: 1, stopwatch: 1 };
const LINES: Record<LineName, 1> = { solid: 1, double: 1, dotted: 1, comb: 1, chain: 1, hatched: 1, dimension: 1, wave: 1 };
const DENSITY: Record<Density, 1> = { simple: 1, standard: 1, dense: 1 };
const TYPES: Record<FieldType, 1> = { number: 1, integer: 1, percent: 1, money: 1, boolean: 1, string: 1, enum: 1, date: 1 };
const NUMERIC: Partial<Record<FieldType, 1>> = { number: 1, integer: 1, percent: 1, money: 1 };
const HEALTH: Record<ComputedHealth, 1> = { good: 1, watch: 1, bad: 1 };
const METHODS: Record<MetricMethod, 1> = { static: 1, probe: 1, harness: 1, judgement: 1 };
/** The seven built-in ids (the schema's builtinLensId): a project lens never takes one. */
const BUILTIN_IDS = new Set(['business', 'design', 'development', 'operations', 'security', 'quality', 'performance']);
const TOP = new Set(['$schema', 'id', 'version', 'name', 'short', 'description', 'reader', 'fields', 'health', 'presentation', 'scan']);
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, KEY = /^[a-z][A-Za-z0-9]*$/, SHORT = /^[A-Z0-9]{2,4}$/;
const PATH_OK = /^[Mm][MmZzLlHhVvCcSsQqTtAa0-9eE.,+\- ]{0,2047}$/;
/** The steps a composed scan may hold (spec 8.2), and the one skill lens-scan 1.3.0 runs. */
const MAX_STEPS = 8, SKILLS = new Set(['conform']), MAX_BUDGET = 50;

const has = (r: Record<string, 1> | Partial<Record<string, 1>>, v: unknown): boolean => typeof v === 'string' && Object.hasOwn(r, v);
const text = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';
const only = (o: Record<string, unknown>, keys: string[]): boolean => Object.keys(o).every((k) => keys.includes(k));

/** The field keys a condition names (so a rule over an unknown field is caught). */
function condFields(c: unknown, out: string[]): string[] {
  if (!isObj(c)) return out;
  for (const k of ['all', 'any'] as const) if (Array.isArray(c[k])) for (const x of c[k] as unknown[]) condFields(x, out);
  if (c.not !== undefined) condFields(c.not, out);
  if (typeof c.field === 'string') out.push(c.field);
  return out;
}

// ------------------------------------------------------------------------------- the glyph path
/** Numbers each path command takes (lower case); the extra pairs after an M are line-tos. */
const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/, NUM_START = /[0-9.+-]/;
/** The 16x16 box, with half a unit for the stroke. */
const BOX_LO = -0.5, BOX_HI = 16.5;

/**
 * Why a custom glyph path cannot be drawn in the 16x16 box, or null. Walks every command, relative ones
 * included, keeping the pen: every end and control point must stay in the box (an arc's bulge is not
 * checked, only its end). A path of fewer than two strokes reads as nothing at 7 px.
 */
function pathProblem(d: string): string | null {
  let i = 0, x = 0, y = 0, sx = 0, sy = 0, strokes = 0;
  const skip = () => { while (i < d.length && (d[i] === ' ' || d[i] === ',')) i++; };
  const num = (): number | null => {
    skip();
    const m = NUM.exec(d.slice(i));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  // an arc's flags are one digit each, so "a1 1 0 01 5 5" reads as 0, 1
  const flag = (): number | null => { skip(); const c = d[i]; if (c !== '0' && c !== '1') return null; i++; return Number(c); };
  skip();
  while (i < d.length) {
    const cmd = d[i++], lo = cmd.toLowerCase(), rel = cmd === lo;
    const n = ARGS[lo];
    if (n === undefined) return `does not parse at "${cmd}"`;
    if (lo === 'z') { x = sx; y = sy; skip(); continue; }
    let first = true;
    do {
      const a: number[] = [];
      for (let k = 0; k < n; k++) {
        const v = lo === 'a' && (k === 3 || k === 4) ? flag() : num();
        if (v === null) return `does not parse: "${cmd}" is missing a number`;
        a.push(v);
      }
      const ox = rel ? x : 0, oy = rel ? y : 0;
      const pts: [number, number][] = [];
      if (lo === 'h') pts.push([a[0] + ox, y]);
      else if (lo === 'v') pts.push([x, a[0] + oy]);
      else if (lo === 'a') pts.push([a[5] + ox, a[6] + oy]);
      else for (let k = 0; k < n; k += 2) pts.push([a[k] + ox, a[k + 1] + oy]);
      const outside = pts.find(([px, py]) => !(px >= BOX_LO && px <= BOX_HI && py >= BOX_LO && py <= BOX_HI));
      if (outside) return `leaves the 16x16 box at (${outside[0]}, ${outside[1]})`;
      [x, y] = pts[pts.length - 1];
      if (lo === 'm' && first) { sx = x; sy = y; } else strokes++;
      first = false;
      skip();
    } while (i < d.length && NUM_START.test(d[i]));
  }
  return strokes < 2 ? 'draws fewer than 2 strokes, too little to read at 7 px' : null;
}

/** A glyph's identity for the look-collision rule: the name, or the path with its whitespace normalised (runs
 *  collapse to one space, none around a command letter or comma, where it never separates two numbers). A glyph
 *  that is neither (a hand-edited map's `taken` entry) gets no identity, so it collides with nothing and never
 *  throws out of a check whose contract is null-or-one-sentence. */
const glyphKey = (g: unknown): string | null =>
  typeof g === 'string' ? `name:${g}`
    : g && typeof g === 'object' && typeof (g as { path?: unknown }).path === 'string'
      ? `path:${(g as { path: string }).path.trim().replace(/\s*([A-Za-z,])\s*/g, '$1').replace(/\s+/g, ' ')}`
      : null;

// ------------------------------------------------------------------------------- the check
/** A glyph+line pair another enabled lens of the product already draws. */
export interface TakenLook { glyph: string | { path: string }; line: string }
export interface CheckLensOptions {
  /** `temporary`: a `tmp.<kebab>` id. `project`: a permanent reverse-DNS id (PROJECT_LENS_ID). */
  mode: 'temporary' | 'project';
  /** The product's other enabled lenses' looks: a manifest drawing the same glyph AND line is refused. */
  taken?: readonly TakenLook[];
}

/**
 * null when `x` is a lens manifest the blueprint can write and a scan can measure; else what failed, one sentence.
 * Accepts a scan block of `{method:'judgement', instructions}` or `{method:'steps', steps}` (LensScanStep).
 */
export function checkLensManifest(x: unknown, opts: CheckLensOptions): string | null {
  if (!isObj(x)) return 'the manifest must be a JSON object';
  const extra = Object.keys(x).filter((k) => !TOP.has(k));
  if (extra.length) return `unknown keys: ${extra.join(', ')}`;
  if (x.$schema !== 'lens-manifest/1') return '$schema must be "lens-manifest/1"';
  if (opts.mode === 'temporary') {
    if (typeof x.id !== 'string' || !TEMP_LENS_ID.test(x.id)) return `id must be tmp.<kebab> (got ${JSON.stringify(x.id)})`;
  } else {
    if (typeof x.id === 'string' && BUILTIN_IDS.has(x.id)) return `id ${x.id} is a built-in lens; a project lens needs a reverse-DNS id such as com.example.cost`;
    // a permanent lens never takes a tmp. id (spec 8.1), though tmp.a.b would pass the reverse-DNS shape
    if (typeof x.id !== 'string' || !PROJECT_LENS_ID.test(x.id) || x.id.startsWith('tmp.')) return `id must be reverse-DNS, such as com.example.cost (got ${JSON.stringify(x.id)})`;
  }
  if (typeof x.version !== 'string' || !SEMVER.test(x.version)) return 'version must be semver, e.g. 1.0.0';
  if (!text(x.name)) return 'name is required';
  if (x.short !== undefined && (typeof x.short !== 'string' || !SHORT.test(x.short))) return 'short must be 2-4 capital letters or digits';
  if (x.description !== undefined && typeof x.description !== 'string') return 'description must be a string';
  if (!isObj(x.reader) || !has(DENSITY, x.reader.density)) return 'reader.density must be simple, standard or dense';
  if (x.reader.role !== undefined && typeof x.reader.role !== 'string') return 'reader.role must be a string';

  if (!Array.isArray(x.fields) || !x.fields.length) return 'fields must list at least one field';
  const keys = new Set<string>(), numeric = new Set<string>(), metrics = new Set<string>();
  for (const [i, f] of (x.fields as unknown[]).entries()) {
    if (!isObj(f)) return `fields[${i}] must be an object`;
    if (typeof f.key !== 'string' || !KEY.test(f.key)) return `fields[${i}].key must be camelCase`;
    if (keys.has(f.key)) return `field key ${f.key} is used twice`;
    keys.add(f.key);
    if (!text(f.label)) return `field ${f.key} needs a label`;
    if (!has(TYPES, f.type)) return `field ${f.key} has an unknown type ${JSON.stringify(f.type)}`;
    if (f.type === 'enum' && (!Array.isArray(f.values) || !f.values.length || f.values.some((v) => typeof v !== 'string'))) return `enum field ${f.key} needs its values`;
    if (f.type === 'money' && (typeof f.currency !== 'string' || !/^[A-Z]{3}$/.test(f.currency))) return `money field ${f.key} needs a currency`;
    if (has(NUMERIC, f.type)) numeric.add(f.key);
    if (f.metric !== undefined) {
      if (!has(NUMERIC, f.type)) return `field ${f.key} has a metric but is not numeric (integer, number, percent or money)`;
      if (!isObj(f.metric) || (f.metric.better !== 'up' && f.metric.better !== 'down') || !has(METHODS, f.metric.method)) return `field ${f.key}: metric needs better (up|down) and a method`;
      metrics.add(f.key);
    }
  }
  if (!metrics.size) return 'at least one numeric field needs a metric block, or the scan has nothing to fill';

  const h = x.health;
  if (!isObj(h) || !Array.isArray(h.rules)) return 'health.rules is required';
  for (const [i, r] of (h.rules as unknown[]).entries()) {
    if (!isObj(r) || !isObj(r.when) || !has(HEALTH, r.health) || !text(r.reason)) return `health.rules[${i}] needs when, health (good|watch|bad) and reason`;
    const unknown = condFields(r.when, []).find((k) => !keys.has(k));
    if (unknown) return `health.rules[${i}] names an unknown field ${unknown}`;
  }
  if (!has(HEALTH, h.default)) return 'health.default must be good, watch or bad';
  const ru = h.rollup;
  if (!isObj(ru)) return 'health.rollup is required';
  if (ru.method === 'share') { if (typeof ru.watch !== 'number' || typeof ru.bad !== 'number') return 'a share rollup needs watch and bad fractions'; }
  else if (ru.method === 'weighted') { if (typeof ru.by !== 'string' || !numeric.has(ru.by)) return 'a weighted rollup needs by = a numeric field'; }
  else if (ru.method !== 'worst-of') return 'health.rollup.method must be worst-of, share or weighted';

  const p = x.presentation;
  if (!isObj(p)) return 'presentation is required';
  const g = p.glyph;
  if (isObj(g) && typeof g.path === 'string' && PATH_OK.test(g.path)) {
    const why = pathProblem(g.path);
    if (why) return `presentation.glyph.path ${why}`;
  } else if (!has(GLYPHS, g)) return `presentation.glyph must be one of ${Object.keys(GLYPHS).join(', ')}, or { path } in a 16x16 box`;
  if (!has(LINES, p.line)) return `presentation.line must be one of ${Object.keys(LINES).join(', ')}`;
  if (p.measures !== undefined && (typeof p.measures !== 'string' || !keys.has(p.measures))) return 'presentation.measures must name a field';
  if (p.evidence !== undefined && (!Array.isArray(p.evidence) || p.evidence.some((k) => typeof k !== 'string' || !keys.has(k)))) return 'presentation.evidence must list field keys';
  // lenses differ by glyph and line only (spec 8.6), so two lenses drawing the same pair cannot be told apart
  const look = glyphKey(g);
  if (look !== null && opts.taken?.some((t) => t.line === p.line && glyphKey(t.glyph) === look)) {
    return `lens look ${typeof g === 'string' ? g : 'custom path'} + ${p.line} is already drawn by another lens; pick another glyph or line`;
  }

  return scanProblem(x.scan, metrics);
}

/** null when `s` is a scan block a scan can run over these metric fields; else what failed. */
function scanProblem(s: unknown, metrics: ReadonlySet<string>): string | null {
  const FORMS = "scan must be { method: 'judgement', instructions } or { method: 'steps', steps }";
  if (!isObj(s)) return FORMS;
  if (s.method === 'judgement') {
    if (!text(s.instructions)) return 'a judgement scan needs instructions';
    return only(s, ['method', 'instructions']) ? null : 'a judgement scan takes only method and instructions';
  }
  if (s.method !== 'steps') return FORMS;
  if (!only(s, ['method', 'steps'])) return 'a steps scan takes only method and steps';
  if (!Array.isArray(s.steps) || !s.steps.length || s.steps.length > MAX_STEPS) return `scan.steps must list 1 to ${MAX_STEPS} steps`;
  for (const [i, st] of (s.steps as unknown[]).entries()) {
    const at = `scan.steps[${i}]`;
    if (!isObj(st)) return `${at} must be an object`;
    if (st.kind === 'script') {
      if (!only(st, ['kind', 'run', 'yields'])) return `${at}: a script step takes only kind, run and yields`;
      if (!text(st.run)) return `${at}: a script step needs run`;
      if (!Array.isArray(st.yields) || !st.yields.length) return `${at}: a script step needs yields, the metric fields it fills`;
      const bad = st.yields.find((k) => typeof k !== 'string' || !metrics.has(k));
      if (bad !== undefined) return `${at} yields ${JSON.stringify(bad)}, which is not a numeric metric field`;
    } else if (st.kind === 'skill') {
      if (!only(st, ['kind', 'skill', 'args', 'budget'])) return `${at}: a skill step takes only kind, skill, args and budget`;
      if (typeof st.skill !== 'string' || !SKILLS.has(st.skill)) return `${at}: the skill must be one of ${[...SKILLS].join(', ')}`;
      if (st.args !== undefined && typeof st.args !== 'string') return `${at}: args must be a string`;
      if (st.budget !== undefined && !(Number.isInteger(st.budget) && (st.budget as number) >= 1 && (st.budget as number) <= MAX_BUDGET)) return `${at}: budget must be an integer 1 to ${MAX_BUDGET}`;
    } else if (st.kind === 'judgement') {
      if (!only(st, ['kind', 'instructions'])) return `${at}: a judgement step takes only kind and instructions`;
      if (!text(st.instructions)) return `${at}: a judgement step needs instructions`;
    } else return `${at}: kind must be script, skill or judgement`;
  }
  return null;
}

/** null when `x` is a temporary lens manifest the blueprint can write and a scan can measure; else what failed, one sentence. */
export function checkTempManifest(x: unknown): string | null {
  return checkLensManifest(x, { mode: 'temporary' });
}
