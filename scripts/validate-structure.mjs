#!/usr/bin/env node
// Validates app-structure v3 maps and lens manifests: the JSON Schemas in docs/standard/schema
// (draft 2020-12, via ajv), then the checks a schema cannot express (references resolve, keys are
// unique, facet values fit their fields). Spec: docs/standard/app-structure-v3.md.
//
//   node scripts/validate-structure.mjs                      the six built-in lens manifests
//   node scripts/validate-structure.mjs <file.json>...       maps (app-structure/3) or manifests (lens-manifest/1)
//   node scripts/validate-structure.mjs <map.json> --events <map.events.jsonl>
//
// Exit code 1 when anything has an error. Warnings and notes never fail the run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020Module from 'ajv/dist/2020.js';

const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_DIR = path.join(ROOT, 'docs/standard/schema');
const LENS_DIR = path.join(ROOT, 'docs/standard/lenses');
const OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'nin', 'missing', 'present'];
const NUMERIC = new Set(['number', 'integer', 'percent', 'money']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------------------------------------------------- ajv
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
// strict, except strictRequired: if/then branches legitimately require keys declared one level up.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
const lensSchema = readJson(path.join(SCHEMA_DIR, 'lens-manifest-1.schema.json'));
const appSchema = readJson(path.join(SCHEMA_DIR, 'app-structure-3.schema.json'));
const eventSchema = readJson(path.join(SCHEMA_DIR, 'app-structure-event-3.schema.json'));
ajv.addSchema(lensSchema).addSchema(appSchema).addSchema(eventSchema);
const validateLens = ajv.getSchema(lensSchema.$id);
const validateApp = ajv.getSchema(appSchema.$id);
const validateEvent = ajv.getSchema(eventSchema.$id);

// The built-in lens ids are the schema's own enum, not a copy: a built-in added there is validated here too.
const BUILTIN = lensSchema.$defs.builtinLensId.enum;

const LENS_ID_RE = lensSchema.$defs.lensId.pattern;
const REVERSE_DNS_RE = lensSchema.$defs.reverseDns.pattern;
const SLUG_RE = appSchema.$defs.slug.pattern;
// The fixed vocabularies of the core fields a lens field may bind to (the free-string ones have none).
const CORE_VALUES = { stage: appSchema.$defs.stage.enum, priority: appSchema.$defs.feature.properties.priority.enum, status: appSchema.$defs.feature.properties.status.enum };
const FIELD_KEY_RE = lensSchema.$defs.fieldKey.pattern;

/** The value at a JSON pointer. */
function at(data, ptr) {
  let v = data;
  for (const s of ptr.split('/').slice(1)) v = v?.[s.replace(/~1/g, '/').replace(/~0/g, '~')];
  return v;
}
/** A readable location: features[3] "failed-payment-dunning" .stage */
function where(data, ptr) {
  if (!ptr) return '(root)';
  let v = data, out = '';
  for (const raw of ptr.split('/').slice(1)) {
    const s = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    v = v?.[s];
    if (/^\d+$/.test(s)) {
      out += `[${s}]`;
      const name = v && typeof v === 'object' ? v.slug ?? v.key ?? v.id ?? v.name : undefined;
      if (typeof name === 'string') out += ` "${name}"`;
    } else out += out ? `.${s}` : s;
  }
  return out;
}
const show = (v) => (v === null ? 'null — an unknown value is omitted, never written as null' : JSON.stringify(v));

/** ajv errors as one plain sentence each; branch bookkeeping ("must match then") is dropped. */
function humanize(errors, data) {
  const out = new Set();
  for (const e of errors) {
    // a propertyNames error is about a key, not the value under it
    const key = e.propertyName;
    const v = key !== undefined ? key : at(data, e.instancePath);
    const loc = where(data, e.instancePath) + (key !== undefined ? ` key ${show(key)}` : '');
    const sp = e.schemaPath;
    const lensEntryId = /^\/lenses\/\d+\/id$/.test(e.instancePath);
    let msg;
    switch (e.keyword) {
      case 'if': continue;
      case 'enum':
        msg = /\/source\/feature$/.test(e.instancePath)
          ? `a field can bind only to the core feature fields ${e.params.allowedValues.join(', ')} (got ${show(v)})`
          : lensEntryId
          ? `a built-in lens (source "builtin") must use one of: ${BUILTIN.join(', ')} (got ${show(v)}); a custom lens uses source "project" and a reverse-DNS id`
          : `must be one of: ${e.params.allowedValues.join(', ')} (got ${show(v)})`;
        break;
      case 'const':
        msg = e.instancePath === '/$schema'
          ? `$schema must be ${show(e.params.allowedValue)} (got ${show(v)}); a v2 map has no format marker and must be migrated`
          : `must be ${show(e.params.allowedValue)} (got ${show(v)})`;
        break;
      case 'pattern': {
        const p = e.params.pattern;
        // a lens entry's id also fails its source-specific check, which says more
        if (p === LENS_ID_RE && lensEntryId) continue;
        if (p === LENS_ID_RE) msg = `${show(v)} is not a lens id: use a built-in id (${BUILTIN.join(', ')}) or a reverse-DNS id such as com.example.cost`;
        else if (p === REVERSE_DNS_RE) msg = lensEntryId
          ? `a custom lens (source "project") needs a reverse-DNS id such as com.example.cost (got ${show(v)}), so it can never take a built-in's name`
          : `${show(v)} is not a reverse-DNS key such as com.example.tool`;
        else if (p === SLUG_RE) msg = `${show(v)} is not a slug (lowercase letters, digits, dots and dashes, starting with a letter or digit)`;
        else if (p === FIELD_KEY_RE) msg = `${show(v)} is not a field key (camelCase: a lowercase letter, then letters and digits)`;
        else msg = `${show(v)} does not match ${p}`;
        break;
      }
      case 'propertyNames': continue; // the pattern error underneath says it better
      case 'required':
        msg = !e.instancePath && e.params.missingProperty === '$schema'
          ? 'missing "$schema": "app-structure/3" (a v2 map has no format marker; a v3 reader maps it, a v3 file must declare it)'
          : `missing required key "${e.params.missingProperty}"`;
        break;
      case 'additionalProperties':
        msg = v && typeof v === 'object' && 'field' in v
          ? `unknown operator "${e.params.additionalProperty}" (operators: ${OPS.join(', ')})`
          : `unknown key "${e.params.additionalProperty}"`;
        break;
      case 'maxProperties':
      case 'minProperties':
        if (v && typeof v === 'object' && 'field' in v) {
          const ops = Object.keys(v).filter((k) => k !== 'field');
          msg = ops.length ? `condition leaf on "${v.field}" has ${ops.length} operators (${ops.join(', ')}); a leaf takes exactly one — combine leaves with "all" or "any"` : `condition leaf on "${v.field}" has no operator`;
        } else if (/\/source$/.test(e.instancePath)) msg = `a field's source binds to exactly one of kpi, feature (got ${Object.keys(v ?? {}).join(', ') || 'none'})`;
        else if (/^\/kpis\/\d+\/scope$/.test(e.instancePath)) msg = `KPI scope must name exactly one of feature, context, group, project (got ${Object.keys(v ?? {}).join(', ') || 'none'})`;
        else msg = e.message;
        break;
      case 'false schema': msg = 'not allowed here (for example a threshold on a rollup method that takes none)'; break;
      case 'not':
        msg = sp.includes('allOf/0') ? '"values" is only allowed on enum fields' : sp.includes('allOf/1') ? '"currency" is only allowed on money fields' : e.message;
        break;
      case 'type': msg = `must be ${e.params.type.replace(',', ' or ')} (got ${v === null ? show(v) : typeof v})`; break;
      default: msg = `${e.message}${v !== undefined && typeof v !== 'object' ? ` (got ${show(v)})` : ''}`;
    }
    out.add(`${loc}: ${msg}`);
  }
  return [...out];
}

// ------------------------------------------------------------------------------ semantic checks
class Report {
  errors = []; warnings = []; notes = [];
  error(m) { this.errors.push(m); }
  warn(m) { this.warnings.push(m); }
  note(m) { this.notes.push(m); }
}

function conditionFields(c, out = []) {
  if (!c || typeof c !== 'object') return out;
  if (c.all) c.all.forEach((x) => conditionFields(x, out));
  else if (c.any) c.any.forEach((x) => conditionFields(x, out));
  else if (c.not) conditionFields(c.not, out);
  else out.push(c);
  return out;
}

function dupes(list, key) {
  const seen = new Set(), d = new Set();
  for (const x of list ?? []) { const k = x?.[key]; if (seen.has(k)) d.add(k); seen.add(k); }
  return [...d];
}

/** Checks inside one manifest. `kpis` is set when the manifest sits in a map (source.kpi must resolve). */
function checkManifest(m, R, label, kpis) {
  const fields = new Map(m.fields.map((f) => [f.key, f]));
  for (const k of dupes(m.fields, 'key')) R.error(`${label}: field key "${k}" is declared twice`);
  for (const f of m.fields) {
    if (f.min !== undefined && f.max !== undefined && f.min > f.max) R.error(`${label}: field "${f.key}" has min > max`);
    if (f.source?.kpi && kpis && !kpis.has(f.source.kpi)) R.error(`${label}: field "${f.key}" is bound to KPI "${f.source.kpi}", which is not in kpis[]`);
  }
  for (const f of m.fields) {
    const core = f.source?.feature;
    if (!core) continue;
    if (f.type !== 'enum' && f.type !== 'string') R.error(`${label}: field "${f.key}" binds to feature ${core}, so it must be an enum or a string`);
    const vocab = CORE_VALUES[core];
    if (f.type === 'enum' && vocab) {
      const lacking = vocab.filter((x) => !f.values.includes(x));
      if (lacking.length) R.warn(`${label}: field "${f.key}" binds to feature ${core} but its values lack ${lacking.join(', ')}`);
    }
  }
  /** The leaves of one condition against the fields. `strict`: an unknown field is an error, not a warning. */
  const checkCondition = (cond, where, strict) => {
    for (const leaf of conditionFields(cond)) {
      const f = fields.get(leaf.field);
      if (!f) {
        if (strict) R.error(`${label}: ${where} names unknown field "${leaf.field}"; such an applies_when is ignored, so the lens would always apply`);
        else R.warn(`${label}: ${where} names unknown field "${leaf.field}", so it never matches`);
        continue;
      }
      const operands = [leaf.eq, leaf.ne, ...(leaf.in ?? []), ...(leaf.nin ?? [])].filter((x) => x !== undefined);
      if (f.type === 'enum') for (const x of operands) if (!f.values.includes(x)) R.warn(`${label}: ${where} compares "${f.key}" with ${show(x)}, which is not one of its values`);
      for (const op of ['lt', 'lte', 'gt', 'gte']) {
        if (leaf[op] === undefined) continue;
        if (f.type === 'enum') R.warn(`${label}: ${where} orders enum "${f.key}" with ${op}; comparisons are not by enum position — use "in"`);
        else if (NUMERIC.has(f.type) && typeof leaf[op] !== 'number') R.warn(`${label}: ${where} compares numeric "${f.key}" with a string, which never matches`);
      }
    }
  };
  if (m.health.applies_when) checkCondition(m.health.applies_when, 'applies_when', true);
  m.health.rules.forEach((r, i) => {
    checkCondition(r.when, `rule ${i + 1}`, false);
    for (const [, k] of r.reason.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)) if (!fields.has(k)) R.warn(`${label}: rule ${i + 1} reason names unknown field {${k}}`);
  });
  const ro = m.health.rollup;
  if (ro.method === 'weighted') {
    const f = fields.get(ro.by);
    if (!f) R.error(`${label}: rollup weighs by unknown field "${ro.by}"`);
    else if (!NUMERIC.has(f.type)) R.error(`${label}: rollup weighs by "${ro.by}", which is not numeric`);
  }
  const p = m.presentation;
  for (const k of p.evidence ?? []) if (!fields.has(k)) R.error(`${label}: presentation.evidence names unknown field "${k}"`);
  if (p.measures !== undefined) {
    const f = fields.get(p.measures);
    if (!f) R.error(`${label}: presentation.measures names unknown field "${p.measures}"`);
    else if (!NUMERIC.has(f.type) && f.type !== 'enum') R.error(`${label}: presentation.measures "${p.measures}" must be a number or an ordered enum`);
    else if (NUMERIC.has(f.type) && f.type !== 'percent' && f.max === undefined) R.warn(`${label}: presentation.measures "${p.measures}" has no max, so the rail cannot be scaled`);
  }
}

