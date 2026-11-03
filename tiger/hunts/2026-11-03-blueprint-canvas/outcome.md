# Outcome - 2026-11-03 blueprint canvas

Run branch `tiger/blueprint-canvas`. Gate `npm run check`: 135/135 at baseline, then 138/138 after lanes A+B merged, then 141/141 after lane C (exit 0).
There was no browser run: `next build` cannot run from a worktree whose `node_modules/next` is a junction into the main checkout. perf.py was not run.
Every verify check below ran in Node, through the engine stand-in (`scripts/lib/engine-dom.ts`), and the caller re-ran each one itself.

| item | commit | verify | result | notes |
|---|---|---|---|---|
| C1 Fresh trouble index | 1af38d7 | `check:trouble-index` | landed: "10 expectations held (X = apple-sign-in under operations)". Failed 4/10 on the old engine | It also fixed the same stale memo in the Plan list groups and the title-block bad count |
| C2 Spoken walk and trouble route | d9a045d | `check:place-words` | landed: "29 expectations held". N visits all 79 troubled Kettle features once, in walk order; ArrowRight ×2 changes the region twice | Tab access to individual tiles (from P02) was not built; the route has no on-screen indicator |
| S1 Steps know proposals | 6c206c9 | `check:clear-cover` | landed: "15 expectations held" | On Kettle, 166 steps: 162 uncovered, 2 clear, 1 delivered, 1 short. The chips do not link to proposals; there is no "Propose a fix" button (as scoped) |
| C3 Health on past dates (core + page) | eabd2e9 | `check:timeview` | landed: "138 expectations held" | **Premise moved:** bp's own store can replay 0 of 147 pairs, because built-in lens rules read hand-judged fields that have no history. The owner chose to build the engine half anyway |
| C3 engine half | 2026478 | `check:replay-flags` | landed: "14 expectations held"; bp store at 2026-10-30: 0 replayed pairs, 0 flags | Pays off only for metric-only lenses until judged fields get dated readings |
| S2 Compare two dates | ad72cce | `check:compare` | landed: "18 expectations held" | Key A pins the baseline; the hash carries `cmp=`. Marks are drawn on tiles only, not on ribbons |
| L1 Readiness anywhere | 326813e | `check:readiness` | landed: "16 expectations held"; fixture "1 of 5 clear · 1 unproven · 3 steps, 1 covered, 1 short · 1 blocked" | Evidence age is fixed at 30 d. A good pair with no dated reading counts as clear but is counted separately. No numbers on labels or flags |

Found while building, not items:
- The test JSX loader (`scripts/overlays-loader.mjs`) produces broken code when a JSX attribute holds a long arrow function (lane B; worked around, not fixed).
- `scripts/check-engine-harness.ts` keeps its own copy of the Node stand-in browser and could share `scripts/lib/engine-dom.ts`.
- Under a lens, a room's sentence can say "in trouble" twice.
