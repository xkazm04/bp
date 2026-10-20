// The features a scan run was pointed at. Pure and import-free, so Node checks (timeline/check-run.ts, check-scan-wire.ts) load it as-is.

interface ScopeFeat { id?: string; domain: string; capability: string }

/** `scope.domain` / `scope.capability` / `scope.group` matching a feature's domain or capability (by value, case-blind),
 *  and `scope.features` (feature ids, as a blueprint-started scan writes them) matching a feature's id; else every
 *  feature. A scope that matches nothing is not trusted: all features. */
export function scopeFeatures<F extends ScopeFeat>(run: { scope?: Record<string, unknown> }, features: readonly F[]): readonly F[] {
  const sc = run.scope;
  if (!sc) return features;
  const want = [sc.domain, sc.capability, sc.group].filter((v): v is string => typeof v === 'string' && v !== '').map((v) => v.toLowerCase());
  const ids = new Set(Array.isArray(sc.features) ? sc.features.filter((v): v is string => typeof v === 'string' && v !== '') : []);
  if (!want.length && !ids.size) return features;
  const hit = features.filter((f) => (f.id !== undefined && ids.has(f.id)) || want.includes(f.domain.toLowerCase()) || want.includes(f.capability.toLowerCase()));
  return hit.length ? hit : features;
}