/** One facet value against its field: type, enum membership, bounds. */
function checkValue(f, v, R, label) {
  const bad = (why) => R.error(`${label}.${f.key}: ${show(v)} ${why}`);
  if (NUMERIC.has(f.type)) {
    if (typeof v !== 'number') return bad(`is not a number (${f.type})`);
    if (f.type === 'integer' && !Number.isInteger(v)) return bad('is not an integer');
    if (f.min !== undefined && v < f.min) return bad(`is below min ${f.min}`);
    if (f.max !== undefined && v > f.max) return bad(`is above max ${f.max}`);
    if (f.type === 'percent' && f.min === undefined && f.max === undefined && (v < 0 || v > 100)) return bad('is not a percent (0..100)');
  } else if (f.type === 'boolean') { if (typeof v !== 'boolean') bad('is not a boolean'); }
  else if (f.type === 'enum') { if (!f.values.includes(v)) bad(`is not one of: ${f.values.join(', ')}`); }
  else if (f.type === 'date') { if (typeof v !== 'string' || !DATE.test(v)) bad('is not a YYYY-MM-DD date'); }
  else if (typeof v !== 'string') bad('is not a string');
}

function checkApp(d, R) {
  const names = (list, key) => new Set((list ?? []).map((x) => x[key]));
  const groups = names(d.groups, 'name'), contexts = names(d.contexts, 'name');
  const domains = names(d.domains, 'slug'), caps = names(d.capabilities, 'slug');
  const features = names(d.features, 'slug'), milestones = names(d.milestones, 'slug'), kpis = names(d.kpis, 'slug');
  const lenses = new Map((d.lenses ?? []).map((l) => [l.id, l]));
  const ctxByName = new Map((d.contexts ?? []).map((c) => [c.name, c]));

  for (const [list, key, label] of [[d.groups, 'name', 'group name'], [d.contexts, 'name', 'context name'], [d.domains, 'slug', 'domain slug'],
    [d.capabilities, 'slug', 'capability slug'], [d.features, 'slug', 'feature slug'], [d.milestones, 'slug', 'milestone slug'],
    [d.kpis, 'slug', 'KPI slug'], [d.lenses, 'id', 'lens id']]) for (const k of dupes(list, key)) R.error(`${label} "${k}" appears more than once`);

  if (!d.features && Array.isArray(d.use_cases)) R.note('no features[]: a v3 reader falls back to use_cases[]; a v3 writer emits features[]');
  for (const c of d.contexts ?? []) if (c.group && d.groups && !groups.has(c.group) && !(d.groups ?? []).some((g) => g.id === c.group_id)) R.warn(`context "${c.name}": group "${c.group}" is not in groups[]`);
  for (const c of d.capabilities ?? []) if (!domains.has(c.domain)) R.error(`capability "${c.slug}": domain "${c.domain}" is not in domains[]`);
  for (const f of d.features ?? []) {
    const L = `feature "${f.slug}"`;
    if (f.capability && !caps.has(f.capability)) R.error(`${L}: capability "${f.capability}" is not in capabilities[]`);
    for (const c of f.contexts ?? []) if (!contexts.has(c)) R.error(`${L}: context "${c}" is not in contexts[]`);
    if (f.primary_context) {
      if (!contexts.has(f.primary_context)) R.error(`${L}: primary_context "${f.primary_context}" is not in contexts[]`);
      else if (!(f.contexts ?? []).includes(f.primary_context)) R.warn(`${L}: primary_context "${f.primary_context}" is not one of its contexts`);
    }
    if (f.milestone && !milestones.has(f.milestone)) R.error(`${L}: milestone "${f.milestone}" is not in milestones[]`);
    for (const k of ['depends_on', 'blocked_by']) for (const s of f[k] ?? []) {
      if (s === f.slug) R.error(`${L}: ${k} names itself`);
      else if (!features.has(s)) R.error(`${L}: ${k} "${s}" is not in features[]`);
    }
    // v3.1 variations: slugs unique within the feature; the code layout convention is advisory (spec 6.7),
    // so a feature with variations but no `customizations/` folder in its contexts' files only warns.
    if (f.variations?.length) {
      for (const k of dupes(f.variations, 'slug')) R.error(`${L}: variation slug "${k}" appears more than once`);
      const files = (f.contexts ?? []).flatMap((c) => ctxByName.get(c)?.file_paths ?? []);
      if (!files.some((p) => /(^|[\\/])customizations([\\/]|$)/.test(p))) {
        R.warn(`${L}: has ${f.variations.length} variations, but none of its contexts' file_paths has a customizations/ folder (convention: <domain>/<context>/<feature>/customizations/<variation>/)`);
      }
    }
  }
  for (const k of d.kpis ?? []) {
    const L = `KPI "${k.slug}"`, s = k.scope;
    if (s.feature && !features.has(s.feature)) R.error(`${L}: scope feature "${s.feature}" is not in features[]`);
    if (s.context && !contexts.has(s.context)) R.error(`${L}: scope context "${s.context}" is not in contexts[]`);
    if (s.group && !groups.has(s.group)) R.error(`${L}: scope group "${s.group}" is not in groups[]`);
    if (k.lens && !lenses.has(k.lens)) R.warn(`${L}: lens tag "${k.lens}" is not in lenses[]`);
  }
  for (const l of d.lenses ?? []) {
    const L = `lens "${l.id}"`;
    if (l.manifest.id !== l.id) R.error(`${L}: manifest id is "${l.manifest.id}"`);
    if (l.manifest.version !== l.version) R.error(`${L}: entry version ${l.version} but manifest version ${l.manifest.version}`);
    checkManifest(l.manifest, R, L, kpis);
  }
  const today = new Date().toISOString().slice(0, 10);
  for (const [slug, byLens] of Object.entries(d.facets ?? {})) {
    if (!features.has(slug)) R.error(`facets: "${slug}" is not in features[]`);
    for (const [id, facet] of Object.entries(byLens)) {
      const L = `facets."${slug}".${id}`;
      const lens = lenses.get(id);
      if (!lens) { R.note(`${L}: lens "${id}" is not in lenses[]; the facet is orphaned and must be kept`); continue; }
      const fields = new Map(lens.manifest.fields.map((f) => [f.key, f]));
      for (const [k, v] of Object.entries(facet.values ?? {})) {
        const f = fields.get(k);
        if (!f) R.warn(`${L}: value "${k}" is not a field of lens "${id}"`);
        else if (f.source?.feature) R.warn(`${L}: value "${k}" is bound to feature ${f.source.feature}; a stored value is ignored and should not be written`);
        else checkValue(f, v, R, `${L}.values`);
      }
      if (facet.override && facet.override.until < today) R.note(`${L}: override expired on ${facet.override.until} (harmless; a writer may drop it)`);
    }
  }
  for (const [k, list] of [['features', d.features], ['kpis', d.kpis], ['lenses', d.lenses], ['groups', d.groups], ['contexts', d.contexts]]) {
    if (d.stats?.[k] !== undefined && list && d.stats[k] !== list.length) R.warn(`stats.${k} is ${d.stats[k]} but ${k}[] has ${list.length}`);
  }
}

