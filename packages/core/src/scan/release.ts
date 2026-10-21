// The release train's client-safe rules: the version a new release is suggested (lens-scan references/release.md,
// "Version suggestion"), and the release id pattern a route lets reach a job prompt. Pure, free of '@/' value
// imports (scripts/check-release-train.ts runs it on Node). The git and manifest reads behind a suggestion are
// release.server.ts.
import type { Proposal, VersionSuggestion } from './types.ts';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
/** store.mjs's --version rule: semver without the v. */
export const isVersion = (v: unknown): v is string => typeof v === 'string' && SEMVER.test(v);
/** A release id (`rel-<version>`) that may reach a job prompt. */
export const RELEASE_ID = /^rel-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** The bump the items call for: any baseline-upgrade, or a body line `capability: new`, is minor; else patch. Major is a person's call. */
export function bumpOf(items: readonly Pick<Proposal, 'kind' | 'body'>[]): 'minor' | 'patch' {
  return items.some((p) => p.kind === 'baseline-upgrade' || /^capability:\s*new\s*$/im.test(p.body ?? '')) ? 'minor' : 'patch';
}

/** `x.y.z` bumped; a pre-release or build suffix is dropped. */
export function bump(v: string, by: 'minor' | 'patch'): string {
  const m = SEMVER.exec(v);
  if (!m) return v;
  return by === 'minor' ? `${m[1]}.${Number(m[2]) + 1}.0` : `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/**
 * The suggestion: from the latest `v*` tag (the first of `git tag --list 'v*' --sort=-v:refname` that is semver), bumped
 * by the accepted items with no release; with no tag, the manifest's version as it stands; else 0.1.0.
 * `tags` is that git output's lines; `manifest` is the first manifest version found and the file it came from. A version
 * the store already has a release for (`taken`, not tagged yet) is passed over: the next patch is suggested.
 */
export function suggestVersion(tags: readonly string[], manifest: { version: string; file: string } | undefined, items: readonly Pick<Proposal, 'kind' | 'body'>[], taken: ReadonlySet<string> = new Set()): VersionSuggestion {
  const s = suggestRaw(tags, manifest, items);
  let v = s.version, n = 0;
  while (taken.has(v) && n++ < 100) v = bump(v, 'patch');
  // The cap ran out with the version still taken: say so rather than name a taken version as the one that avoided it.
  if (taken.has(v)) return { ...s, reason: `${s.reason}; no free version found: ${s.version} and the ${n - 1} patch versions after it already have a release, so the version needs a person` };
  return v === s.version ? s : { ...s, version: v, reason: `${s.reason}; ${s.version} already has a release, so ${v}` };
}
function suggestRaw(tags: readonly string[], manifest: { version: string; file: string } | undefined, items: readonly Pick<Proposal, 'kind' | 'body'>[]): VersionSuggestion {
  const tag = tags.map((t) => t.trim()).find((t) => /^v/.test(t) && isVersion(t.slice(1)));
  if (tag) {
    const by = bumpOf(items), n = items.length;
    const why = !n ? 'no accepted items wait for a release yet' : by === 'minor' ? `${n} accepted item${n === 1 ? '' : 's'}, a baseline upgrade or a new capability among them` : `${n} accepted item${n === 1 ? '' : 's'}, no baseline upgrade or new capability`;
    return { version: bump(tag.slice(1), by), from: tag, reason: `${why}: ${by} bump from ${tag}` };
  }
  if (manifest && isVersion(manifest.version)) return { version: manifest.version, from: manifest.file, reason: `no v* tag yet: the version ${manifest.file} states` };
  return { version: '0.1.0', from: 'none', reason: 'no v* tag and no manifest version' };
}
