// Whether a product repo can measure a lens at all, read from its lens-scan overlay (`.claude/lens-scan/config.md`) before a
// scan is started. Found 2026-10-25: a Grinex performance scan ran the CLI only for lens-scan to refuse ("the performance lens
// has nothing it can measure in this repo"), because every performance metric is a probe the overlay must name (`## Probes`)
// and lens-scan v1 has no bundle-stats parser. The scan menu now says so first and offers a prepare job that adjusts the repo
// instead (jobs.server.ts enqueuePrepare). Pure and client-safe: the server reads the overlay, the menu reads the verdict.
import type { LensEntry } from '../standard/types.ts';

/** The performance lens's probe metrics (lens-scan references/metrics.md#probes). */
export const PROBE_METRICS: readonly string[] = ['startupMs', 'interactionP95Ms', 'frameP95Ms', 'blockingMs', 'jankFrames', 'idleWakeups', 'memoryMb'];
/** Lenses lens-scan measures by its static scripts (footprint.mjs) in any repo: never a setup need. */
const STATIC_LENSES: readonly string[] = ['development', 'security', 'design'];
/** Lenses a prepare job knows how to make measurable (its prompt names the overlay section to add). */
export const PREPARABLE: readonly string[] = ['performance'];
/** The overlay, relative to the product root. */
export const OVERLAY_PATH = '.claude/lens-scan/config.md';

export interface Probe { feature: string; metric: string; command: string }
/** What a lens lacks in a repo: `probes` = the overlay names no `## Probes` entry, so lens-scan would refuse the scan. */
export interface LensSetupNeed { lens: string; need: 'probes'; why: string }

/** The overlay's `## Probes` entries, `<feature> <metric>: <command>` one per line (a heading of any level named Probes; the
 *  section runs to the next heading of that level or higher). Lines in a fence count (lens-scan's own docs fence overlay
 *  examples), a bullet marker and backticks round the pair are tolerated;
 *  a line naming no known metric is not an entry. */
export function parseProbes(overlay: string | null): Probe[] {
  if (!overlay) return [];
  const out: Probe[] = [];
  let level = 0, fence = false;
  for (const raw of overlay.replace(/\r/g, '').split('\n')) {
    const h = !fence && /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw);
    if (h) { level = /^probes$/i.test(h[2]) ? h[1].length : level && h[1].length <= level ? 0 : level; continue; }
    if (/^\s*```/.test(raw)) { fence = !fence; continue; }
    if (!level) continue;
    const m = /^\s*(?:[-*]\s+)?`?([a-z0-9][a-z0-9._-]*)\s+([A-Za-z0-9]+)`?\s*:\s*(\S.*)$/.exec(raw);
    if (m && PROBE_METRICS.includes(m[2])) out.push({ feature: m[1], metric: m[2], command: m[3].trim() });
  }
  return out;
}

/** null when lens-scan can measure `lensId` in a repo with this overlay (null text = no overlay file), else what it needs. A lens
 *  with a manifest scan block is measured by that block; a lens with neither a built-in method nor a block is not scannable at
 *  all (jobs.ts scannable), which is not a setup need. */
export function lensSetupNeed(lensId: string, manifest: Pick<LensEntry['manifest'], 'scan'> | undefined, overlay: string | null): LensSetupNeed | null {
  if (STATIC_LENSES.includes(lensId) || manifest?.scan?.method) return null;
  if (lensId !== 'performance') return null;
  if (parseProbes(overlay).length) return null;
  return {
    lens: lensId, need: 'probes',
    why: overlay === null
      ? `no lens-scan overlay (${OVERLAY_PATH}), so no probes: every performance metric is a probe the overlay must name`
      : `the overlay has no ## Probes entries: every performance metric is a probe it must name, and bundleKb has no parser yet`,
  };
}

/** A lens-scan refusal saying a lens has nothing to measure in the repo (its words, 2026-10-25). */
export const NOTHING_TO_MEASURE = /lens-scan refused:.*(?:nothing (?:it|to) (?:can )?measure|no (?:probes|method)|not measurable)/i;