function checkEvents(file, map, R) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const has = (list, key, v) => !map || (map[list] ?? []).some((x) => x[key] === v);
  let prev = '', n = 0;
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    n++;
    const L = `line ${i + 1}`;
    let e;
    try { e = JSON.parse(line); } catch (err) { R.error(`${L}: not JSON (${err.message})`); return; }
    if (!validateEvent(e)) { for (const m of humanize(validateEvent.errors, e)) R.error(`${L} ${m}`); return; }
    if (e.at < prev) R.warn(`${L}: at ${e.at} is earlier than the line before; the log is append-only`);
    prev = e.at;
    if (e.feature && !has('features', 'slug', e.feature)) R.warn(`${L}: feature "${e.feature}" is not in the map (renamed or removed?)`);
    if (e.kpi && !has('kpis', 'slug', e.kpi)) R.warn(`${L}: KPI "${e.kpi}" is not in the map`);
    if (e.milestone && !has('milestones', 'slug', e.milestone)) R.warn(`${L}: milestone "${e.milestone}" is not in the map`);
  });
  return n;
}

// ------------------------------------------------------------------------------------------- run
function validateFile(file) {
  const R = new Report();
  let d;
  try { d = readJson(file); } catch (err) { R.error(`not readable JSON: ${err.message}`); return { R, kind: '?', d: null }; }
  const kind = d?.$schema === 'lens-manifest/1' ? 'lens-manifest/1' : 'app-structure/3';
  const v = kind === 'lens-manifest/1' ? validateLens : validateApp;
  if (!v(d)) for (const m of humanize(v.errors, d)) R.error(m);
  else if (kind === 'lens-manifest/1') checkManifest(d, R, `lens "${d.id}"`, null);
  else checkApp(d, R);
  return { R, kind, d };
}

