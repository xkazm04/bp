// Where the brain lives and what time it is there: companionHome()/brain with episodes/<yyyy-mm>, facts/<kind>,
// procedurals, spaces, cycles, the derivable index.sqlite and the sleep state. Every path is computed per call (tests move
// BP_HOME between cases), and the clock is one seam so a check can write a fact "100 days ago" without touching the disk.
import os from 'node:os';
import path from 'node:path';
import { companionHome } from '../home.server.ts';

if (typeof window !== 'undefined') throw new Error('paths.server.ts is server-only');

export const CORE = 'core';
export const FACT_KINDS = ['user', 'project', 'world'] as const;
const SPACE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** A space is 'core' or a product slug; anything else could escape the tree or the wall. */
export const validSpace = (s: unknown): s is string => typeof s === 'string' && SPACE.test(s) && !s.includes('..');

export const brainRoot = (): string => path.join(companionHome(), 'brain');
export const episodesDir = (): string => path.join(brainRoot(), 'episodes');
export const factsDir = (kind: string): string => path.join(brainRoot(), 'facts', kind);
export const proceduralsDir = (): string => path.join(brainRoot(), 'procedurals');
export const spacesDir = (): string => path.join(brainRoot(), 'spaces');
export const cyclesDir = (): string => path.join(brainRoot(), 'cycles');
export const indexPath = (): string => path.join(brainRoot(), 'index.sqlite');
export const sleepStatePath = (): string => path.join(brainRoot(), 'sleep.json');
export const sleepLockPath = (): string => path.join(brainRoot(), 'sleep.lock');

/** An episode id carries its month (e-YYYYMMDDTHHMMSS-xxxxxx), so its file is found without the index. */
export function episodePath(id: string): string | null {
  const m = /^e-(\d{4})(\d{2})\d{2}T\d{6}-[0-9a-f]{6}$/.exec(id);
  return m ? path.join(episodesDir(), `${m[1]}-${m[2]}`, `${id}.md`) : null;
}
export const factPath = (kind: string, id: string): string => kind === 'procedural' ? path.join(proceduralsDir(), `${id}.md`) : path.join(factsDir(kind), `${id}.md`);
export const spacePath = (slug: string): string => path.join(spacesDir(), `${slug}.md`);

let clock: (() => number) | null = null;
/** Test seam: pin the brain's clock (ms since epoch); null restores Date.now. */
export function setBrainClock(fn: (() => number) | null): void { clock = fn; }
export const nowMs = (): number => (clock ? clock() : Date.now());
export const nowIso = (): string => new Date(nowMs()).toISOString();
export const device = (): string => os.hostname();
export const DAY_MS = 86_400_000;
