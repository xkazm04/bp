// Orbit kit demo and test page. It mounts the shell, fills shell.mapEl with a plain "list map" and shell.timelineEl
// with a release list, and serves #styleguide: the tokens and primitives in both themes side by side.
// Variants copy the wiring pattern here, then replace the list map and timeline with their own shapes.
(function () {
  'use strict';
  const BP = window.BP, OK = window.OK;
  const esc = OK.esc;
  const app = document.getElementById('app');
  const baseTitle = document.title;
  let shell = null;
  let teardown = null; // removes the demo's own document listeners when the route changes

  // ══ kit demo ══════════════════════════════════════════════════════════════════════════════════
  function bootDemo() {
    document.title = baseTitle;
    shell = OK.mount({
      root: app,
      variant: 'Kit demo',
      legend: () => '<section class="ok-lg-sec"><h3>This demo</h3><div class="ok-lg-row">' +
        '<svg width="26" height="16" viewBox="0 0 26 16" aria-hidden="true"><rect x="1" y="2" width="24" height="12" rx="6" fill="var(--ok-good-soft)" stroke="var(--ok-good)"/></svg>' +
        '<span>Each chip is a feature, tinted by its band in the current lens. Fixed order: filters only fade chips.</span></div></section>',
      // The demo's own keys, appended to the kit's key line in the legend (handled in onDemoKey below).
      keys: [['P', 'Product inspector'], ['[ ]', 'Previous / next area']],
    });
    const chipById = new Map();

    // ── list map: areas › domains › modules › feature chips (fixed order, never re-sorted) ──────
    function rateSm(ref) { return OK.html.rating(OK.nodeRating(ref, shell.state.lens), { size: 'sm', label: OK.lens(shell.state.lens).label }); }
    function chipHTML(f) {
      const g = BP.gates(f);
      const band = BP.rating(f, shell.state.lens).band;
      return '<button type="button" class="kd-chip" data-f="' + esc(f.id) + '" data-band="' + band + '" title="' + esc(f.name + ' · ' + OK.statusLabel(f.status)) + '">' +
        OK.html.status(f.status, 12, OK.statusLabel(f.status)) + '<span class="kd-chip__name">' + esc(f.name) + '</span>' +
        (g.length ? '<span class="kd-chip__gate" title="' + esc(g.length + ' waiting for a human') + '">' + OK.html.gate(g[0].kind, 11) + '</span>' : '') +
        (BP.needsAttention(f) ? OK.html.attention(11) : '') + '</button>';
    }
    function renderMap() {
      const pr = BP.productRollup();
      let h = '<div class="kd-scroll" id="kd-map-scroll"><p class="kd-plate"><b>List map</b><span>Kit test surface: every feature in fixed blueprint order. Click a chip to peek, double-click or press Enter to open its page; headers open the inspector.</span>' +
        // the declarative product hook: the kit opens its standard product inspector on click
        '<button type="button" class="ok-btn ok-btn--sm kd-prod" data-ok-inspect="product" title="Inspect the whole product (P)">' + OK.svg.mark(15) + 'Inspect product</button></p>';
      BP.areas.forEach((a) => {
        const ar = BP.areaRollup(a.id);
        h += '<section class="kd-area" aria-label="' + esc(a.name) + '"><div class="kd-area__head"><button type="button" class="kd-area__name" data-node="area:' + esc(a.id) + '">' + esc(a.name) + '</button><span class="kd-area__rule" aria-hidden="true"></span>' +
          '<span class="kd-area__meta"><span class="kd-rate" data-ref="area:' + esc(a.id) + '">' + rateSm({ type: 'area', id: a.id }) + '</span><span class="kd-hide-phone">' + ar.count + ' features</span></span></div><div class="kd-doms">';
        BP.domainsOf(a.id).forEach((d) => {
          h += '<article class="kd-dom" data-dom="' + esc(d.id) + '"><button type="button" class="kd-dom__head" data-node="domain:' + esc(d.id) + '"><span class="kd-dom__code">' + esc(d.code) + '</span><span class="kd-dom__name">' + esc(d.name) + '</span>' +
            '<span class="kd-dom__end"><span class="kd-rate" data-ref="domain:' + esc(d.id) + '">' + rateSm({ type: 'domain', id: d.id }) + '</span>' + BP.featuresOfDomain(d.id).length + '</span></button>';
          BP.modulesOf(d.id).forEach((m) => {
            const fs = BP.featuresOf(m.id);
            h += '<div class="kd-mod" data-mod="' + esc(m.id) + '"><button type="button" class="kd-mod__head" data-node="module:' + esc(m.id) + '"><span class="kd-mod__name">' + esc(m.name) + '</span><span class="kd-mod__end"><span class="kd-rate" data-ref="module:' + esc(m.id) + '">' + rateSm({ type: 'module', id: m.id }) + '</span>' + fs.length + '</span></button>' +
              '<div class="kd-chips">' + fs.map(chipHTML).join('') + '</div></div>';
          });
          h += '</article>';
        });
        h += '</div></section>';
      });
      h += '<p class="kd-plate" style="margin-top:22px"><span>' + pr.count + ' features · ' + BP.modules.length + ' modules · ' + BP.domains.length + ' domains · ' + BP.areas.length + ' areas</span></p></div>';
      shell.mapEl.innerHTML = h;
      chipById.clear();
      shell.mapEl.querySelectorAll('.kd-chip').forEach((c) => chipById.set(c.getAttribute('data-f'), c));
      paintMarks();
      paintSelection();
    }
    // Lens switch: recolour in place (no re-layout, nothing moves).
    function paintLens() {
      const lens = shell.state.lens;
      chipById.forEach((c, id) => c.setAttribute('data-band', BP.rating(id, lens).band));
      document.querySelectorAll('.kd-rate').forEach((s) => {
        const [type, id] = s.getAttribute('data-ref').split(':');
        s.innerHTML = rateSm({ type, id });
      });
    }
    // Filters: fade what does not match, ring search hits.
    function paintMarks() {
      chipById.forEach((c, id) => {
        c.classList.toggle('is-dim', shell.isDimmed(id));
        c.classList.toggle('is-hit', shell.isHit(id));
      });
      shell.timelineEl.querySelectorAll('.ok-ritem[data-ok-peek]').forEach((b) => b.classList.toggle('is-dim', shell.isDimmed(b.getAttribute('data-ok-peek'))));
    }
    function paintSelection() {
      const sel = shell.state.selection;
      shell.root.querySelectorAll('.is-sel').forEach((x) => { if (x.classList.contains('kd-chip') || x.classList.contains('kd-mod') || x.classList.contains('kd-dom') || x.classList.contains('kd-rel') || x.classList.contains('kd-prod')) x.classList.remove('is-sel'); });
      if (!sel) return;
      const node = sel.type === 'feature' ? chipById.get(sel.id) : sel.type === 'module' ? shell.mapEl.querySelector('[data-mod="' + sel.id + '"]') : sel.type === 'domain' ? shell.mapEl.querySelector('[data-dom="' + sel.id + '"]') : sel.type === 'release' ? shell.timelineEl.querySelector('[data-rel="' + sel.id + '"]') : sel.type === 'product' ? shell.mapEl.querySelector('.kd-prod') : null;
      if (node) node.classList.add('is-sel');
    }
    function locate(ref) {
      if (!ref) return;
      const node = ref.type === 'feature' ? chipById.get(ref.id) : ref.type === 'module' ? shell.mapEl.querySelector('[data-mod="' + ref.id + '"]') : ref.type === 'domain' ? shell.mapEl.querySelector('[data-dom="' + ref.id + '"]') : ref.type === 'area' ? shell.mapEl.querySelector('[data-node="area:' + ref.id + '"]') : null;
      if (!node || shell.state.view !== 'map') return;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
      if (ref.type === 'feature') { node.classList.remove('is-flash'); void node.offsetWidth; node.classList.add('is-flash'); }
    }

    // Module inspector composed from OK.blocks (domains and areas use the kit's standard composition).
    function inspectModule(id) {
      const m = BP.module(id), d = BP.domain(m.domainId), a = BP.area(d.areaId);
      const lens = shell.state.lens;
      const ref = { type: 'module', id };
      const fs = BP.featuresOf(id);
      shell.select(ref);
      shell.inspector.open({
        kicker: '<nav class="ok-crumb" aria-label="Breadcrumb"><button type="button" data-ok-inspect="area:' + esc(a.id) + '">' + esc(a.name) + '</button><span class="ok-crumb__sep">›</span><button type="button" data-ok-inspect="domain:' + esc(d.id) + '">' + esc(d.name) + '</button><span class="ok-crumb__sep">›</span><span>Module</span></nav>',
        title: esc(m.name),
        subtitle: OK.html.rating(BP.moduleRating(id, lens), { size: 'sm', label: OK.lens(lens).label }) + '<span class="ok-chip ok-chip--plain">' + fs.length + ' features</span>' +
          '<span class="ok-chip ok-chip--plain">' + esc((BP.team(m.owner) || {}).name || m.owner) + '</span>',
        body: '<p class="ok-summary">' + esc(m.summary) + '</p>' +
          '<section class="ok-sec" style="margin-top:16px"><h3 class="ok-sec__h"><span>Status</span></h3>' + OK.blocks.statusBar(BP.moduleRollup(id)) + '</section>' +
          '<section class="ok-sec"><h3 class="ok-sec__h"><span>Waiting for a human</span></h3>' + OK.blocks.gates(fs) + '</section>' +
          '<section class="ok-sec"><h3 class="ok-sec__h"><span>Every lens</span></h3>' + OK.blocks.ratingTable(ref, { lens }) + '</section>' +
          '<section class="ok-sec"><h3 class="ok-sec__h"><span>Features</span><span class="ok-mono">' + fs.length + '</span></h3>' + OK.blocks.featureList(fs, { lens }) + '</section>',
        footer: '<span class="ok-muted" style="font-size:12px">Surfaces: ' + esc((m.surfaces || []).map((s) => OK.labels.surface[s] || s).join(', ')) + '</span>',
        onClose: () => { const sel = shell.state.selection; if (sel && sel.type === 'module' && sel.id === id) shell.select(null); },
      });
    }
    function openNode(type, id) {
      if (type === 'module') inspectModule(id); else shell.inspect({ type, id });
    }

    shell.mapEl.addEventListener('click', (e) => {
      const chip = e.target.closest('.kd-chip');
      if (chip) { shell.peek(chip.getAttribute('data-f')); return; }
      const node = e.target.closest('[data-node]');
      if (node) { const [type, id] = node.getAttribute('data-node').split(':'); openNode(type, id); }
    });
    shell.mapEl.addEventListener('dblclick', (e) => {
      const chip = e.target.closest('.kd-chip');
      if (chip) shell.openFeature(chip.getAttribute('data-f'));
    });
    shell.mapEl.addEventListener('keydown', (e) => {
      const chip = e.target.closest && e.target.closest('.kd-chip');
      if (chip && e.key === 'Enter') { e.preventDefault(); shell.openFeature(chip.getAttribute('data-f')); }
    });

    // ── timeline: releases with their packages ──────────────────────────────────────────────────
    function renderTimeline() {
      const rels = BP.releasesInOrder().slice().reverse();
      const asOf = BP.data.meta.asOf;
      let h = '<div class="kd-scroll"><p class="kd-plate"><b>Timeline</b><span>Releases newest first, each with its package: new, improved and fixed features grouped by domain.</span></p><div class="kd-tl">';
      let todayDone = false;
      rels.forEach((r) => {
        if (!todayDone && r.date <= asOf) { h += '<div class="kd-today" aria-hidden="true"><span>Today · ' + esc(OK.fmt.dateShort(asOf)) + '</span><i></i></div>'; todayDone = true; }
        h += '<section class="kd-rel is-' + esc(r.state) + '" data-rel="' + esc(r.id) + '" aria-label="' + esc('Release ' + r.label) + '"><div class="kd-rel__rail"><span class="kd-rel__date">' + esc(OK.fmt.date(r.date)) + '</span><span class="kd-rel__when">' + esc(OK.fmt.rel(r.date)) + '</span>' +
          '<button type="button" class="ok-btn ok-btn--sm kd-rel__insp" data-rel-open="' + esc(r.id) + '">Inspect</button></div><div class="kd-rel__card">' + OK.blocks.releasePackage(r.id) + '</div></section>';
      });
      shell.timelineEl.innerHTML = h + '</div></div>';
      paintMarks();
    }
    shell.timelineEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rel-open]');
      if (b) shell.inspect({ type: 'release', id: b.getAttribute('data-rel-open') });
    });

    // ── demo keys (listed in the legend through the `keys` option) ───────────────────────────────
    const AREA_IDS = BP.areas.map((a) => a.id);
    function onDemoKey(e) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && t.matches && t.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (shell.state.page) return;
      if (e.key === 'p' || e.key === 'P') { shell.inspect({ type: 'product' }); e.preventDefault(); }
      else if (e.key === '[' || e.key === ']') {
        const sel = shell.state.selection;
        const i = sel && sel.type === 'area' ? AREA_IDS.indexOf(sel.id) : -1;
        const n = AREA_IDS.length;
        const id = AREA_IDS[e.key === ']' ? (i + 1) % n : i <= 0 ? n - 1 : i - 1];
        if (shell.state.view !== 'map') shell.setView('map');
        shell.inspect({ type: 'area', id });
        locate({ type: 'area', id });
        e.preventDefault();
      }
    }
    document.addEventListener('keydown', onDemoKey);
    teardown = () => document.removeEventListener('keydown', onDemoKey);

    // ── shell events ────────────────────────────────────────────────────────────────────────────
    // `source` says who caused a select: 'variant' (this page's clicks and API calls), or 'inspector', 'page',
    // 'search' or 'kit' when the kit did it. The demo keeps the last one for its screenshot checks.
    let lastSelect = null;
    shell.on('lens', paintLens);
    shell.on('filter', paintMarks);
    shell.on('select', (p) => { lastSelect = p; paintSelection(); });
    shell.on('locate', (ref) => locate(ref));
    shell.on('view', (v) => { if (v.view === 'timeline' && !shell.timelineEl.firstChild) renderTimeline(); });

    renderMap();
    renderTimeline();
    window.KD = { shell, inspectModule, get lastSelect() { return lastSelect; } };
  }

  // ══ #styleguide: tokens and primitives, light and dark side by side ══════════════════════════════
  const TOKENS = [
    ['Surfaces and ink', ['--ok-paper', '--ok-paper-hi', '--ok-sky-a', '--ok-sky-b', '--ok-panel-solid', '--ok-ink', '--ok-ink-2', '--ok-ink-3', '--ok-ink-4', '--ok-on-ink', '--ok-rule', '--ok-rule-2', '--ok-band', '--ok-band-hi', '--ok-panel-edge', '--ok-shadow', '--ok-glow', '--ok-scrim']],
    ['Lens hues: identify a lens, never a state', ['--ok-lens-overall', '--ok-lens-dev', '--ok-lens-ops', '--ok-lens-biz', '--ok-lens-sec', '--ok-lens-comp', '--ok-lens-ux', '--ok-lens-cost']],
    ['Rating bands: an ordered scale', ['--ok-good', '--ok-fair', '--ok-poor', '--ok-critical', '--ok-na', '--ok-good-soft', '--ok-fair-soft', '--ok-poor-soft', '--ok-critical-soft', '--ok-na-soft']],
    ['Signals', ['--ok-alarm', '--ok-alarm-soft', '--ok-gate', '--ok-gate-soft', '--ok-focus']],
  ];
  function sgColumn(theme) {
    const H = OK.html, S = OK.svg;
    const lives = BP.features.filter((f) => f.status === 'live');
    const byScore = lives.slice().sort((a, b) => (BP.rating(b, 'overall').score || 0) - (BP.rating(a, 'overall').score || 0));
    const samples = [byScore[0], byScore[Math.floor(byScore.length / 2)], byScore[byScore.length - 1], BP.features.find((f) => f.status === 'building'), BP.features.find((f) => f.status === 'planned'), BP.features.find((f) => f.status === 'blocked')].filter(Boolean);
    const sec = (title, note, body) => '<section class="ok-sg-sec"><h3>' + esc(title) + '</h3>' + (note ? '<p>' + note + '</p>' : '') + body + '</section>';
    let h = '<div class="ok-sg__colhead"><h2>' + (theme === 'light' ? 'Daylight' : 'Night') + '</h2><code>' + (theme === 'light' ? ':root (default)' : ':root[data-theme="dark"]') + '</code></div>';
    TOKENS.forEach(([title, list]) => {
      h += sec(title, '', '<div class="ok-sg-swatches">' + list.map((t) => '<div class="ok-sg-sw"><i style="background:var(' + t + ')"></i><b>' + t.replace('--ok-', '') + '</b><span data-token="' + t + '"></span></div>').join('') + '</div>');
    });
    h += sec('Type', 'Jost for labels: tracked capitals for chart lettering, sentence case for copy. DM Mono for every number, date and reference.',
      '<div class="ok-sg-type"><div><code>label 10.5 / .16em</code><span class="ok-cap">Human gates · Development</span></div><div><code>title 30 / 500</code><span style="font:500 30px/1.1 var(--ok-f-label)">One-page checkout</span></div>' +
      '<div><code>inspector 22 / 500</code><span style="font:500 22px var(--ok-f-label)">Card Processing</span></div><div><code>body 14.5</code><span style="font-size:14.5px">Address, delivery and payment on a single page, with inline validation.</span></div>' +
      '<div><code>mono 12</code><span class="ok-mono" style="font-size:12px">v1.11.3 · 99.95% · p95 180 ms · 8 Oct 2026</span></div><div><code>brand 14 / .32em</code><span class="ok-brand__name">' + esc(BP.product.name) + '</span></div></div>');
    h += sec('Status glyphs', 'Form carries the lifecycle, so it reads without colour.',
      '<div class="ok-sg-row">' + BP.STATUS_ORDER.map((s) => '<span class="ok-sg-cell">' + H.status(s, 26) + H.status(s, 14) + '<span>' + esc(OK.statusLabel(s)) + '</span><code>' + s + '</code></span>').join('') + '</div>');
    h += sec('Rating band glyphs', 'The fill grows with the score: full, three-quarter and half discs, a crossed ring for critical, a dashed ring when a lens does not apply.',
      '<div class="ok-sg-row">' + ['good', 'fair', 'poor', 'critical', 'na'].map((b) => '<span class="ok-sg-cell">' + H.band(b, 26) + H.band(b, 14) + '<span>' + esc(OK.bandLabel(b)) + '</span><code>' + esc(OK.labels.band[b].range) + '</code></span>').join('') + '</div>' +
      '<div class="ok-sg-row" style="margin-top:14px">' + ['good', 'fair', 'poor', 'critical', 'na'].map((b) => H.bandChip(b)).join('') + '</div>');
    h += sec('Coronas', 'Eight segments clockwise from the top in lens order, each coloured by its band; faint where a lens does not apply. The outer tick marks the current lens (here Security).',
      '<div class="ok-sg-row">' + samples.map((f) => '<span class="ok-sg-cell" style="max-width:110px">' + H.corona(f, 56, { lens: 'sec' }) + '<span>' + esc(f.name) + '</span><code>' + esc(f.status) + '</code></span>').join('') + '</div>');
    h += sec('Lens marks', 'A ring in the lens hue around the product band for that lens, as on the lens dial.',
      '<div class="ok-sg-row">' + OK.lenses().map((l) => '<span class="ok-sg-cell">' + H.jewel(l.id, BP.productRating(l.id).band, 24) + '<span>' + esc(l.label) + '</span><code>' + OK.fmt.score(BP.productRating(l.id).score) + '</code></span>').join('') + '</div>');
    h += sec('Chips', '', '<div class="ok-sg-stack"><div class="ok-sg-row" style="gap:6px">' + BP.STATUS_ORDER.map(H.statusChip).join('') + '</div><div class="ok-sg-row" style="gap:6px">' + OK.lenses().map((l) => H.lensChip(l.id)).join('') + '</div>' +
      '<div class="ok-sg-row" style="gap:6px">' + ['triage', 'approval', 'changes'].map(H.gateChip).join('') + H.priority('P0') + H.releaseChip(byScore[0]) + '<span class="ok-chip ok-chip--alarm">' + H.attention(11) + 'Needs attention</span></div></div>');
    const r1 = BP.rating(byScore[0], 'dev'), r2 = BP.rating(byScore[byScore.length - 1], 'ops'), r3 = BP.rating(samples[3] || byScore[0], 'ops');
    h += sec('Rating badges', 'Small, medium and large, built from BP.rating().',
      '<div class="ok-sg-stack"><div class="ok-sg-row">' + H.rating(r1, { size: 'sm' }) + H.rating(r2, { size: 'sm' }) + H.rating(r3, { size: 'sm' }) + '</div>' +
      '<div class="ok-sg-card ok-sg-stack">' + H.rating(r1, { size: 'md', label: 'Development' }) + H.rating(r2, { size: 'md', label: 'Operations' }) + '</div>' +
      '<div class="ok-sg-card">' + H.rating(r2, { size: 'lg', label: 'Operations' }) + '</div></div>');
    h += sec('Marks', 'Human gates, attention, release kinds, ledger actors and results.',
      '<div class="ok-sg-row">' + ['triage', 'approval', 'changes'].map((k) => '<span class="ok-sg-cell">' + H.gate(k, 22) + '<code>gate ' + k + '</code></span>').join('') + '<span class="ok-sg-cell">' + H.attention(22) + '<code>attention</code></span>' +
      ['new', 'improved', 'fixed'].map((k) => '<span class="ok-sg-cell">' + S.wrap(S.releaseKind(k, 5), 6, 20) + '<code>' + k + '</code></span>').join('') +
      ['agent', 'human', 'system'].map((k) => '<span class="ok-sg-cell">' + S.wrap(S.actor(k, 6), 7, 20) + '<code>' + k + '</code></span>').join('') +
      ['pass', 'warn', 'fail', 'info'].map((k) => '<span class="ok-sg-cell">' + S.wrap(S.result(k, 5), 6.2, 20) + '<code>' + k + '</code></span>').join('') + '</div>');
    h += sec('Controls', '', '<div class="ok-sg-stack"><div class="ok-sg-row" style="gap:8px"><button type="button" class="ok-btn ok-btn--primary">Open feature page' + S.icon('arrow', 13) + '</button><button type="button" class="ok-btn">' + S.icon('locate', 14) + 'Show on map</button>' +
      '<button type="button" class="ok-btn ok-btn--gate ok-btn--sm">' + S.icon('check', 12) + 'Approve</button><button type="button" class="ok-btn ok-btn--sm">Request changes</button></div>' +
      '<div class="ok-sg-row" style="gap:6px"><button type="button" class="ok-fchip" aria-pressed="true">' + H.status('live', 12) + '<span class="ok-fchip__t">Live</span><span class="ok-fchip__n">18</span></button><button type="button" class="ok-fchip" aria-pressed="false">' + H.status('building', 12) + '<span class="ok-fchip__t">In build</span><span class="ok-fchip__n">5</span></button>' +
      '<div class="ok-gates"><button type="button" class="ok-gates__main" aria-pressed="false">' + H.gate('approval', 13) + '<span class="ok-gates__t">Human gates</span></button><button type="button" aria-pressed="true"><span class="ok-gates__t">Triage</span><span class="ok-gates__n">7</span></button><button type="button" aria-pressed="false"><span class="ok-gates__t">Changes</span><span class="ok-gates__n is-alarm">3</span></button></div>' +
      '<button type="button" class="ok-fchip ok-attn" aria-pressed="false">' + H.attention(13) + '<span class="ok-fchip__t">Attention</span><span class="ok-fchip__n">6</span></button></div>' +
      '<div class="ok-sg-row" style="gap:4px"><span class="ok-lenses ok-sg-lenses">' + ['overall', 'dev', 'sec'].map((id, i) => '<button type="button" class="ok-lens" aria-pressed="' + (i === 1) + '">' + H.jewel(id, BP.productRating(id).band, 18) + '<span class="ok-lens__name">' + esc(OK.lens(id).label) + '</span><span class="ok-lens__score">' + OK.fmt.score(BP.productRating(id).score) + '</span></button>').join('') + '</span></div></div>');
    h += sec('Blocks', 'OK.blocks.statusBar and OK.blocks.ratingTable for the first domain.',
      '<div class="ok-sg-card ok-sg-stack">' + OK.blocks.statusBar(BP.productRollup()) + OK.blocks.ratingTable({ type: 'domain', id: BP.domains[0].id }, { lens: 'dev' }) + '</div>');
    return h;
  }
  function bootStyleguide() {
    document.title = baseTitle + ' Styleguide';
    document.documentElement.setAttribute('data-theme', 'light');
    app.innerHTML = '<div class="ok-sg"><header class="ok-sg__bar">' + OK.svg.mark(22) + '<h1>Orbit kit</h1><p>Design-system reference: tokens and primitives, daylight and night side by side.</p><a class="ok-btn ok-btn--sm" href="#">' + OK.svg.icon('back', 13) + 'Kit demo</a></header>' +
      '<div class="ok-sg__cols"><div class="ok-sg__col ok-theme-light">' + sgColumn('light') + '</div><div class="ok-sg__col ok-theme-dark">' + sgColumn('dark') + '</div></div></div>';
    app.querySelectorAll('[data-token]').forEach((s) => {
      const col = s.closest('.ok-sg__col');
      s.textContent = getComputedStyle(col).getPropertyValue(s.getAttribute('data-token')).trim();
    });
  }

  // ══ routing: bare #styleguide anchor, everything else is the demo ══════════════════════════════════
  let mode = null;
  function route() {
    const want = location.hash === '#styleguide' ? 'styleguide' : 'demo';
    if (want === mode) return;
    if (teardown) { teardown(); teardown = null; }
    if (shell) { shell.destroy(); shell = null; }
    app.innerHTML = '';
    mode = want;
    if (want === 'styleguide') bootStyleguide(); else bootDemo();
  }
  window.addEventListener('hashchange', route);
  route();
})();
