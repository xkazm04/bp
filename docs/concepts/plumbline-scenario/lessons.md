# Plumbline scenario - lessons for bp and the skills

One entry per finding: what happened, the bp or skill change it asks for, and its status. A finding seen twice is promoted
into the spark overlay's `## Gates` or `## Repo law` (that is the method's own rule).

| # | Date | Phase | Finding | Change asked for | Status |
|---|---|---|---|---|---|
| L1 | 2026-11-17 | P0 | A Windows repo that hashes raw files (a lock, a vendored runtime) drifts under `core.autocrlf`; bp's repo law covers CRLF in regexes, not in hashes. Plumbline needed `.gitattributes eol=lf` from its second commit. | `/adopt-bp` and the spark overlay: when a product hashes raw files, check for `.gitattributes` first. | proposed |
| L2 | 2026-11-17 | brainstorm | A contest or market target needs an evidence scout of the LIVE entrants before the brainstorm. The brainstorm's first pick was already built twice (Agent Atlas, Agent Customs), found only after four waves because the spark's scouts read code, not ecosystems. It cost two re-asks of the owner. | `spark` Phase 2: when the target is a contest, market or standard, scout the live entrants or incumbents (read their source, not their blurb) before wave 1, and put what they already cover into the question options. | proposed (first sighting) |
| L3 | 2026-11-17 | brainstorm | A fetched digest of a spec said "no validator exists"; a competitor's own page showed one did. A subagent's absence claim is a hypothesis. | `spark` scouts: an absence claim ("no X exists") is checked against one live counter-example search before it shapes a question. | proposed (first sighting) |