function print(label, R) {
  const ok = !R.errors.length;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  for (const m of R.errors) console.log(`       error: ${m}`);
  for (const m of R.warnings) console.log(`     warning: ${m}`);
  for (const m of R.notes) console.log(`        note: ${m}`);
  return ok;
}

const args = process.argv.slice(2);
let eventsFile = null;
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--events') eventsFile = args[++i];
  else if (args[i] === '-h' || args[i] === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(4, 9).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
  else files.push(args[i]);
}
const builtinRun = !files.length && !eventsFile;
if (builtinRun) files.push(...BUILTIN.map((id) => path.join(LENS_DIR, `${id}.json`)));

let failed = 0, maps = [];
for (const file of files) {
  const { R, kind, d } = validateFile(file);
  if (builtinRun && d) {
    const id = path.basename(file, '.json');
    if (d.id !== id) R.error(`a built-in manifest's id must match its file name (${id})`);
  }
  if (kind === 'app-structure/3' && d) maps.push(d);
  if (!print(`${path.relative(process.cwd(), file)} (${kind})`, R)) failed++;
}
if (eventsFile) {
  const R = new Report();
  const n = checkEvents(eventsFile, maps.length === 1 ? maps[0] : null, R);
  if (!print(`${path.relative(process.cwd(), eventsFile)} (events, ${n} lines)`, R)) failed++;
}
const total = files.length + (eventsFile ? 1 : 0);
console.log(`\n${total - failed} of ${total} valid`);
process.exit(failed ? 1 : 0);
