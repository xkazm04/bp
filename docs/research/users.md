> User analysis written before the design contests (2026-10-08), extended for the swarm round. It
> describes people, moments and questions, not screens. References to `data/…` mean the contest
> staging folder; in this repo the data is `src/data/` and the swarm schema is `docs/fixtures/kettle-sample.md`.

# Who opens the blueprint, when, and what they need from it

This is the user analysis behind the brief. Read it before you design. It describes people,
moments and questions. It does not describe screens: those are yours to invent.

## The situation

A small company builds **Kettle** (booking, memberships and payments for independent fitness
studios) mostly with autonomous coding agents. Four build agents, a review agent and an ops agent
open pull requests around the clock. Eight humans supervise them, each from their own field. The
product has 132 features across 13 domains, and their state changes **daily**, not quarterly. A
feature can go from idea to production behind a flag in four days.

The humans have lost the picture. Nobody can say in one sentence what the product is today, what
is real and what is promised, or where it is fragile. Tickets, PRs, dashboards and flag consoles
each hold one slice. The blueprint should become the one place where the whole product is
visible as a structure, and where each person sees that same structure through their own lens.

## The people

| Person | Field | How often | Time they give it | The question they arrive with |
|---|---|---|---|---|
| Mara | founder, business | weekly, plus before investor and customer calls | 2 minutes | "What do we actually have? Are we making Payments GA on Oct 22? What can I show?" |
| Dev | product lead | several times a day | 5 to 15 minutes | "What moved since this morning, what is stuck, is effort going where value is?" |
| Tomás | engineering lead, supervises the agents | daily, first thing | 10 minutes | "What did the agents ship overnight, what has nobody reviewed, where are tests thin?" |
| Priya | SRE / operations | daily, and during incidents | seconds during an incident, 10 min otherwise | "What is in production, at what rollout, is it healthy, is it watched, what breaks if X breaks?" |
| Jonas | security and compliance | weekly | 10 minutes | "Which features touch card or personal data, and which of them skipped a security review?" |
| Lea | design / UX | a few times a week | 5 minutes | "What shipped without design, what fails accessibility?" |
| Sam | customer success and sales | during customer calls | 20 seconds, while talking | "Can a studio do X today? When is Y coming? Is it switched on for them?" |
| Ines | QA | daily | 10 minutes | "Where are the failing tests and open P1 bugs, and what is about to ship untested?" |

Sam and Mara are not engineers. They must never have to read an engineering term to get their
answer. Tomás and Priya want the evidence underneath (coverage numbers, error rates, PR counts),
not an adjective.

## The moments of use

1. **The glance (5 seconds).** Opening the blueprint answers: how big is the product, how much of
   it is real, is anything on fire, did a lot change. If the glance needs a click, it failed.
2. **Putting on my lens (under a minute).** Priya switches to operations and the same map now
   speaks her language. Nothing moves when the lens changes: the payments corner is still the
   payments corner. The places on the map are the vocabulary the team uses in meetings
   ("the waitlist thing in the booking block").
3. **Opening one feature (2 to 5 minutes).** Every dimension of one feature in one place: what it
   is in plain words, its stage, who or which agent built it, whether a human reviewed it, tests,
   rollout, health, data sensitivity, business value, what it depends on and what depends on it,
   and what happened to it recently. The way back to the map is obvious.
4. **The weekly review (30 minutes, screen-shared).** Eight people look at one screen, often on a
   projector. The host walks domain by domain and switches lenses as each person speaks. It must
   read at a distance and look good enough that nobody is embarrassed to share it.
5. **Finding one thing (10 seconds).** "Do we have gift cards?" Type, land on it, see its stage.
6. **What changed (1 minute).** Since yesterday, since last week: what was born, what shipped,
   what got stuck, what broke. With agents working overnight, this is the most frequent question.
7. **Blast radius (seconds, under stress).** The background job queue is degraded. Which features
   depend on it, and which of those are live for customers?
8. **Release readiness (5 minutes).** Payments GA is in 14 days. Which of its features are done,
   which are not, what is blocking them, and is anything done but unsafe?
9. **Showing the product outward (the founder).** An investor or a prospective customer sees the
   product as a whole: its shape, what is live, what is coming. This is where beauty pays.

## What the analysis says the design must respect

