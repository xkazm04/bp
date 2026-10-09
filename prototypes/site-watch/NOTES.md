# The Drawing Set: Site Watch

## Philosophy
The swarm is the building crew; the drawing set is the site office. The plan never moves, a crew works on it. An agent is a survey mark orbiting its fixture. A question from an agent is an RFI pennant pinned where it was asked. A standing order is a general note, a dashed zone with a stamp; a breach is a red rivet where it happens. A mass command is an addendum: dashed arrows show which agents would move before anything is issued, then they travel along them. The chosen blueprint language, every component redrawn.

## How it stays readable at scale
- L0 draws no fixtures: each capability is one calm ribbon, and fixtures fade in at about 1.2–1.5× the building view. Five labelled wings carry aggregates, trouble, agent counts and questions waiting.
- Labels wait until they fit. The 12 px floor is measured on canvas and DOM at 1280, 1920, 2560 and a short 650 px window, where the bottom bar folds to one row.
- The breadcrumb names the container with the largest visible share, so it never names a room you are only passing.
- `?scale=4`: four buildings, 528 features, swarm cloned per building.

## The wow moment
The building draws itself left to right in the order work began, then the crew arrives. Within ten seconds: bars say 69 of 132 are live, mint marks show 19 agents working, amber rings 18 waiting, and pennants show which rooms hold one of the 25 questions. Press 60× and a simulated hour ripples across the plan in a minute.

## Moments
**Best:** morning watch (briefing, per-person queue, one-click accept, undo); steering a push (Payments GA first: preview, commit, agents travel); the glance; one feature; what changed; release readiness.
**Badly:** blast radius under stress (pick the source first); Sam's 20 seconds (long sheet, dense dock); projector review below room level; phones get the queue and a list, not the plan.

## Known limits
- Simulated swarm; the clock runs forward only, ↺ restarts the hour.
- Order breaches are derived from product data by rules, cut to the counts in swarm.js.
- Choosing a person sets the lens. With a decision card open, 1–3 answer it.
- Narrow wings drop their letter bubble in very short windows.
