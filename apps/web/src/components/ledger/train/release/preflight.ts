// The Release tab's pre-flight: what will refuse or fail, said before Build is pressed. Pure: the release, its package
// items (releaseState.ts evidenceOf: verdict and flag) and the probe's answer (actions.ts preflightRelease: the build
// route's dry run, or the sample's) map to a list of checks the view renders as data. A `block` takes Build and Retry out
// of the available actions (`gated`), so the button and the B key both start nothing while one stands; a `warn` is said
// and never blocks. Which statuses are pre-flighted is RELEASE_STATE's data (the ones that offer a build), not a list of ids.
//   commit-less items  block: lens-scan release.md - an item whose commit_sha is missing cannot ship, the run fails the
//                      release naming it; an empty package blocks too (nothing to cut)
//   flagged items      warn, with their triage notes (they ship flagged)
//   unmeasured items   warn (the notes will say "unmeasured")
//   the probe          ready -> ok; 412 -> block worded as the fix; any other refusal the build would give (409 state or
//                      busy, 429 queue full) -> block in the route's words; a probe that could not be asked -> warn
import type { Release } from '@bp/core/scan/types';
import type { ReleaseReady } from '@/lib/scan/actions';
import { RELEASE_STATE, type PkgItem, type RelAction } from './releaseState';

export type Verdict = 'block' | 'warn' | 'ok';
export interface PreCheck { id: string; verdict: Verdict; words: string }
/** The probe's answer: ready, a refusal (`status` when the route or sim answered one, `text` in words), or null while
 *  it has not answered (a pending probe never holds Build). */
export type Probe = ReleaseReady | { status?: number; text: string } | null;

const BUILDS: readonly RelAction[] = ['build', 'retry'];
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** Whether a release is pre-flighted at all: its status offers a build (draft, failed - RELEASE_STATE's data). */
export const preflighted = (rel: Pick<Release, 'status'> | undefined): boolean => !!rel && RELEASE_STATE[rel.status].actions.some((a) => BUILDS.includes(a));

export function preflightOf(rel: Pick<Release, 'status' | 'version'> | undefined, items: readonly PkgItem[], probe: Probe): PreCheck[] {
  if (!rel || !preflighted(rel)) return [];
  const out: PreCheck[] = [];
  if (!items.length) out.push({ id: 'empty', verdict: 'block', words: 'The package is empty: accept an item before building.' });
  const noSha = items.filter((x) => !x.p.commit_sha);
  if (noSha.length) {
    out.push({ id: 'no-commit', verdict: 'block', words: `${plural(noSha.length, 'item has', 'items have')} no commit and cannot ship: ${noSha.map((x) => `"${x.p.title}"`).join(', ')}. Rework or descope ${noSha.length === 1 ? 'it' : 'them'}; the run would fail the release.` });
  }
  const flagged = items.filter((x) => x.flagged);
  if (flagged.length) {
    const notes = flagged.map((x) => `"${x.p.title}"${x.p.triage_note ? ' - ' + x.p.triage_note : ''}`).join('; ');
    out.push({ id: 'flagged', verdict: 'warn', words: `${flagged.length} ship flagged: ${notes}` });
  }
  const unmeasured = items.filter((x) => x.verdict === 'unmeasured').length;
  if (unmeasured) out.push({ id: 'unmeasured', verdict: 'warn', words: `${unmeasured} unmeasured: the notes say so instead of a before → after.` });
  if (probe && 'ready' in probe) {
    out.push({ id: 'probe', verdict: 'ok', words: probe.gh === 'unchecked' ? 'Ready to start: the release and the job queue allow it; gh login is checked when the build starts.' : 'Ready to start: gh is signed in and nothing else is running for this release.' });
  } else if (probe) {
    if (probe.status === 412) out.push({ id: 'probe', verdict: 'block', words: 'gh is not signed in: run gh auth login in a terminal.' });
    else if (probe.status === 409 || probe.status === 429) out.push({ id: 'probe', verdict: 'block', words: `The build would be refused: ${probe.text}` });
    else out.push({ id: 'probe', verdict: 'warn', words: `Could not check ahead: ${probe.text}` });
  }
  return out;
}

/** The first blocker's words, or undefined when nothing blocks. */
export const firstBlock = (checks: readonly PreCheck[]): string | undefined => checks.find((c) => c.verdict === 'block')?.words;

/** The available actions with Build and Retry removed while any check blocks (the button and the B key read this list). */
export const gated = (available: readonly RelAction[], checks: readonly PreCheck[]): RelAction[] =>
  firstBlock(checks) === undefined ? [...available] : available.filter((a) => !BUILDS.includes(a));
