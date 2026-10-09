// Lenses as data: everything the UI says about a lens comes from its manifest (the registry is the
// map's enabled `lenses[]`). Sheets (tabs), field formatting by type and unit, evidence parts, and
// place aggregates (rollup per manifest + counts + a headline summary). Pure; no DOM.
import type { Feature, FeatureLens, Health, LensDef, Scalar, ViewId } from '@/lib/data';
import type { LensField } from '@/lib/standard/types';
import { rollupHealth, type RollupItem } from '@/lib/standard/health';
import { EVIDENCE_BY_DENSITY } from '@/lib/standard/present';
import { GENERAL_SHEET, type SheetMeta } from './constants';
import type { Product } from './product';

// ------------------------------------------------------------------------------------- sheets
/** The registry lens behind a view, or null for General (and for ids that are not enabled). */
export function lensOf(P: Product, v: ViewId | null | undefined): LensDef | null {
  if (!v || v === 'general') return null;
  const d = P.LENS[v];
  return d && d.i >= 0 ? d : null;
}
/** Every view in tab order: General, then the enabled lenses in file order. */
export function views(P: Product): ViewId[] { return ['general', ...P.lenses.map((l) => l.id)]; }
export function isView(P: Product, v: string | null | undefined): v is ViewId { return v === 'general' || !!lensOf(P, v); }

const SHEETS = new WeakMap<Product, Map<string, SheetMeta>>();
/** Sheet meta for a view (tab number, name, title). An unknown or disabled lens id reads as General. */
export function sheetOf(P: Product, v: ViewId | null | undefined): SheetMeta {
  const d = lensOf(P, v);
  if (!d) return GENERAL_SHEET;
  let m = SHEETS.get(P); if (!m) SHEETS.set(P, (m = new Map()));
  let s = m.get(d.id);
  if (!s) { s = { k: d.id, no: d.short, nm: d.name, title: d.name + (d.role && d.role !== d.id ? ' · ' + d.role : ''), sub: d.description }; m.set(d.id, s); }
  return s;
}
/** The lens a person reads by default: their `field`, when it names an enabled lens. */
export function personLens(P: Product, who: string | null | undefined): ViewId | null {
  const p = who ? P.P[who] : null;
  return p && lensOf(P, p.field) ? p.field : null;
}

// ------------------------------------------------------------------------------------ fields
const shortLabel = (f: LensField) => f.label.replace(/\s*\([^)]*\)/g, '');
const round = (v: number) => (Math.abs(v) >= 100 || Number.isInteger(v) ? Math.round(v) : Math.round(v * 10) / 10);
function money(f: LensField, v: number): string {
  const n = Math.round(v).toLocaleString('en-US');
  return f.type === 'money' && f.currency === 'USD' ? '$' + n : n + (f.type === 'money' ? ' ' + f.currency : '');
}

/** A value for reading (sheet rows, hover): by type and unit. Absent = '—'. */
export function fmtValue(f: LensField, v: Scalar | undefined | null): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string') return v;
  switch (f.type) {
    case 'percent': return round(v) + '%';
    case 'money': return money(f, v) + (f.unit ? ' ' + f.unit : '');
    default: return round(v).toLocaleString('en-US') + (f.unit ? ' ' + f.unit : '');
  }
}

/** A value as a short evidence part for a tile header (mono, uppercase). */
export function fieldPart(f: LensField, v: Scalar | undefined | null): string {
  const L = shortLabel(f).toUpperCase();
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? L : 'NO ' + L;
  if (typeof v === 'string') return f.type === 'date' ? L + ' ' + v.slice(5) : v.replace(/-/g, ' ').toUpperCase();
  if (f.type === 'percent') return L + ' ' + round(v) + '%';
  if (f.type === 'money') return L + ' ' + money(f, v);
  return L + ' ' + round(v).toLocaleString('en-US') + (f.unit ? f.unit.toUpperCase() : '');
}

/** The evidence fields a reader of this lens sees, in order, limited by its density (spec 8.6). */
export function evidenceFields(d: LensDef): readonly LensField[] {
  return d.evidence.slice(0, EVIDENCE_BY_DENSITY[d.density]);
}

/** Where current values come from: the engine's live view (the simulation moves a few fields). */
export interface ValueSource { value(lens: string, key: string): Scalar | undefined }

/** The words a tile says under a lens: evidence parts; the stamp is the reason when the lens is unwell. */
export function lensContent(d: LensDef, fl: FeatureLens | undefined, src: ValueSource): { parts: string[]; stamp?: string } {
  if (!fl) return { parts: [] };
  const parts: string[] = [];
  for (const f of evidenceFields(d)) { const p = fieldPart(f, src.value(d.id, f.key)); if (p) parts.push(p); }
  if (!parts.length) return { parts: [fl.h === 'na' ? 'NOT APPLICABLE' : fl.h === 'unmeasured' ? 'NOT MEASURED' : HEALTH_WORD[fl.h].toUpperCase()] };
  return { parts, stamp: fl.h === 'bad' || fl.h === 'watch' ? (fl.ov ? fl.ov.why : fl.why ?? undefined) : undefined };
}

/** Plain words for a lens's health. */
export const HEALTH_WORD: Record<Health, string> = { good: 'good', watch: 'needs watching', bad: 'in trouble', na: 'not applicable', unmeasured: 'not measured' };

// -------------------------------------------------------------------------------- aggregates
/** The headline field summed up over a place: total money, mean of a scale or rate, a count of the top enum value. */
export function headlineSummary(d: LensDef, fs: readonly Feature[]): string {
  const f = d.headline; if (!f) return '';
  let n = 0, sum = 0, hits = 0;
  const top = f.type === 'enum' ? f.values[f.values.length - 1] : null;
  for (const g of fs) {
    const v = g.lens[d.id]?.v[f.key];
    if (v === undefined) continue;
    n++;
    if (typeof v === 'number') sum += v;
    else if (v === true || (top !== null && v === top)) hits++;
  }
  if (!n) return '';
  const label = shortLabel(f).toLowerCase();
  if (f.type === 'money') return money(f, sum) + ' ' + label;
  if (f.type === 'enum') return hits + ' ' + top;
  if (f.type === 'boolean') return hits + ' ' + label;
  if (f.type === 'percent' || f.type === 'number' || (f.type === 'integer' && f.max !== undefined)) {
    const avg = sum / n;
    return label + ' avg ' + (f.type === 'percent' ? Math.round(avg) + '%' : round(Math.round(avg * 10) / 10));
  }
  if (f.type === 'integer') return sum.toLocaleString('en-US') + ' ' + label;
  return '';
}

/**
 * What a place (room, wing, building) says under a lens: the rollup per the manifest's `health.rollup`,
 * the bad and watch counts, and the headline summary. `trouble` = the bad count.
 */
export function lensAggregate(d: LensDef, fs: readonly Feature[]): { parts: string[]; trouble: number; health: Health } {
  let bad = 0, watch = 0;
  const items: RollupItem[] = [];
  const weighted = d.rollup.method === 'weighted';
  for (const f of fs) {
    const fl = f.lens[d.id]; if (!fl) continue;
    if (fl.h === 'bad') bad++; else if (fl.h === 'watch') watch++;
    items.push(weighted ? { health: fl.h, values: fl.v } : fl.h);
  }
  const health = rollupHealth(d.manifest, items);
  const parts = [HEALTH_WORD[health]];
  if (bad) parts.push(bad + ' bad');
  if (watch) parts.push(watch + ' to watch');
  const hs = headlineSummary(d, fs); if (hs) parts.push(hs);
  return { parts, trouble: bad, health };
}
