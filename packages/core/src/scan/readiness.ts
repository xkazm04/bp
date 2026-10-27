// How ready a registered product repo is to be drawn: the files under `<root>/.ai/lens-scan/` and what
// they hold. The server computes it (readiness.server.ts, one per product in `GET /api/products`); this
// file is pure and shared, so the project switcher and the manage dialog read the same verdict.

export interface Readiness {
  /** The repo root exists and is a directory. */
  rootExists: boolean;
  /** `app-structure.json` exists and parses as a JSON object. */
  map: boolean;
  /** 3 = app-structure v3 (`$schema: app-structure/3` or `version: 3`), 2 = a v2 context map, null = none or unknown. */
  mapVersion: 2 | 3 | null;
  /** `events.jsonl` exists (the revisions strip; optional). */
  events: boolean;
  /** `scan.db` exists. */
  store: boolean;
  /** Features in the map. */
  features: number;
  /** Enabled lenses in the map. */
  lenses: number;
  /** Distinct (feature, lens, metric) readings in the store. */
  measuredFacets: number;
  /** Open proposals (status `proposed`) in the store; null without a readable store. */
  proposals: number | null;
  /** When the latest run ended (or last moved, while running); null without one. */
  lastRunAt: string | null;
  /** Why the map or the store could not be read, when one exists and could not. */
  error?: string;
}

export type ReadinessLevel = 'missing' | 'map-only' | 'measured' | 'full';

/**
 * missing  = no repo, or no readable map: the product cannot be drawn.
 * map-only = the map draws, nothing is measured yet (no store, or a store without readings).
 * measured = the map and at least one reading.
 * full     = measured, plus the events log (the revisions strip has history).
 */
export function readinessLevel(r: Readiness): ReadinessLevel {
  if (!r.rootExists || !r.map) return 'missing';
  if (!r.store || r.measuredFacets === 0) return 'map-only';
  return r.events ? 'full' : 'measured';
}

export const LEVEL_LABEL: Record<ReadinessLevel, string> = {
  missing: 'No map',
  'map-only': 'Map only',
  measured: 'Measured',
  full: 'Full',
};

export const LEVEL_TITLE: Record<ReadinessLevel, string> = {
  missing: 'Cannot be drawn: the repo or its .ai/lens-scan/app-structure.json is missing',
  'map-only': 'The map draws; nothing is measured yet',
  measured: 'The map draws with lens-scan readings',
  full: 'Map, readings and the events log',
};

/** A slug in `bp.products.local.json`: lower-case words and digits joined by hyphens. `kettle` is the built-in sample. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const RESERVED_SLUGS: readonly string[] = ['kettle'];