- **Structure and state are different axes.** The structure is domain, then capability, then
  feature. The state has two parts: the lifecycle stage (idea to live) and the health of each
  dimension. "Live" does not mean "healthy". A design that merges them hides the most important
  facts.
- **The baseline is for everyone; the lenses are for each field.** Everyone should share one
  default reading (how much is implemented, how much is pending, where the trouble is). Each lens
  then re-encodes the same places for one field: business, product and design, development,
  operations, security, quality.
- **The value is in the tensions between dimensions.** The facts that need people from two fields
  to talk are the ones the blueprint exists to surface. In the data, for example: a P0 feature
  nobody has started; a payments feature built by an agent, live at 25% rollout, that no human has
  reviewed; a live feature with no alerting; a feature sales is asked about weekly that sits in
  "specified". A single-lens view cannot see these.
- **Spatial stability is sacred.** Lenses, filters and time travel change what the places say,
  not where the places are.
- **Agents are actors.** "Built by an agent, reviewed by nobody" is a state the team cares about
  as much as "in progress". Who did the work, and whether a human has looked, belongs on the map.
- **Change is first-class.** At this pace a static snapshot is stale by lunch. The design should
  make recent change visible without a separate log screen being the only way to see it.
- **Scale is real.** 132 features, 13 domains, 29 capabilities, 200 dependencies, 6 lenses. All
  of it present at the overview; domain and capability names readable at 1280x800 without
  zooming; feature names legible on approach. Not a 132-row table and not a dependency hairball.
- **Plain language at the top, evidence underneath.** The first layer reads like a product, the
  deepest layer reads like an engineering report.

## Watching and steering the swarm (added for this contest)

The six named agents in `kettle.json` lead **crews**. Behind the blueprint a swarm of **42 agents
in 8 crews** works at all hours: building, reviewing, operating, researching, scanning
(`swarm.js`, described in `SCHEMA.md`). Nobody here manages agents one by one; there are too many,
and they move too fast. Each human **watches the product being built** and **steers it from their
own field**:

- **Watching.** Where is the swarm working right now, and on what? Which places are hot, which are
  stalled, which are waiting for a person? The structure stays still; the work moves over it. A
  glance should show where activity, waiting and failure are, at every zoom level, without making
  the plan unreadable.
- **Targeting.** The human points at a place (a wing, a room, a bay, one feature, or a selection
  across them) and acts on it as a whole: look closer, ask "what is going on here", pause or
  resume the agents there, raise or lower its priority, or put a standing order on it.
- **Deciding.** Agents stop and ask when something is the human's call. There are 25 open
  decisions today, each tagged with a lens and with the person who should decide it. Each has 2 or 3
  options with consequences, the agent's recommendation, how long it has waited, and how many agents
  it blocks. Jonas should see his 5 security decisions on the plan, where they sit, without reading
  Mara's 7 business ones. Deciding should take seconds, in place, with the consequence visible on
  the structure.
- **Standing orders.** Humans give the swarm rules scoped to a place or to everything ("anything
  touching card data needs a human security review before 10%"). Orders are visible on the places
  they govern, and a violation is visible where it happens.
- **Mass control.** One person's one action can redirect dozens of agents ("Payments GA first: pull
  agents from M3"). Before committing, the person should see what that action will move, and
  afterwards see the swarm respond.

Each person's lens is their **control surface**, not only their reading filter: the lens decides
which decisions, orders and signals rise to the top for that person. The moments above still hold.
Two new ones join them:

10. **The morning watch** (any of them, 5 minutes). *"While I slept, what did the swarm do, and
    what is waiting for me?"* They see their queue of decisions on the map, decide most of them in
    place, and leave.
11. **Steering a push** (Mara or Tomás, 15 minutes). *"Payments GA is in two weeks. Put the swarm
    on it."* They target the Money wing, see the agents and work there, give an order that pulls
    crews from elsewhere, and watch the plan respond over the next hour.

## What it is not

- Not a ticket tracker or kanban board. Humans do not write or move tasks here. They watch, decide
  and give orders; the agents turn those into tasks. (This replaces the earlier "reading
  instrument only": see *Watching and steering the swarm* above.)
- Not a dashboard of charts detached from the structure. A number that cannot be located on the
  map is a number nobody acts on.
- Not a data-model exercise. The owner has no schema requirement; the staged data is one plausible
  shape, and a design may derive, aggregate or ignore fields.
