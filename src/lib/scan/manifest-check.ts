// The structural check a temporary lens manifest passes before the blueprint writes it into a map (POST
// /lenses) or offers it from the onboarding chat (POST /api/lens-draft). Not the schema (ajv is a dev
// dependency only): the subset that decides whether the lens can be drawn and scanned. The full rules stay
// with scripts/validate-structure.mjs. Pure and import-free at runtime, so Node checks load it as-is.
import type { ComputedHealth, Density, FieldType, GlyphName, LineName, MetricMethod } from '@/lib/standard/types';
import { TEMP_LENS_ID } from './jobs.ts';

// Records, not lists: a name added to the type without one here fails the typecheck.
const GLYPHS: Record<GlyphName, 1> = { bars: 1, 'set-square': 1, brackets: 1, pulse: 1, padlock: 1, check: 1 };
const LINES: Record<LineName, 1> = { solid: 1, double: 1, dotted: 1, comb: 1, chain: 1, hatched: 1, dimension: 1 };
const DENSITY: Record<Density, 1> = { simple: 1, standard: 1, dense: 1 };
const TYPES: Record<FieldType, 1> = { number: 1, integer: 1, percent: 1, money: 1, boolean: 1, string: 1, enum: 1, date: 1 };
const NUMERIC: Partial<Record<FieldType, 1>> = { number: 1, integer: 1, percent: 1, money: 1 };
const HEALTH: Record<ComputedHealth, 1> = { good: 1, watch: 1, bad: 1 };
const METHODS: Record<MetricMethod, 1> = { static: 1, probe: 1, harness: 1, judgement: 1 };
const TOP = new Set(['$schema', 'id', 'version', 'name', 'short', 'description', 'reader', 'fields', 'health', 'presentation', 'scan']);
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, KEY = /^[a-z][A-Za-z0-9]*$/, SHORT = /^[A-Z0-9]{2,4}$/;
const PATH_OK = /^[Mm][MmZzLlHhVvCcSsQqTtAa0-9eE.,+\- ]{0,2047}$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (r: Record<string, 1> | Partial<Record<string, 1>>, v: unknown): boolean => typeof v === 'string' && Object.hasOwn(r, v);
const text = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';

/** The field keys a condition names (so a rule over an unknown field is caught). */
function condFields(c: unknown, out: string[]): string[] {
  if (!isObj(c)) return out;
  for (const k of ['all', 'any'] as const) if (Array.isArray(c[k])) for (const x of c[k] as unknown[]) condFields(x, out);
  if (c.not !== undefined) condFields(c.not, out);
  if (typeof c.field === 'string') out.push(c.field);
  return out;
}

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
 * S0 STUB: WP1 implements the project mode, steps, the path-box check and the taken-look refusal.
 */
export function checkLensManifest(x: unknown, opts: CheckLensOptions): string | null {
  void opts;
  return checkTempManifest(x);
}

/** null when `x` is a temporary lens manifest the blueprint can write and a scan can measure; else what failed, one sentence. */
export function checkTempManifest(x: unknown): string | null {
  if (!isObj(x)) return 'the manifest must be a JSON object';
  const extra = Object.keys(x).filter((k) => !TOP.has(k));
  if (extra.length) return `unknown keys: ${extra.join(', ')}`;
  if (x.$schema !== 'lens-manifest/1') return '$schema must be "lens-manifest/1"';
  if (typeof x.id !== 'string' || !TEMP_LENS_ID.test(x.id)) return `id must be tmp.<kebab> (got ${JSON.stringify(x.id)})`;
  if (typeof x.version !== 'string' || !SEMVER.test(x.version)) return 'version must be semver, e.g. 1.0.0';
  if (!text(x.name)) return 'name is required';
  if (x.short !== undefined && (typeof x.short !== 'string' || !SHORT.test(x.short))) return 'short must be 2-4 capital letters or digits';
  if (x.description !== undefined && typeof x.description !== 'string') return 'description must be a string';
  if (!isObj(x.reader) || !has(DENSITY, x.reader.density)) return 'reader.density must be simple, standard or dense';
  if (x.reader.role !== undefined && typeof x.reader.role !== 'string') return 'reader.role must be a string';

  if (!Array.isArray(x.fields) || !x.fields.length) return 'fields must list at least one field';
  const keys = new Set<string>(), numeric = new Set<string>();
  let metrics = 0;
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
      metrics++;
    }
  }
  if (!metrics) return 'at least one numeric field needs a metric block, or the scan has nothing to fill';

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
  if (!(has(GLYPHS, g) || (isObj(g) && typeof g.path === 'string' && PATH_OK.test(g.path)))) return `presentation.glyph must be one of ${Object.keys(GLYPHS).join(', ')}`;
  if (!has(LINES, p.line)) return `presentation.line must be one of ${Object.keys(LINES).join(', ')}`;
  if (p.measures !== undefined && (typeof p.measures !== 'string' || !keys.has(p.measures))) return 'presentation.measures must name a field';
  if (p.evidence !== undefined && (!Array.isArray(p.evidence) || p.evidence.some((k) => typeof k !== 'string' || !keys.has(k)))) return 'presentation.evidence must list field keys';

  const s = x.scan;
  if (!isObj(s) || s.method !== 'judgement' || !text(s.instructions)) return "scan must be { method: 'judgement', instructions } with instructions";
  if (Object.keys(s).some((k) => k !== 'method' && k !== 'instructions')) return 'scan takes only method and instructions';
  return null;
}
