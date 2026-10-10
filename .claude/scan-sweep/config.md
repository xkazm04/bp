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
- `npm run validate:structure` (no arguments: validates the lens manifests and the spec examples)
- `npm run check:fixtures`
- `npm run check:scan-wire`

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
- A worktree with a `node_modules` junction runs the node gates but not `next dev` (Turbopack panics on the junction); a worktree that needs a browser runs `npm ci`. `next dev` writes AGENTS.md and rewrites next-env.d.ts: never commit either.

## Skill improvement log

- 2026-10-10 optimize wave 1: the manifest gate (`validate:structure` without arguments) was missing from `always`, so a deliberately broken lens manifest passed every gate (standard round, Lane C). Added, with the two new checks.
- 2026-10-10: in git-bash, `cmd //c mklink //J a C:\x` loses its backslashes and links nowhere; quote the whole command (`cmd //c 'mklink /J a C:\x'`). Worktree gates then silently resolved packages from the parent checkout.
