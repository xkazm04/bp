# The ledger's fidelity contract

The findings ledger's release train is a port of the contest winner A/1 (release-manager, `claude-opus-5-5` variant-1),
chosen by the owner for its compare panel, its table and pack rows, and its "space efficiency, styling approach and
typography strategy". These files hold the port to that winner: its computed type, surface and density, role by role,
and its named interactions in a browser (the contest skill's promotion step, `references/promotion.md`).

| file | what |
|---|---|
| `roles.json` | scene `item`: page, tabs, filters, table, pack row, item row, marks, the compare panel, the bars (Athena, p-c02a61 open) |
| `roles-table.json` | scene `table`: the table at full width, compare closed |
| `roles-perf.json` | scene `perf`: the performance table (the winner's sample-perf-1 against Kettle's k-perf-1) |
| `contract*.json` | the winner's measurements per scene (`contract.py capture`; re-capture only when the winner changes) |
| `contract.py` | runs the contest's `style-contract.py` per scene, with one change: a bp page loads to `domcontentloaded` (bp never reaches `networkidle`: the live stream is a held EventSource) |
| `drive.py` | the interactions, asserting on what the product writes: J/K, X, A, R with a note, U, the slider drag, L, M, Esc in layers on Kettle; read-only navigation on Athena |

## Re-run

```
npx next dev -p 3321 -H 127.0.0.1                     # from the bp root, in its own shell (loopback only)
python scripts/fidelity/contract.py check --port 3321  # every scene: 0 deviations, accepted departures listed
python scripts/fidelity/drive.py --port 3321          # every interaction PASS; exit 1 on a FAIL
```

Both need Python Playwright (`pip install playwright && playwright install chromium`), the winner under
`.contest/` (git-ignored: a local checkout of the contest) and the contest skill at `../ai-registry/skills/contest/scripts`
(`CONTEST_SCRIPTS` overrides). Stop the server by its PID and delete the `AGENTS.md` that the dev server writes.

Every scene measures at 1600x800, where bp's UI scale is 1 (Engine.fit scales the UI by
`1 + 0.5 * (clamp(min(w / 1280, h / 800), 1, 2) - 1)`: 1.0625 at 1600x900, which would read every width 6% wide).

## Rules

- A deviation is either real (fix the port) or structural (the same thing under different markup: fix the selector and
  say so in the role). Never widen a tolerance.
- `"accept": [...]` on a role lists a departure from the winner by property, with its `"why"`. Owner-accepted: the 34 px
  table head (A/1's 66 px was its page header's rule leaking onto the row; drive.py asserts the 34) and bp's UI scale
  (measured away, above). The other accepts say in their `why` that they are structural or data and wait for the Director.
- Athena is live data: the contract and the drive only read it; drive.py fails if anything but a GET reaches its routes.
