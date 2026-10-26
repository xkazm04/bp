// The companion's tool catalog: the ONE declaration of what the companion (or any agent on the bp MCP door) may do
// (registry companion-runtime/action-catalog-single-source). The MCP server's tools/list, the prompt's capability block,
// apps/server's athena-host BP_TOOLS and the docs' tool table are all derived from this table; nothing restates it.
// Class is derived, never declared: AUTO when reversible and not external, else GATED (a card, or a policy grant).
// Each tool is one HTTP call to bp (`route`), so the companion is a principal on the same door as every other client.

export type SideEffects = 'none' | 'internal' | 'external';
export type ToolClass = 'AUTO' | 'GATED';

export interface ToolSpec {
  /** Dotted name (docs, cards); travels as `wireName(name)`. */
  name: string;
  description: string;
  reversible: boolean;
  side_effects: SideEffects;
  params_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  /** The HTTP call that performs it: method and a path template over params (`{slug}` etc.). */
  route: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; path: string };
}

const slug = { type: 'string', description: "the product's slug (bp.products.local.json); kettle is the built-in sample" };
const str = (description: string) => ({ type: 'string', description });

export const TOOLS: readonly ToolSpec[] = [
  { name: 'inbox.list', description: 'Open decisions across every registered product, ranked by tier, age and value.', reversible: true, side_effects: 'none',
    params_schema: { type: 'object', properties: { limit: { type: 'number' } } }, route: { method: 'GET', path: '/api/companion/inbox' } },
  { name: 'decision.recommend', description: 'Attach a recommended verdict and its reason to one open decision, for the person to approve in a batch.', reversible: true, side_effects: 'internal',
    params_schema: { type: 'object', properties: { slug, id: str('the proposal id'), verdict: { type: 'string', enum: ['approve', 'decline', 'rework', 'descope'] }, why: str('one or two sentences') }, required: ['slug', 'id', 'verdict', 'why'] },
    route: { method: 'POST', path: '/api/companion/recommendations' } },
  { name: 'decision.answer', description: 'Approve or decline one proposal.', reversible: true, side_effects: 'internal',
    params_schema: { type: 'object', properties: { slug, id: str('the proposal id'), decision: { type: 'string', enum: ['approve', 'decline'] }, note: str('why') }, required: ['slug', 'id', 'decision'] },
    route: { method: 'POST', path: '/api/products/{slug}/proposals/{id}' } },
  { name: 'triage.set', description: 'Triage shipped items: accept, rework, descope or reopen.', reversible: true, side_effects: 'internal',
    params_schema: { type: 'object', properties: { slug, ids: { type: 'array', items: { type: 'string' } }, decision: { type: 'string', enum: ['accept', 'rework', 'descope', 'reopen'] }, note: str('why') }, required: ['slug', 'ids', 'decision'] },
    route: { method: 'POST', path: '/api/products/{slug}/triage' } },
  { name: 'policy.propose', description: 'Propose a scoped, expiring policy that lets the companion answer some GATED tools; only the person can grant it.', reversible: false, side_effects: 'internal',
    params_schema: { type: 'object', properties: { product: str('a slug or *'), tools: { type: 'array', items: { type: 'string' } }, maxTier: { type: 'number' }, hours: { type: 'number' } }, required: ['product', 'tools', 'hours'] },
    route: { method: 'POST', path: '/api/companion/policies' } },
  { name: 'wave.compose', description: 'Group findings into a draft wave of packages, each with a model and an effort.', reversible: true, side_effects: 'internal',
    params_schema: { type: 'object', properties: { slug, name: str('the wave name'), packages: { type: 'array', maxItems: 20, items: { type: 'object', description: '{ name, model: sonnet|opus, effort: low|medium|high|xhigh, ids }' } } }, required: ['slug', 'name', 'packages'] },
    route: { method: 'POST', path: '/api/products/{slug}/waves' } },
  { name: 'wave.dispatch', description: "Dispatch a draft wave: queue its packages' build jobs, which spend money and edit code.", reversible: false, side_effects: 'external',
    params_schema: { type: 'object', properties: { slug, wave: str("the wave's id"), packages: { type: 'array', items: { type: 'string' } } }, required: ['slug', 'wave'] },
    route: { method: 'POST', path: '/api/products/{slug}/waves/{wave}/dispatch' } },
  { name: 'release.draft', description: 'Create a draft release from shipped items.', reversible: true, side_effects: 'internal',
    params_schema: { type: 'object', properties: { slug, version: str('semver'), ids: { type: 'array', items: { type: 'string' } } }, required: ['slug', 'version'] },
    route: { method: 'POST', path: '/api/products/{slug}/releases' } },
  { name: 'release.build', description: 'Build a draft release: branch, PR and changelog on GitHub.', reversible: false, side_effects: 'external',
    params_schema: { type: 'object', properties: { slug, id: str('the release id'), dry: { type: 'boolean' } }, required: ['slug', 'id'] },
    route: { method: 'POST', path: '/api/products/{slug}/releases/{id}/build' } },
  { name: 'release.finish', description: 'Finish a release whose PR is open or merged.', reversible: false, side_effects: 'external',
    params_schema: { type: 'object', properties: { slug, id: str('the release id') }, required: ['slug', 'id'] },
    route: { method: 'POST', path: '/api/products/{slug}/releases/{id}/finish' } },
  { name: 'scan.gaps', description: 'Where coverage is lacking: unmeasured, stale, unknown or deviating features, ranked.', reversible: true, side_effects: 'none',
    params_schema: { type: 'object', properties: { slug, limit: { type: 'number' } } }, route: { method: 'GET', path: '/api/companion/gaps' } },
  { name: 'scan.place', description: 'Start a lens scan of a scope (feature, bay, room, wing or all).', reversible: true, side_effects: 'internal',
    params_schema: { type: 'object', properties: { slug, lens: str('a lens id'), scope: { type: 'object', description: '{ kind, id?, label, features }' } }, required: ['slug', 'lens', 'scope'] },
    route: { method: 'POST', path: '/api/products/{slug}/scans' } },
  { name: 'focus.show', description: 'Show the person a place: fly the view to a feature, room or wing, or open a decision, wave, release, ledger row or lens.', reversible: true, side_effects: 'none',
    params_schema: { type: 'object', properties: { product: str('the slug'), kind: { type: 'string', enum: ['feature', 'room', 'wing', 'decision', 'wave', 'release', 'ledger-row', 'lens'] }, id: str('the target id'), say: str('one short line shown with it') }, required: ['product', 'kind', 'id'] },
    route: { method: 'POST', path: '/api/companion/focus' } },
  { name: 'finding.decline', description: 'Decline one finding (a proposed change).', reversible: true, side_effects: 'internal',
    params_schema: { type: 'object', properties: { slug, id: str("the finding's id"), note: str('why') }, required: ['slug', 'id'] },
    route: { method: 'POST', path: '/api/products/{slug}/proposals/{id}' } },
  { name: 'memory.note', description: 'Keep one fact about the person or a project, citing the conversation it came from.', reversible: true, side_effects: 'internal',
    params_schema: { type: 'object', properties: { space: str('a product slug, or core'), kind: { type: 'string', enum: ['user', 'project', 'world'] }, text: str('the fact, one sentence') }, required: ['space', 'kind', 'text'] },
    route: { method: 'POST', path: '/api/companion/brain' } },
];

/** athena's rule (README 3.3), and decision 6: everything reversible and not external runs without asking. */
export const classOf = (t: Pick<ToolSpec, 'reversible' | 'side_effects'>): ToolClass => (t.reversible && t.side_effects !== 'external' ? 'AUTO' : 'GATED');
/** The name a tool travels under: MCP and athena take a slug, not a dotted name. */
export const wireName = (name: string): string => name.replace(/\./g, '_');
export const toolByWire = (wire: string): ToolSpec | undefined => TOOLS.find((t) => wireName(t.name) === wire);
