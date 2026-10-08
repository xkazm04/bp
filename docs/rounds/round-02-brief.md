# Round 2 brief

Built from the client's answers to the round 1 questions (see `round-01.md`).

## Decisions

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Direction | Two competing directions, both in the **Orbit visual identity**: (a) **Cyanotype's structure**, a nested containment map that opens like Google Maps (domains with state first, then modules, features and detail as you zoom); (b) **Atlas**, the practical card tree. |
| 2 | Lenses | The Overall view is the start. Each lens is a role with its own **rating**, built on metrics: **Overall** (exec health); **Development** (code quality, bugs, test coverage); **Operations** (monitored or not, error rate, uptime, performance against SLO); **Business** (live features rated against their open backlog, all green when it is empty). Ratings depend on what a node is; for example, an API feature has no UX rating. **Initiatives** add filters: permanent ones (legal compliance scan coverage) and temporary ones (a large refactoring, a scan campaign). |
| 3 | Positions | **Fixed positions**, so people can memorise the map. Nothing re-sorts by lens or filter. Items that don't match fade (transparency), and nothing moves. |
| 4 | Human gates | Work comes in three ways: a user writes a goal, an item syncs from the ticketing system, or an automated scan creates a finding. Scan findings can first wait for **human triage** before they enter the backlog. Development happens in **branches**, and one feature can have several branches doing different work. Each branch is **approved by a human** based on a demo or a report. |
| 5 | More lenses | **Security, Compliance, UX and Cost** join the four role lenses. |
| 6 | Time | A **Timeline** as a second view: delivered content and release packages over time. |
| 7 | Scale | One canvas is one product. Designs must work at **2–3× the domains and about 500 features**, so nesting has to be smarter. |
| 8 | Handles | Features are identified by **title**, with no codes or symbols. |
| 9 | Theme | **Light by default**, with dark supported. |
| 10 | Truth and evidence | Agents write into the blueprint; webhooks come later. Evidence is stored. The lowest level, a feature, opens a **full-page detail** with an overview of its state in every lens, plus a **ledger** tab: an audited table of recent activity that serves as evidence. |

## Round 2 variants

| | Direction | Variant | Map shape | Timeline design |
| --- | --- | --- | --- | --- |
| A | Plan | **Orbit Plan** | Cyanotype's floor plan, faithfully redrawn in Orbit: areas are wings, domains zones, modules rooms, features fixtures | Phasing: a release ribbon, with the plan tinted by delivery phase |
| B | Plan | **Orbit Territories** | A hex-cell territory map: each feature is a cell, modules are clusters, domains regions, areas continents | Time-lapse: a scrubber that replays the map growing release by release |
| C | Atlas | **Orbit Atlas** | Atlas's left-to-right card tree with map-like progressive disclosure, and no re-sorting | Release swimlanes: domains as lanes, releases as columns |
| D | Atlas | **Orbit Columns** | A top-down column tree: domain columns side by side, module cards stacked, features as rows | Release stack: time runs down while the domain columns stay in place |

## Shared foundation

- Data model v0.2: `docs/data-model-v2.md` (generated mock product, about 500 features, eight lenses, gates, branches, ledger, releases and initiatives).
- Orbit kit: `docs/orbit-kit.md`. It provides the shared tokens, the app shell (lens bar, filters, gates, search, view switch, theme), the inspector, and the full-page feature detail. Each variant designs only its map and its timeline, so the comparison is about shape.
