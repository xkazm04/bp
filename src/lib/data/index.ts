// The app's data entry: the types and the loader for any product's map (the standard's, see
// src/lib/standard/load.ts). A live product's map comes from its route and goes through `loadMap`. The
// Kettle sample (map, events, swarm) is in ./sample and is never imported from here: this module is on
// every page's path, the sample's JSON must not be.
import { BUILTIN_LENSES } from '@/lib/standard/catalog';
import { loadStructure } from '@/lib/standard/load';
import type { Structure } from './types';

export * from './types';

/** Any product's map and events log (a live product's, from its route), read the way Kettle's is. */
export function loadMap(map: unknown, events: string | null, lenses?: string | null): Structure {
  return loadStructure(map, events, { catalog: BUILTIN_LENSES, lenses: lenses ?? null });
}
