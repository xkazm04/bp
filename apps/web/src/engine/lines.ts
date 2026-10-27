// Product lines. `?scale=N` stamps N copies of the map side by side, each feature id carrying its line's
// suffix ('-S' for Studios, '-G' for Gyms, ... from LINES in @bp/core/model). Anything that takes one
// feature id and wants the same place on every line has to strip whichever suffix it arrived with - not
// line one's - or it builds ids like `sign-in-G-S`, which exist nowhere.
//
// No imports and no DOM, so scripts/check-engine-lines.ts executes it: the caller passes the suffixes.

/** Every line's copy of `fid`, in line order, whichever line's copy came in. `suffixes` is empty at scale 1. */
export function lineSiblings(fid: string, suffixes: readonly string[]): string[] {
  if (!suffixes.length) return [fid];
  // longest first, so '-SG' can never be eaten by '-G' if a future line pair ever shares a tail
  const hit = [...suffixes].sort((a, b) => b.length - a.length).find((s) => fid.endsWith(s));
  const base = hit ? fid.slice(0, -hit.length) : fid;
  return suffixes.map((s) => base + s);
}
