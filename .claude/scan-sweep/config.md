---
contextMap: context-map.json
memoryOutbox: .claude/scan-history/findings.jsonl
backlogDigest: .claude/scan-history/backlog-digest.json
openBacklogs: .claude/scan-history/open-backlogs.jsonl
depth: 5
neverSweep: []
---

# scan-sweep overlay - bp

Read by `/scan-sweep` (ai-registry `skills/scan-sweep/SKILL.md`, "Project overlay"). Scaffolded 2026-10-09.

## Gates

always:
- `npm run typecheck`
- `npm run check:lens-health`

when the app-structure fixture or schema changes:
- `npm run validate:structure -- src/data/kettle.app-structure.json --events src/data/kettle.events.jsonl`

when rendering, the engine or chrome changes:
- `npm run build` (never while a `next dev` runs in the same directory)
- `python scripts/perf.py` (needs a running server; budget 60 fps at `?scale=4`)

## Repo law

- `docs/blueprint-ui.md` is the UI contract: 12 px text floor (body 14 px), spatial stability (expanded chrome overlays the plan), lenses are data (never branch on a lens id), keyboard throughout, reduced motion honoured.
- Design tokens are the CSS variables in `src/components/blueprint.css`; no raw colours in components or css.
- Kettle `/`, the live product `?product=<slug>`, `?scale=4`, `?theme=light` and the three variants `/v/subtle|shaped|bold` must keep working.
- Next allows one `next dev` per directory.
