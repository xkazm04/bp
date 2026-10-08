// App Blueprint model: the derivations every prototype shares (indexes, scores, rollups, filters).
// Classic script, load after blueprint-data.js. Reads window.BLUEPRINT, never mutates it, assigns window.BP.
// API reference: docs/data-model.md ("window.BP model API").
(function () {
  'use strict';

  const data = window.BLUEPRINT;
  if (!data || !Array.isArray(data.features)) {
    throw new Error('blueprint-model.js: window.BLUEPRINT is missing. Load blueprint-data.js first.');
  }

  const STATUS_ORDER = ['live', 'ready', 'building', 'planned', 'blocked'];
  const REVIEW_ORDER = ['approved', 'pending', 'changes', 'none'];
  const BUILDER_ORDER = ['agent', 'pair', 'human'];
  const LENSES = ['overall', 'dev', 'ops', 'biz'];

  const DIMENSIONS = data.dimensions || [];
  const STATUSES = data.statuses || [];
  const FACET_STATES = data.facetStates || [];
  const DIM_IDS = DIMENSIONS.map((d) => d.id);

  // ── Indexes ────────────────────────────────────────────────────────────────────────────────

  /** Builds an id → item Map for a list. */
  function indexById(list) {
    const map = new Map();
    (list || []).forEach((item) => map.set(item.id, item));
    return map;
  }

  /** Groups a list into key → items, keeping display order inside each group. */
  function groupBy(list, key) {
    const map = new Map();
    (list || []).forEach((item) => {
      const k = item[key];
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(item);
    });
    return map;
  }

  const domainById = indexById(data.domains);
  const moduleById = indexById(data.modules);
  const featureById = indexById(data.features);
  const teamById = indexById(data.teams);
  const releaseById = indexById(data.releases);
  const stateValue = new Map(FACET_STATES.map((s) => [s.id, s.value]));

  const modulesByDomain = groupBy(data.modules, 'domainId');
  const featuresByModule = groupBy(data.features, 'moduleId');
  const featuresByDomain = new Map();
  (data.domains || []).forEach((d) => {
    const list = [];
    (modulesByDomain.get(d.id) || []).forEach((m) => list.push.apply(list, featuresByModule.get(m.id) || []));
    featuresByDomain.set(d.id, list);
  });

  const dependentsById = new Map();
  data.features.forEach((f) => {
    (f.dependsOn || []).forEach((depId) => {
      if (!dependentsById.has(depId)) dependentsById.set(depId, []);
      dependentsById.get(depId).push(f);
    });
  });

  // ── Helpers ────────────────────────────────────────────────────────────────────────────────

  /** Resolves a feature object or feature id to the feature object (null when unknown). */
  function asFeature(featureOrId) {
    if (featureOrId == null) return null;
    if (typeof featureOrId === 'string') return featureById.get(featureOrId.trim()) || null;
    return featureOrId;
  }

  /** Resolves a list of features or ids, dropping unknown entries. */
  function asFeatureList(list) {
    if (list == null) return [];
    const arr = Array.isArray(list) ? list : Array.from(list);
    return arr.map(asFeature).filter(Boolean);
  }

  /** Map lookup that trims string ids and returns null when missing. */
  function lookup(map, id) {
    if (id == null) return null;
    return map.get(typeof id === 'string' ? id.trim() : id) || null;
  }

  /** Arithmetic mean of the non-null numbers in a list, or null when there are none. */
  function mean(values) {
    let sum = 0;
    let n = 0;
    values.forEach((v) => {
      if (typeof v === 'number' && !isNaN(v)) {
        sum += v;
        n += 1;
      }
    });
    return n ? sum / n : null;
  }

  /** Returns an object with every id in `ids` set to 0. */
  function zeroCounts(ids) {
    const out = {};
    ids.forEach((id) => {
      out[id] = 0;
    });
    return out;
  }

  /** Deep-freezes a plain derived object (never the source data) so cached results stay intact. */
  function freezeDeep(obj) {
    Object.values(obj).forEach((v) => {
      if (v && typeof v === 'object' && !Object.isFrozen(v)) freezeDeep(v);
    });
    return Object.freeze(obj);
  }

  /**
   * Normalizes text for forgiving matching: lower case, accents stripped, "&" read as "and",
   * id punctuation (- _ . /) read as spaces, whitespace collapsed and trimmed.
   */
  function normalizeText(text) {
    return String(text == null ? '' : text)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[-_./]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** True when `set` (Set, array, single value, or empty/missing for "any") admits `value`. */
  function admits(set, value) {
    if (set == null) return true;
    if (typeof set === 'string') return set.trim() === '' || set.trim() === value;
    if (Array.isArray(set)) return set.length === 0 || set.indexOf(value) >= 0;
    if (typeof set.has === 'function' && typeof set.size === 'number') return set.size === 0 || set.has(value);
    return true;
  }

  // ── Scores ─────────────────────────────────────────────────────────────────────────────────

  /** Facet state → numeric value: done 1, partial 0.5, todo 0, blocked 0, na (or unknown) null. */
  function facetValue(state) {
    const v = stateValue.get(state);
    return typeof v === 'number' ? v : null;
  }

  const scoreCache = new WeakMap();

  /** Computes and caches { dev, ops, biz, overall } for one feature object. */
  function scoresOf(feature) {
    let cached = scoreCache.get(feature);
    if (cached) return cached;
    cached = {};
    DIMENSIONS.forEach((dim) => {
      const facets = (feature.dims && feature.dims[dim.id]) || {};
      cached[dim.id] = mean(dim.facets.map((fc) => facetValue(facets[fc.id])));
    });
    cached.overall = mean(DIM_IDS.map((id) => cached[id]));
    scoreCache.set(feature, cached);
    return cached;
  }

  /** 0..1 score of one dimension: mean of its non-na facets (null only if every facet is na). */
  function dimScore(feature, dimId) {
    const f = asFeature(feature);
    if (!f) return null;
    const scores = scoresOf(f);
    return Object.prototype.hasOwnProperty.call(scores, dimId) && dimId !== 'overall' ? scores[dimId] : null;
  }

  /** 0..1 feature score: mean of the dev, ops and biz dimension scores. */
  function featureScore(feature) {
    const f = asFeature(feature);
    return f ? scoresOf(f).overall : null;
  }

  /** The 0..1 value a view encodes for a lens: 'overall' | 'dev' | 'ops' | 'biz' (unknown → overall). */
  function lensValue(feature, lens) {
    const key = typeof lens === 'string' ? lens.trim().toLowerCase() : 'overall';
    return key !== 'overall' && DIM_IDS.indexOf(key) >= 0 ? dimScore(feature, key) : featureScore(feature);
  }

  /** True when the feature is blocked, has any blocked facet, or its latest review asks for changes. */
  function needsAttention(feature) {
    const f = asFeature(feature);
    if (!f) return false;
    if (f.status === 'blocked' || f.review === 'changes') return true;
    return DIM_IDS.some((id) => {
      const facets = (f.dims && f.dims[id]) || {};
      return Object.keys(facets).some((k) => facets[k] === 'blocked');
    });
  }

  // ── Rollups ────────────────────────────────────────────────────────────────────────────────

  /**
   * Aggregates a feature list: { count, byStatus, dims: { dev, ops, biz }, overall, attention, byReview, byBuilder }.
   * Scores are means of per-feature scores (0 for an empty list). Accepts feature objects or ids.
   */
  function rollup(features) {
    const list = asFeatureList(features);
    const byStatus = zeroCounts(STATUS_ORDER);
    const byReview = zeroCounts(REVIEW_ORDER);
    const byBuilder = zeroCounts(BUILDER_ORDER);
    const dimValues = {};
    DIM_IDS.forEach((id) => {
      dimValues[id] = [];
    });
    const overallValues = [];
    let attention = 0;

    list.forEach((f) => {
      byStatus[f.status] = (byStatus[f.status] || 0) + 1;
      byReview[f.review] = (byReview[f.review] || 0) + 1;
      byBuilder[f.builtBy] = (byBuilder[f.builtBy] || 0) + 1;
      const s = scoresOf(f);
      DIM_IDS.forEach((id) => dimValues[id].push(s[id]));
      overallValues.push(s.overall);
      if (needsAttention(f)) attention += 1;
    });

    const dims = {};
    DIM_IDS.forEach((id) => {
      const m = mean(dimValues[id]);
      dims[id] = m == null ? 0 : m;
    });
    const overall = mean(overallValues);
    return { count: list.length, byStatus, dims, overall: overall == null ? 0 : overall, attention, byReview, byBuilder };
  }

  const rollupCache = new Map();

  /** Memoizes a rollup under `key`; cached results are frozen so callers cannot corrupt them. */
  function cachedRollup(key, getFeatures) {
    if (!rollupCache.has(key)) rollupCache.set(key, freezeDeep(rollup(getFeatures())));
    return rollupCache.get(key);
  }

  /** Memoized rollup of one module's features. */
  function moduleRollup(id) {
    const m = lookup(moduleById, id);
    return cachedRollup('module:' + (m ? m.id : id), () => (m ? featuresByModule.get(m.id) || [] : []));
  }

  /** Memoized rollup of every feature in one domain. */
  function domainRollup(id) {
    const d = lookup(domainById, id);
    return cachedRollup('domain:' + (d ? d.id : id), () => (d ? featuresByDomain.get(d.id) || [] : []));
  }

  /** Memoized rollup of the whole product. */
  function productRollup() {
    return cachedRollup('product', () => data.features);
  }

  /** Counts facet states across features ({ done, partial, todo, blocked, na, total }), for all dims or one. */
  function facetCounts(features, dimId) {
    const counts = zeroCounts(FACET_STATES.map((s) => s.id));
    counts.total = 0;
    const dimIds = dimId ? DIM_IDS.filter((id) => id === dimId) : DIM_IDS;
    asFeatureList(features).forEach((f) => {
      dimIds.forEach((id) => {
        const facets = (f.dims && f.dims[id]) || {};
        Object.keys(facets).forEach((k) => {
          counts[facets[k]] = (counts[facets[k]] || 0) + 1;
          counts.total += 1;
        });
      });
    });
    return counts;
  }

  // ── Graph ──────────────────────────────────────────────────────────────────────────────────

  /** Features this feature depends on (accepts a feature or id). */
  function dependencies(id) {
    const f = asFeature(id);
    return f ? (f.dependsOn || []).map((dep) => featureById.get(dep)).filter(Boolean) : [];
  }

  /** Features that depend on this feature (accepts a feature or id). */
  function dependents(id) {
    const f = asFeature(id);
    return f ? (dependentsById.get(f.id) || []).slice() : [];
  }

  // ── Search and filters ─────────────────────────────────────────────────────────────────────

  const haystackCache = new WeakMap();

  /** Normalized text a feature is searched by: name, summary, id, module and domain names and codes. */
  function haystackOf(f) {
    let text = haystackCache.get(f);
    if (text == null) {
      const m = moduleById.get(f.moduleId) || {};
      const d = domainById.get(m.domainId) || {};
      text = normalizeText([f.name, f.summary, f.id, m.name, m.code, d.name, d.code].join(' '));
      haystackCache.set(f, text);
    }
    return text;
  }

  /** True when every word of the query appears in the feature's searchable text. */
  function queryMatches(f, query) {
    const tokens = normalizeText(query).split(' ').filter(Boolean);
    if (!tokens.length) return true;
    const text = haystackOf(f);
    return tokens.every((t) => text.indexOf(t) >= 0);
  }

  /** Features matching a free-text query (case-insensitive, trimmed, all words must match; empty → all). */
  function search(query) {
    return data.features.filter((f) => queryMatches(f, query));
  }

  /**
   * True when a feature passes a filter. Every key is optional and an empty set means "any":
   * { statuses, query, review, builtBy, attentionOnly } plus { domains, modules, priorities, owners }.
   * Sets may also be arrays or a single string.
   */
  function matches(feature, filter) {
    const f = asFeature(feature);
    if (!f) return false;
    if (!filter) return true;
    if (!admits(filter.statuses, f.status)) return false;
    if (!admits(filter.review, f.review)) return false;
    if (!admits(filter.builtBy, f.builtBy)) return false;
    if (!admits(filter.priorities, f.priority)) return false;
    if (!admits(filter.owners, f.owner)) return false;
    if (!admits(filter.modules, f.moduleId)) return false;
    if (filter.domains != null) {
      const m = moduleById.get(f.moduleId);
      if (!admits(filter.domains, m ? m.domainId : null)) return false;
    }
    if (filter.attentionOnly && !needsAttention(f)) return false;
    if (filter.query != null && !queryMatches(f, filter.query)) return false;
    return true;
  }

  // ── Public API ─────────────────────────────────────────────────────────────────────────────

  window.BP = {
    data,
    product: data.product,
    domains: data.domains,
    modules: data.modules,
    features: data.features,
    releases: data.releases,
    teams: data.teams,

    DIMENSIONS,
    STATUSES,
    FACET_STATES,
    STATUS_ORDER,
    REVIEW_ORDER,
    BUILDER_ORDER,
    LENSES,

    /** Domain by id, or null. */
    domain: (id) => lookup(domainById, id),
    /** Module by id, or null. */
    module: (id) => lookup(moduleById, id),
    /** Feature by id, or null. */
    feature: (id) => lookup(featureById, id),
    /** Team by id, or null. */
    team: (id) => lookup(teamById, id),
    /** Release by id, or null. */
    release: (id) => lookup(releaseById, id),

    /** Modules of a domain, in display order. */
    modulesOf: (domainId) => (modulesByDomain.get(typeof domainId === 'string' ? domainId.trim() : domainId) || []).slice(),
    /** Features of a module, in display order. */
    featuresOf: (moduleId) => (featuresByModule.get(typeof moduleId === 'string' ? moduleId.trim() : moduleId) || []).slice(),
    /** Features of every module in a domain, in display order. */
    featuresOfDomain: (domainId) => (featuresByDomain.get(typeof domainId === 'string' ? domainId.trim() : domainId) || []).slice(),

    facetValue,
    dimScore,
    featureScore,
    rollup,
    moduleRollup,
    domainRollup,
    productRollup,
    dependencies,
    dependents,
    needsAttention,
    search,
    matches,
    lensValue,
    facetCounts,
  };
})();
