# How the design was chosen

The UI came out of three blind design contests between AI agent seats, judged by the owner in a
browser, followed by three lens variants built in this app. The owner's words are quoted verbatim.
The full contest archive (every variant, screenshot and scoreboard) is kept outside this repo.

## The pillar

> Canvas-like UI representing software product as blueprint/tree of domain and features, aiming to
> become visually excellent and well readable vehicle to communicate current product features,
> implemented or pending, breakdown features into dimensions so we see as baseline overall state,
> but filterable/broke down dev, ops, business features applying different layers/lenses similarly
> to architecture blueprints. Need is to control rapidly automated developed apps by AI, where
> multiple users can check state and manage from their field of expertize. There is no theme
> guideline or requirement for data schema - we need to find path for clear/beuatiful/practical
> visualization shape and rest of the solution may follow in later phases.

Before any design, a user analysis was written: eight people, nine moments of use, and the
principles a design must respect. It is in `docs/research/users.md`.

## Round 1: four concepts (2026-10-08)

Concepts: a drawing set with domains as rooms, a star atlas, a planting plan, and a plan set of
feature cards. The run was cut short, so the field was partial.

> I would avoid galactic/star system. A/1, A/3, B/1 are on good direction. The nested layering will
> need larger breakdown: L0 will need figma/google map approach to display abstract high level
> sections on first sight, and expand nested layers on scroll to there. Otherwise the UI cannot
> scale much more and keep clarity - designs are then force to overhaul UI with small text to keep
> nice design but realistically unreadable content. Consider tree approach of one variant instead
> of galactic so we can operate canvas in chronological structure from left to right instead of top
> to bottom

**Rules that came out of this round**
- Semantic zoom from L0 to L4, like an online map.
- A 12 px text floor.
- Left-to-right chronology.
- `?scale=4` (528 features) as the scale test.

## Round 2: refinement (2026-10-08)

Four refinements:
- the drawing set, extended to a site of wings;
- a left-to-right growth-line tree;
- the plan set;
- the planting plan.

**Winner: the drawing set** (now in `prototypes/drawing-set/`).

> Lets use D/1 as baseline and execute 2nd contest with attempt to visually perfect the baseline
> concept. Some can achieve different theme for each len, some can redesign components, typography
> and color pallette completely. [...] Imagine behind blueprint swarm of agents works and user just
> watches, targets places to decide and control this way mass development of whole project from his
> expertize len

## Round 3: the swarm round (2026-10-09)

Six variants built on the drawing set: perfected versions, a theme per lens, and full redesigns.
Each added a simulated agent swarm, decisions waiting for a person, standing orders, and mass
steering.

**Winner: "The Drawing Set: Site Watch"** (now in `prototypes/site-watch/`). It was ported into this
Next.js app.

> A/1 is the baseline winner, with difference each len won't color nodes but can reshape the
> rectangels or use different icons for indicators. I see the General view has most clarity and the
> difference between lenses need to be subtle yet noticable. A/2 did interesting job to retheme each
> len but at cost of readability. It also did not catch difficulty differences as artboard for
> example may leverage simplier interface then dev technical people in Terminal
>
> Another challenge is in seamless transition between layers, in best case General is composition
> of all lenses, switching from general to any len will create seamless transition where only
> specific len remain.
>
> B/1 is infferior but blazing fast as it is more simple than A/1, it serves as good reminder to
> 'give it all' to performance optimizations, preventing unncessary re-rendering on zoom and movement
>
> Create light theme as secondary option to see how roughly inverted color choices would look like
>
> We can leave html/css space and scaffold NextJS app to master the UI there with all animation and
> performance techniques we can get from the stack or framer motion. Prototype 3 variants there with
> ranges of how to express lens differences - from most subtle patterns into more aggressive design
> differences, keeping still blue/white primary color pallette but involving content change, use of
> secondary colors and decorative elements

## In this app: three lens expressions (2026-10-09)

The three variants were `subtle`, `shaped` and `bold`. They are still at `/variants`.

> V01 subtle works best.

`subtle` became the home route. The data model was then standardised as app-structure v3
(`docs/standard/`), so the same format can serve Personas and the blueprint. In v3, lenses are
plugins.

## Open

The design and the product are far from final. The vision will be reworked in the next sessions.
