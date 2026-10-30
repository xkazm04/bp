# One morning, with memory: the fused Blueprint and the sessions after it

Written 2026-10-30, while the fusion is being built. This is the plan for the sessions that follow the hackathon
`bp-sync-1029`. It is not the as-built record: that is [`../one-morning/README.md`](../one-morning/README.md) (e3) and
[`../decision-brief/README.md`](../decision-brief/README.md) (e2). The Personas detail is in
[`personas.md`](personas.md).

Line numbers in bp files are at the fusion merge `2ea1c1e`. The fusion is still editing `morning.ts`,
`morning.server.ts`, `MorningWatch.tsx`, `FollowHost.tsx`, `trail.ts` and the demo scripts, so their numbers will
shift. The symbol named beside each citation is the stable reference. Personas paths are in the reference tree
`C:/t/hk-bp-ref-personas` at `ad40fcfa10`.

## The decision

- **The hackathon.** Track "one perfect Blueprint product synchronized across bp and Personas". The owner's winning
  moment is **"steer, not operate"**: I manage development by deciding, and agents carry out the rest under my eye. There
  were three entries, all with `npm run check` green and every demo step passing or partial (host demo pass,
  `.hackathon/arena/bp-sync-1029/host-notes.md` in the main checkout).
- **The verdict (owner).** Fuse e2 into e3 as one experience.
  - e3, "One morning, one place", is the base.
  - e2, "Decisions with memory", is absorbed.
  - e1, "Rules you set once", is dropped. Its branch `hackathon/bp-sync-1029/e1` is kept (section 7).
- **The fusion branch.** `hackathon/bp-sync-1029/fuse-morning-brief` in `C:/t/hk-bp-sync-1029/e3`. When this was written,
  its head was `2ea1c1e`. That commit merges e2 (`e975886`) into e3 (`a2a1596`), and both conflicts kept both sides
  (`plan.brief` and `morning.brief` sit side by side in `catalog.ts`). The card-level fusion was still being built. Every
  item the fusion attempts tonight is marked **verify, else do** below.

## 1. What the fused product is

Every morning the owner opens one deck, the **Morning Watch**, that briefs the whole portfolio of agent-built products:
what agents built overnight, whether yesterday's releases moved the number they promised to move, and the top decisions
waiting. Each decision card carries a **brief**, which covers four things:
- what the change touches;
- how the owner decided the same or similar ideas before, with the owner's own decline notes quoted back;
- whether it can be undone;
- what it costs to build.

When a proposal is the same idea the owner already declined, the card recommends Decline, and one key takes it. As each
card is read it becomes the **shared focus**, so every other screen goes to the same place and shows the line being
read: a second window, the phone, the VR light table, and later Personas. Agents read the same morning and the same brief
through bp's MCP door, and the morning tells the owner what the agents read and what they withdrew. The owner decides,
the agents carry out the work, and every screen stays on the same place.

### Surfaces and doors

| Surface or door | What it does | Code (fused tree) |
|---|---|---|
| Web deck | **M** opens the Morning Watch docked left: `→ ←` to move, **A**pprove / **D**efer / **H**old, **V** for the browser's voice. Each card frames its place to the right. A card in another product opens it in place, with no reload | `apps/web/src/components/focus/MorningWatch.tsx`, `packages/core/src/companion/morning.ts`, `packages/core/src/server/api/companion/morning.server.ts` |
| Decision brief (web) | The brief on the plan's decision card, Review, the feature page, the phone and Kettle's questions. Each number opens its evidence. A repeat of a decline recommends Decline (Enter), and the note names the decision it repeats | `packages/core/src/scan/brief.ts`, `apps/web/src/components/Brief.tsx`, `Overlays.tsx`, `rail/wide/review.tsx`, `Phone.tsx` |
| Follower | The chip "Following Web, 2 s ago", with Stop / Follow, and the leader's line as a lower third. `?follow=1` follows on load | `apps/web/src/components/focus/FollowHost.tsx`, `apps/web/src/lib/focus/shared.ts` |
| Phone | The clicker: the deck runs full screen and leads, and the desk follows | `MorningWatch.tsx` (under 760 px) |
| Shared focus | A leader-less record of readers. The newest publish is the shared place. Echo rules stop surfaces fighting over it | `packages/core/src/session/focus.ts`, `server/api/session/focus.server.ts`, `GET/POST /api/session/focus`, `event: shared` on `/api/companion/stream` |
| VR table (UE) | BpLink follows at 1 Hz as `vr:table`. The table eases into the room, and "Following Web" shows on its rim. Moving the table by hand publishes | `apps/vr/Source/BpLink/Private/BpLink.cpp:768-1108`, `apps/vr/Source/bp/BpFollow.cpp` |
| Headless stand-in | Follows over the real stream. `--personas` plays Personas' Monitor | `scripts/focus-standin.ts` |
| MCP door | `morning.brief` reads the deck. `plan.brief` reads a brief before proposing. `focus.show` moves every follower. `decision.recommend` carries the brief and flags a conflict | `packages/core/src/companion/catalog.ts:62-66`, `apps/mcp/bp-mcp.mjs` |
| Agent trail | The cards slip: "Was about to propose X; read your decline Y; withdrew it" | `packages/core/src/companion/trail.ts`, `server/brief.server.ts:52-87`, `apps/web/src/components/companion/AgentTrail.tsx`, `GET /api/companion/trail` |
| LAN door | The `focus` scope, which pins a device to reader `vr:<device>` | `apps/server/src/lan-door.ts:69,112-113` |
| Steering log | One row per verdict in `<root>/.ai/lens-scan/work/steering-log.jsonl`, rendered as that day's `steering-log.md` | `morning.server.ts:26-27,115` |

### Mechanisms, said plainly

None of the behaviour below calls a model. It is all rules and templates.

- **The Morning Watch is a templated synthesizer.** `morning.ts` builds the deck from fixed sentence templates over each
  product's real lens-scan store and map. A release item counts as confirmed only on a reading taken after the release
  that meets its expected value (`scan/track.ts`).
- **The brief's "you declined this before" is word-set identity, not understanding.**
  - **Flips.** A card flips to Decline only on identity:
    - the attempt chain;
    - the same external item;
    - the same proposal filed again on the same feature, meaning identical idea words with numbers counted and never an
      opposite.
  - **Asks.** Likeness and a shared standard only ask: the quote is shown in amber, and Approve stays the default.
  - **Why.** Three independent reviews in e2 showed that every likeness rule also matched different changes.
  - **The cost.** A re-worded repeat is missed. It asks at most (e2 `HACKLOG.md`, 01:44).
  - **Cost.** The cost line is the median minutes per item of past execute runs.
- **The shared focus is last-writer-wins with echo suppression.** There are no locks:
  - the server makes no rev for the place already shared;
  - a reader never applies its own write;
  - a page that just flew somewhere hushes for 2.5 s.
- **The agents in the demo are scripts.** `scripts/brief-agent-demo.mjs` follows three fixed rules. `scripts/morning-agent-walk.mjs`
  is a scripted walk. Both drive the real MCP door.

### Real, synthetic and stand-in (from both DEMO "Real vs stubbed" sections and the host notes)

| Class | What |
|---|---|
| **Real** | The shared-focus record, its rules and events. The synthesizer over real stores and plans. Approve through bp's own `decide`, and the steering log. The brief, both GET routes, `plan.brief` and `morning.brief` on the door. The recommendation flip with its repeat note written to the store. The agent trail and the cards slip. The followers' flights and the in-place product switch. The VR follower and publisher in C++, built on the host's UE turn (commits `e0c9ecb`, `98639a7`). The LAN `focus` scope. The schema `decision-brief-1` and its generated `FBpDecisionBrief`. The gates `check:shared-focus`, `check:morning-watch`, `check:morning-cursor` and `check:decision-brief` |
| **Synthetic, labelled** | The three products (Kettle Web, Kettle Phone, Kettle Front Desk) are copies of the Kettle map, with a night written by `scripts/morning-demo.mjs` (run note "morning-demo: synthetic overnight activity"). e2's decision history comes from `scripts/brief-demo-seed.mjs` (rows `brief-*`) |
| **Stand-in** | `claude` is fake-claude. `gh` is fake-gh, which signs `user:morning-demo`. The agents are the two scripts named above. The headless VR table and the Personas Monitor are `scripts/focus-standin.ts`. The voice is the browser's `speechSynthesis`, not the lamp's paid voice. The `/crossing` VR card showing the brief is labelled mock |
| **Not built** | All of Personas: the adoption notes only. The brief on BpLink's card: the data side is ready, the C++ is not, unless the fusion lands it tonight. The VR captures show the Kettle *sample*, not the morning-demo products (host notes) |

## 2. The follow-ups, identified and merged

The sources are:
- e2 and e3: their "What I would do next" lists, their "not built" and dropped items, and their two Personas notes'
  "what bp would add";
- the host's demo pass and its "outside the entries" notes.

Duplicates are merged into one row. **Origin:**
- e2, e3: from that entry;
- fused: arises from putting them together;
- demo pass: the host's Playwright pass;
- host: the host's other notes.

**Size:**
- S: under half a session;
- M: half a session to one session;
- L: more than one session.

**Tonight** marks what the fusion branch is attempting now: the next session verifies it, and builds it if it is absent.

### A. The fusion itself (tonight: verify, else do)

| # | Follow-up | Origin | Size | Files | Tonight | Session |
|---|---|---|---|---|---|---|
| A1 | Morning decision cards carry the brief (touches, precedent with the quoted decline, undo, cost) on the web deck, the phone and the follower's lower third | fused | M | `companion/morning.ts` (`MorningCard.decision`, :45), `morning.server.ts` (the map through `loadMap` → `briefMapOfStructure`, as `brief.server.ts:29` does), `MorningWatch.tsx`, `FollowHost.tsx`, `Brief.tsx`. **Constraint:** `place.say` is at most 280 characters (`focus.ts:80`), and a place carries no proposal id, so the 5 × 120 brief cannot ride on `say`. A lower third shows the headline plus one line, or the place gains a card reference (a wire change, so it goes to S2) | yes | S1 |
| A2 | A repeat of a declined idea adds a recommended **Decline** key on the deck | fused | S-M | `MorningWatch.tsx:25` (`KEYS`): **D** and **N** are already Defer, so Decline needs another key. Personas' decline key is `x` (`ProposalCard.tsx:21`). While this was written, the fusion's working tree had added `x: 'decline'`; verify it. `morning.ts:19` (`Verdict` gains `decline`). `morning.server.ts:83-101`: today only Approve calls `decide`. `brief.ts:302` (`repeatNote`). The steering-log row | yes | S1 |
| A3 | The morning summarises the agent trail (the decisions agents read, the proposals they withdrew) | fused | S-M | `morning.ts` (the open or close card), `trail.ts:30` (`trailSessions`), `brief.server.ts:78` (`readTrail`). The trail is written by the process that served the agent and read by the one serving the page, so a shared `BP_HOME` is required | yes | S1 |
| A4 | `morning.brief` carries each decision's brief for agents | fused | S | `catalog.ts:65-66`, `GET /api/companion/morning` | yes | S1 |
| A5 | One demo seeds both | fused | S-M | `scripts/morning-demo.mjs`, `morning-up.mjs`, `brief-demo-seed.mjs`. e2's seed goes through `scan-demo.mjs`, which registers in `bp.products.local.json`. e3's demo never touches that file (`BP_PRODUCTS_FILE`). Keep e3's rule | yes | S1 |
| A6 | BpLink's table decision card draws the brief | fused, e2 | L | Section 4 | if the UE turn allows | S4 |

### B. Demo-pass findings (host notes)

| # | Follow-up | Origin | Size | Files | Tonight | Session |
|---|---|---|---|---|---|---|
| B1 | At **M** the follower's chip reads "Following whoever moves", not "Following Web", until the first arrow. The open card has no place, and `followingWords` falls back when nothing is shared | demo pass | S | `focus.ts:181-188`, `MorningWatch.tsx`. Publish the site place on M, or say whom it waits for | no | S1 |
| B2 | Step 3: the tile "confirmed · measured 190" is on Class packs & credits, not Card payments. Whether the seed, the release card's place or DEMO.md is wrong is **not verified** | demo pass | S | `morning-demo.mjs`, the release card's place in `morning.ts`, `.hackathon/DEMO.md` | no | S1 |
| B3 | After a deck approve, the agent walk still lists the approved API-key finding in its top 3. Today's steered decisions keep their slots marked `steered` (`morning.ts:45`), and the walk prints them without the mark | demo pass | S | `scripts/morning-agent-walk.mjs`, `morning.ts` | no | S1 |
| B4 | The close card repeats the deck's tallies | demo pass | S | `morning.ts:213-226` (`closeLines`) | no | S1 |
| B5 | The follower's "N s ago" looked frozen. The cause is **not verified**: the 1 s tick (`FollowHost.tsx:78`), the age counted from the original publish while echoes make no rev, or background-tab throttling | demo pass | S | `FollowHost.tsx`, `focus.ts:181-188` | no | S1 |
| B6 | The VR captures show the Kettle sample, not the morning-demo products | demo pass | S | `docs/concepts/one-morning/vr-*.jpg` | no | S4, S7 |
| B7 | e2 cosmetics: the rehearse script prints 16 ok, while DEMO says "15 checks" and HACKLOG says 17/17. The evidence list folds 2 of 6 decisions under "and 2 more" | demo pass | S | e2 `DEMO.md`, `Brief.tsx` | no | S1 |

### C. The morning and the shared focus

| # | Follow-up | Origin | Size | Files | Session |
|---|---|---|---|---|---|
| C1 | The deck notices news that arrives during the standup ("2 new since you opened this") | e3 | M | `MorningWatch.tsx` (the window frozen per tab in sessionStorage), `morning.server.ts`, the product streams | S5 |
| C2 | Follow history: back and forward through the last ten shared places | e3 | M | `focus.ts` (a capped ring in the record), `focus.server.ts`, `shared.ts`, `FollowHost.tsx`; `shared-focus-1` gains a field (S2) | S5 |
| C3 | The close card counts every decision taken in the window, and `steering-log.md` renders on read. `decidedElsewhere` (`morning.ts:202-211`) already counts store decisions that have no steering row, so this is partly done. Render-on-read is not done | e3 (Personas note §6.5) | S | `morning.server.ts:65-76,115` | S5 |
| C4 | One focus host. Partly done in `a2a1596`: `readFocus` re-reads the file when its mtime changes (`focus.server.ts:18-31`). The event bus is still per process. Name the canonical host (web with `BP_COMPANION_URL` → apps/server, `apps/web/next.config.ts:20-44`) | e3 (§6.6) | S | `focus.server.ts`, docs | S2 |
| C5 | A bay-aware place. Either add `bay` to `PlaceKind` (`session/place.ts:10-11`), or accept `<capId>.<kind>` as a room target. The stand-in (`focus-standin.ts:29-38`) and BpFollow (`BpFollow.cpp:91-104`) already resolve bays | e3 (§6.4) | S-M | `place.ts`, `focus.ts`, the stand-in | S2 |
| - | The budget slider (C8 stretch) | e3, dropped | - | Not planned | - |

### D. The brief

| # | Follow-up | Origin | Size | Files | Session |
|---|---|---|---|---|---|
| D1 | Measure how often the brief is right. Two parts:<br>(a) a pure replay over decided rows: for each one, the brief from earlier rows only, counting flips on what the owner approved and asks on true repeats;<br>(b) a log of overrides (approve on `withdraw`, decline-as-repeat on `proceed`), with the precision on the card once there is enough data | e2, fused | M | new `scripts/brief-backtest.ts`, `brief.ts`, `work/brief-misses.jsonl` (name to choose) | S8 |
| D2 | Batch brief: group like proposals (same standard) and decide the lot with one brief and one key. Flips stay identity-only | e2 | M | `brief.ts`, `rail/wide/review.tsx` ("Decline N repeats" exists), `MorningWatch.tsx` | S8 |
| D3 | The proposing agents read `plan.brief`: lens-scan's propose phase, or bp passing a feature's standing declines into the scan job. The skill lives outside this repo, and verifying it is a paid run | e2 | M + paid run | `packages/core/src/server/jobs.server.ts`, `server/companion/runtime/prompt.server.ts`, the lens-scan skill | S8 |
| D4 | Personas' fleet reads the decisions back (e2's P3): a prompt block, or bp's MCP door in the fleet run's `--mcp-config` | e2 | M | Personas (see [`personas.md`](personas.md)) | S8 |
| - | An FTS5 brain for "similar declined", and `memory.note` after withdrawing | e2, dropped | - | Not planned: deterministic word rules were chosen, and `memory.note` needs a paid companion turn | - |

### E. The contract and the sync between bp and Personas

| # | Follow-up | Origin | Size | Files | Session |
|---|---|---|---|---|---|
| E1 | Publish the shared-focus wire as `shared-focus-1.schema.json`: `FocusPlace`, `SharedView`, the POST body and `{ moved, view }`. Generate `FBpFocusPlace` and `FBpSharedView`. e3 dropped this tonight because of the parity, compat and mutant machinery it brings | e3 | M | `packages/schema/schema/`, `generate.mjs` ROOTS, `parity.mjs`, `compat.mjs`, `ue-standin/check.cpp`, `standard/schema-vocab.ts`; `focus.ts` stays the source | S2 |
| E2 | Publish the deck as `morning-deck-1`: `MorningDeck`, `MorningCard` and `SteerRow`, with the brief referenced from `decision-brief-1` | fused | M | the same files, plus `morning.ts:22-48` | S2 |
| E3 | Goldens. A shared-focus golden covering `readFocusPlace`, `sameSpot`, `toApply`, `levelOf` and `followingWords`. The brief golden already exists (`docs/concepts/decision-brief/golden.json`, 6 cases, written by `scripts/brief-golden.ts`, held by `check:decision-brief`) | e2, e3 | S-M | `packages/schema/golden/` (proposed home), `scripts/check-shared-focus.ts` | S2 |
| E4 | A dependency-free copy target, `packages/core/src/session/focus-contract.ts`, for the logic a schema cannot carry (`sameSpot`, `toApply`) | e3 (§6.1) | S | Merged into E1 and E3 | S2 |
| E5 | **A drift gate between bp and the Personas port.** Three parts: a bp manifest of contract files with hashes; a Personas test over its copied goldens; a cross-repo report | e2, e3, DOSSIER §4 | M | `packages/schema/contract.json` (proposed), `scripts/personas-drift.mjs` (proposed); see [`personas.md`](personas.md) §5 | S2 (bp half), S3 (Personas half) |
| E6 | Look up the slug by root (document `GET /api/products` as the lookup). Align the LAN door's slug `{0,63}` (`lan-door.ts:96`) with the registry's `{0,62}`, which `focus.ts:66` already uses | e3 (§6.3) | S | `lan-door.ts`, docs | S2 |
| E7 | Never allow `tauri.localhost` or add CORS. Every Tauri 2 app on the machine shares that origin. Write this rule into the contract text | e3 (§6.2) | - | Contract text | S2 |

### F. VR (detail in section 4)

| # | Follow-up | Origin | Size | Session |
|---|---|---|---|---|
| F1 | The brief on the table's decision card and on the room deck's decision screens. On `withdraw`, Decline becomes the primary answer | e2 (= A6) | L | S4 |
| F2 | Add `briefs.json` to the offline bundle | e2 | S | S4 |
| F3 | Parse the shared focus with generated structs instead of by hand | e3 | S | S4 (after S2) |
| F4 | An in-world Stop and Follow | e3 | M | S7 |
| F5 | Follow history in the headset | e3 | S-M | S7 (after C2) |
| F6 | Follow across products: load the followed product's plan. Today another product is only captioned | e3 (from the code: `BpFollow.cpp:78-80`) | M | S7 |
| F7 | Put the brief route on the LAN door (`read` scope) | fused | S | S4 |
| F8 | Whether a VR Decline writes the store. Today it is memory-only (`BpDeck.cpp:1117-1129`), and the door has no decide verb | fused, an owner decision | M | S4 |
| F9 | Realign the main checkout's `apps/vr/Plugins/MetaXR` debug files (54 .pdb/.lib written by the host's setup build) | host | S | S4 (the first main build) |

### G. Personas (detail in [`personas.md`](personas.md))

| # | Follow-up | Origin | Size | Session |
|---|---|---|---|---|
| G1 | Port `brief.ts` and hold it with the golden test (P1) | e2 | M | S3 |
| G2 | The brief on `ProposalCard`, with Decline primary on `withdraw` (P2) | e2 | M | S3 |
| G3 | Wire types to store v4 (`tier`, `risk_class`, `origin`, `external_ref`) | DOSSIER, e2 | S | S3 |
| G4 | A Rust focus client (1 Hz GET, read-only) and the slug table by root | e3 | M | S6 |
| G5 | Follow: a chip, and applying a place inside the open sheet | e3 | M | S6 |
| G6 | The Morning deck read-only in the Monitor, with Approve (and Decline on a repeat) through `lens_scan_decide` | e3 | M | S6 |
| G7 | Personas publishes the shared focus | e3 | M | Owner decision (section 6) |
| G8 | Defer and Hold from Personas (append a `SteerRow`) | e3 | S | Recommended: leave them to bp |

### H. Agents and spend

| # | Follow-up | Origin | Size | Session |
|---|---|---|---|---|
| H1 | A real companion turn (Glim, Opus) walks the morning instead of the script | e3 (stand-in) | S code, paid | S8 |
| H2 | The lamp's paid voice (ElevenLabs, cached per line under `$BP_HOME/companion/voice/`) reads the deck, replacing `speechSynthesis` | e3 (dropped for spend) | S code, paid | S8 |

### I. Security

| # | Follow-up | Origin | Size | Session |
|---|---|---|---|---|
| I1 | **The Host-header token leak.** It predates the hackathon. `originOf` takes the origin from `req.url`, which is built from the `Host` header (`packages/core/src/server/api/companion/door.server.ts:165-172`). `execute` then sends the per-process human token to that origin (`:175-181`). A local process that sets `Host: 127.0.0.1:<its port>` while filing a card can therefore receive the token. e1 documented it and did not fix it (e1 `docs/standard/rules-1.md` §8). The server is loopback-only, so the exposure is to local processes, not the LAN. Fix: send card requests to the server's own bound origin, or refuse a `Host` whose port is not this server's port | host (from e1) | S-M | S1 |

## 3. The session plan

The order follows dependency first, then value toward "steer, not operate". All sessions run on Lynx. S3 and S6 work
in the Personas repo, which the owner must open for writes; tonight it is read-only. S4 and S7 build UE in bp's
main checkout.

| Session | Goal, in the owner's terms | Where | Size | Depends on |
|---|---|---|---|---|
| **S1** Land the fused morning | "Every morning, the deck tells me what my past decisions say, and it is on master" | bp | 1 session | the fusion branch |
| **S2** One contract | "bp and Personas cannot drift without a red gate" | bp | 1 session | S1 |
| **S3** Personas decides with memory | "The card in Personas tells me I declined this before" | Personas | 1 session | S2 |
| **S4** The table's card has the brief | "In VR, the card says what it touches and what I said last time" | bp, UE on Lynx | 1-1½ sessions | S1; S2 for F3 |
| **S5** The morning while it happens | "News during the standup reaches me, and I can go back" | bp | 1 session | S1; S2 for C2's field |
| **S6** Personas follows the morning | "Personas' Monitor is one more screen in the same place" | Personas | 1-1½ sessions | S2, S3 |
| **S7** Steering from the headset | "I can stop following and resume from the table itself, across products" | bp, UE on Lynx + owner sitting | 1 session + sitting | S4, S5 |
| **S8** The brief learns, and agents hear it before they propose | "Agents stop proposing what I declined, and I know how often the brief is right" | bp (+ Personas for D4) | 1 session + an owner budget | S1; S3 for D4 |

That is about 8 to 9 sessions plus one owner sitting. S3 and S4 can run in parallel, since they touch different repos
and S3 needs no UE turn. S4 and S7 can never run in parallel with each other or with any other UE work on the machine.

### S1. Land the fused morning

- **Goal.** One deck that briefs the portfolio, with every decision carrying its brief, on master.
- **Scope.**
  - Verify A1-A5 against their rows, and do whatever is missing.
  - If the fusion did not land A6, defer it to S4. Do not half-build it here.
  - Fix B1-B5 and B7.
  - Close I1 before anything new reaches agents.
  - Reconcile the two concept folders: `one-morning/` and `decision-brief/` stay as the as-built records, and this
    folder is the plan.
  - Land through a PR when the owner approves.
- **Non-goals.** Schemas (S2). Any Personas code. Any new VR behaviour. News during the standup (S5).
- **Needs.** The fusion branch, with `npm run check` green on it. The owner's go to land.
- **Done when.**
  - `npm run check` is green and includes `check:decision-brief`, `check:shared-focus`, `check:morning-watch` and
    `check:morning-cursor`.
  - `python scripts/brief-demo-rehearse.py` is green.
  - A Playwright walk of the one fused DEMO, run from a fresh shell, passes every step. Step 1 shows "Following Web" at
    **M**. Step 3's tile and words agree.
  - A decision card on the deck, on the phone and in the follower's lower third shows its brief. On the demo's repeat,
    the Decline key writes `declined` with a `decision_note` that starts `Repeats <id>`. In e2's seed that is `brief-o2`
    repeating `brief-h7`; the fused seed may rename them.
  - `node scripts/morning-agent-walk.mjs` prints each decision card's brief lines and marks the approved one as approved.
  - A new check case shows that a card filed with a foreign `Host` port neither reaches that port nor carries the token.
  - The demo never writes `bp.products.local.json`. Verify with `git status` and the file's mtime.
  - If the fusion touched C++, the main checkout builds bpEditor after the merge (one UE turn), and the L0 regression
    line holds (`../desk-to-table/plan.md`, L0).
- **Risk.**
  - Two demo seeds collide over `BP_HOME` and the products file (A5).
  - `MorningWatch.tsx` (236 lines) and `morning.ts` (226 lines) grow toward `check:train-quality`'s 400-line limit.
    Split the brief part out rather than squeeze it in.

### S2. One contract: schemas, goldens and the drift gate

- **Goal.** The shared focus, the deck and the brief each have one normative wire, a golden that a port must reproduce,
  and a gate that turns red when bp changes them and a copy does not follow.
- **Scope.**
  - E1-E7, C4 and C5.
  - If S1 found that followers need a card reference to draw the brief, add it to `shared-focus-1` now.
  - Move the brief's golden next to the other contract artifacts, or reference it from the manifest.
  - Write the contract text: the routes, the echo rules, the guards and what a client must not do. The adoption notes
    already hold most of it. One correction: `sameSpot` now also compares the level and the hash's `at` (`focus.ts:93-99`,
    since `0a9cbef`). e3's Personas note §1 still says it ignores the hash.
- **Non-goals.** Code in Personas. C++ that consumes the new structs (S4). Changing the brief's rules.
- **Needs.** S1 landed.
- **Done when.**
  - `check:schema` and `check:schema-compat` are green with the new roots. `ue-standin/check.cpp` instantiates
    `FromJson` for `FBpFocusPlace`, `FBpSharedView` and the deck struct. Parity holds against the hand-written types in
    `focus.ts` and `morning.ts`.
  - The shared-focus golden is held by `check:shared-focus`, and the brief golden by `check:decision-brief`.
  - A new `check:contract` (name to choose) fails when a contract schema, golden or copy target changes without its
    manifest entry, and passes when they match. It has a seeded control, as `check:schema` does.
  - `node scripts/personas-drift.mjs --personas C:/t/hk-bp-ref-personas` prints the report: the 54 files with
    "PORTED from bp", their pins (only 7 name a commit: 5 `fbef867`, 2 `48171a1`), and every contract file missing in
    Personas (all of them today).
  - **The report is not in `npm run check`.** A machine without a Personas checkout would print SKIP, and a printed
    SKIP fails the suite (DOSSIER §6).
- **Risk.** The schema machinery is heavy for small types (e3's reason for dropping it). Keep `morning-deck-1`
  additive-only and versioned. A breaking change takes a new suffix, which `compat.mjs` calls out.

### S3. Personas decides with memory (in the Personas repo)

- **Goal.** A proposal card in Personas shows the same brief as bp's card. On a repeat, Decline is the primary answer,
  and the decline's note names the decision it repeats.
- **Scope.** G1-G3, and the Personas half of E5. Steps and paths are in [`personas.md`](personas.md) §3.1 and §5.
- **Non-goals.** Following the shared focus (S6). The fleet reading briefs (S8). Any call to bp's server: the port
  computes the brief locally over `BlueprintData`, with no network.
- **Needs.** S2: the manifest and the golden at their final home. The owner opens Personas for writes.
- **Done when.**
  - Personas' test suite is green, including a golden test that reproduces all 6 cases deep-equal.
  - `personas-drift.mjs` reports `brief.ts` and the golden in sync.
  - With a v4 store, `tier` and `risk_class` reach the brief. Today they arrive at runtime by presence but are untyped,
    and this is **not verified**.
  - A rendered capture of `ProposalCard` in Personas' style harness shows both the repeat case and the ask case.
- **Risk.**
  - The port's imports (`TIER_SAYS`, `BRIEF_MATCHES`, the `Structure` type) pull in more of bp than intended. Copy the
    two constants rather than port `derive.ts`.
  - Personas' accept key collides: **Y** is triage accept there (`keymap.ts:27`), so the brief must not bind it.

### S4. The table's card has the brief (bp main checkout, UE on Lynx)

- **Goal.** At the light table, the decision card and the room deck's decision screen show the brief's lines, with the
  owner's decline in amber. The offline table shows them too.
- **Scope.**
  - F1, F2, F3, F7 and F9.
  - The owner's call on F8, made before any write is built.
  - New captures of the morning-demo products (B6).
- **Non-goals.** Stop and Follow in the world, history, following across products (S7). The Quest APK package, unless
  the owner asks. Any change to the judged APK's unpaired line.
- **Needs.** S1 on master, because UE builds only in the main checkout (`.claude/spark/config.md:73`). S2 for F3.
  The machine's UE turn free: check first that no other session's `UnrealEditor-Cmd` holds it (the host saw one on 8770).
- **Done when.**
  - bpEditor Win64 Development builds with exit 0.
  - A rendered capture from the table's target pose shows the Kettle card `kf-001` (apps/server's sim) with its brief
    lines, and the demo store's repeat with the decline in amber. The builder looked at both.
  - `run-bplink.mjs --bundle` shows the same lines from `briefs.json`.
  - `check:schema`, the ue-standin build and `check:lan-door` (with a brief verb case) are green.
  - The L0 regression line holds.
- **Risk.**
  - The Meta VR Start competition closes **2026-11-18**. A card change destabilising the judged build is the larger cost.
    Gate it as the desk-to-table phase was gated (that plan's decision 1).
  - UE turn contention with other sessions.

### S5. The morning while it happens (bp web and core)

- **Goal.** The standup stays true while it runs. New findings and builds appear on the deck as they land. Any screen
  can step back to where the owner was a moment ago.
- **Scope.** C1, C2 and C3.
- **Non-goals.** VR history (S7). Personas. Any change to the brief.
- **Needs.** S1. S2, if history goes on the wire as a `shared-focus-1` field.
- **Done when.**
  - New cases in `check:morning-watch` and `check:shared-focus`: a proposal added mid-morning shows "1 new" without
    reshuffling decided slots; history keeps 10; back is a publish, so it makes exactly one rev, and the followers go
    back.
  - A Playwright walk: open the deck, append one proposal to a demo product's store (a seeder flag, to add), and see the
    deck say "1 new".
    Then back twice and forward once on the follower.
  - `steering-log.md` shows a row appended by another writer, without a bp steer.
- **Risk.** A deck that changes under the reader breaks e3's "never reshuffles mid-standup" rule. New items go to the
  end, marked, and never into the read part.

### S6. Personas follows the morning (in the Personas repo)

- **Goal.** With Follow on in Personas' Monitor, reading a card on bp's deck lands Personas on the same bay or feature.
  Personas can read the morning and approve (or decline a repeat) through its own path.
- **Scope.** G4, G5 and G6, as in e3's rollout steps 1-4 and 6 (`../one-morning/personas-adoption.md` §5). Paths are in
  [`personas.md`](personas.md) §3.2-3.3.
- **Non-goals.** Publishing from Personas (G7), unless the owner says so. Defer and Hold from Personas (G8). Any webview
  call to bp.
- **Needs.** S2: Personas copies the generated TS or `focus-contract.ts`, held by the shared-focus golden. S3: the port
  and golden pattern exists.
- **Done when.**
  - Each row of the place table (`personas.md` §3.2), driven by `focus-standin.ts --lead` and by bp's deck, lands on the
    right Personas node. An unknown id holds still and says so.
  - With bp down, the client says offline every 5 s instead of failing each second.
  - bp's chip lists "Personas" while the tab is visible, and shows it gone 45 s after the tab is hidden.
  - An approve in Personas moves the proposal to `approved` in `scan.db`, and bp's deck drops it on its next read.
- **Risk.**
  - The slug mismatch: `bpSlug(root)` is a convention, not a lookup.
  - Two bp processes with different records.
  - A lossy place mapping that republishes a different spot. This only matters if G7 is turned on.

### S7. Steering from the headset (bp main checkout, UE on Lynx, with an owner sitting)

- **Goal.** The owner stops and resumes following from the table, steps back through recent places, and the table
  follows the deck into another product.
- **Scope.** F4, F5 and F6, and the captures of the morning-demo products.
- **Non-goals.** Voice commands (`../vr-light-table/voice-sdk-plan.md`). Writes from the headset beyond the shared focus,
  unless F8 was decided for them.
- **Needs.** S4 and S5. The UE turn. An owner sitting in the Meta XR Simulator or the headset.
- **Done when.**
  - The build exits 0.
  - Rendered captures from the target pose show: the rim caption with Stop; after Stop, the table holding still while
    the web moves; Follow resuming; and the table switching to a second morning product.
  - The owner's sitting is recorded.
  - L0 holds.
- **Risk.**
  - Loading a second product's plan in the headset costs memory and time on Quest. The bundle holds one product, so on
    the APK, following across products must say "not on this table".
  - The VR comfort rule: the view never moves (`../vr-light-table/companion-lamp-plan.md` U3).

### S8. The brief learns, and agents hear it before they propose

- **Goal.** Agents stop proposing what the owner declined. The owner sees, in numbers, how often the brief's flips and
  asks were right.
- **Scope.**
  - D1: the replay first, which is free, then the override log.
  - D2.
  - D3, with one paid verification run.
  - D4 in Personas, if S3 is done.
  - H1 and H2 only under an owner budget.
- **Non-goals.** Any likeness rule that flips a card. e2's three reviews say no; a change needs the D1 numbers first.
- **Needs.** S1. The owner's answers to section 6's spend and real-store questions.
- **Done when.**
  - `scripts/brief-backtest.ts` reports flips that were wrong, true repeats that were missed, and the ask rate, over a
    named store. Only the aggregate numbers are committed; decline notes stay local.
  - The card shows precision once there is enough data. The threshold is the owner's to set.
  - One paid lens-scan propose run, under a stated budget, on a product with a standing decline, does not re-propose the
    declined idea, and its `plan.brief` read is on the agent trail.
- **Risk.**
  - Spend.
  - Private decline notes leaking into committed reports.
  - The measured precision may argue for weakening identity. Any rule change re-runs e2's never-flip pairs (case 20).

## 4. Impact on VR (BpLink and the UE app)

### 4.1 What exists after the fusion

- **The follower.**
  - `FBpLinkModule` is reader `vr:table` (`BpLink.cpp:778`). It sends `follow *` once and `hello` every
    `FollowHelloS` = 15 s, and polls `GET /api/session/focus` every `FollowPollS` = 1 s (`BpLink.h:199-200`). UE's HTTP
    cannot hold the SSE stream (`BpLink.cpp:770-772`).
  - The tick is `TickFollow` (`BpLink.cpp:952`). It does nothing when the table reads the bundle (`:955`).
  - The view is parsed by hand into `FBpFollowPlace` in `ReceiveFollowView` (`BpLink.cpp:1035`; struct at `BpLink.h:92`),
    which fires `FOnBpFollow` (`BpLink.h:111`).
- **The table's half.**
  - `ABpTable::Follow` (`BpFollow.cpp:64`) resolves the id as a tile, a room, a bay or a wing on the table's own plan
    (`:91-104`), and enters it by the existing lift and fade.
  - The rim caption is a world-space `UWidgetComponent` (`InitFollow`, `BpFollow.cpp:45`).
  - A place in another product is **captioned, not loaded**, at `BpFollow.cpp:78-80`. The demo works only because its
    products are copies of Kettle's map.
- **The publisher.** `PublishPlace` and `SendPublish` (`BpLink.cpp:835,867`) send a move once the table has rested
  `PublishSettleS` = 0.4 s (`BpTable.h:700`). They apply the echo rule (`:849-855`) and never run from the bundle (`:844`).
- **The console.** `BpLink.Follow on|off` and `BpLink.Publish on|off` (`BpLink.cpp:786,799`), and `BpLink.Goto <id>`
  (`BpFollow.cpp:246-268`). Stop and Follow exist only as console commands.
- **The decision surfaces.**
  - The table's card: `ABpTable::RefreshCard` (`BpMarks.cpp:994-1160`), cached by `id + status + lens + scale` (`:1019`).
  - The room deck's decision screens (`BpDeck.cpp`). Approve there composes the draft wave (`BpDeck.cpp:6`). **Decline
    is memory-only**: "off this session's queue ... the store is not written" (`BpDeck.cpp:1117-1129`).
- **The brief card: possibly.** Only if the fusion lands A6 tonight. Check the branch for a `FetchBrief`, or for
  `FBpDecisionBrief` used outside the schema headers.

### 4.2 What it consumes

- **Today.** `/structure`, `/plan`, `/scan`, `/scans` and `/waves` through the generated structs in
  `packages/schema/generated/ue/BpSchema.h`. BpLink sees them through the git-ignored junction
  `apps/vr/Source/BpLink/Public/Schema` (`apps/vr/tools/link-schema.ps1`, `.gitignore:61-62`). The shared focus is read
  by hand.
- **The brief.** Already generated: `FBpDecisionBrief` (`BpSchema.h:2054`) with `FBpBriefSubject`, `Ref`, `Blast`,
  `Decided`, `Precedent`, `Reversible`, `Cost`, `Advice` and `Fact` (`:1825-2035`). `ue-standin/check.cpp:9` compiles
  `FromJson` for it. The route is `GET /api/products/<slug>/proposals/<id>/brief`.
- **After S2.** `FBpFocusPlace`, `FBpSharedView` and the deck struct, read through `BpSchema::FromJson`. The hand parse
  at `BpLink.cpp:1035-1090` is then deleted. `FBpFollowPlace` stays as BpLink's in-engine type, filled from the
  generated one.

### 4.3 What each follow-up touches

| Follow-up | C++ | Assets and tools | Server |
|---|---|---|---|
| F1 brief on the card and the deck | `BpLink.h/.cpp`: `FetchBrief(Slug, Id, OnDone)` and a per-key cache. `BpMarks.cpp` `RefreshCard`: at most 5 `lines` under the header, and the `declined` fact in the approve button's amber. `BpDeck.cpp`: the decision screen's layout and primary button. `BpTable.h`: the new state | No new Content. The card is Slate built in C++, so there are no Blueprint assets. The text keeps BpType's sizes | none; the route exists |
| F2 `briefs.json` | `BpLink.cpp` `ReadBundle` (`:145`) reads it into the cache | `apps/vr/tools/bundle-data.mjs:28-32` adds `briefs.json` (id → brief for open proposals) | none |
| F3 generated focus structs | `BpLink.cpp` `ReceiveFollowView`, `SendPublish` | Regenerated headers through the junction | `packages/schema` (S2) |
| F7 brief on the door | none | none | `apps/server/src/lan-door.ts:99-114`: a `read` verb for `products/<slug>/proposals/<id>/brief`. Also consider `/api/companion/morning` |
| F8 VR decline writes | `BpDeck.cpp` `DeckDecline`, a BpLink POST | none | A decide verb on the door, and its guard. Today the decision route needs a loopback page and the human token, so this is new authority (section 6) |
| F4 Stop and Follow in the world | `BpFollow.cpp`: the caption becomes pinchable (`follow:stop` / `follow:on`). `BpHands.cpp` Pinch targets (`:27-37`). Or a row on the wrist (`BpWrist.cpp`) | none | none |
| F5 history | `BpLink.cpp`: read the history field. `BpFollow.cpp`: back and forward | none | C2 (S5) |
| F6 across products | `BpFollow.cpp:78-80`: on another product, `FBpLinkClient::FetchProduct` (`BpLink.cpp:178`), then `Follow`. `BpLink.cpp:371` `GetProductSlug` | none | none |

### 4.4 The offline bundle, Stop and Follow, history

- **The bundle.** The Quest APK reads only the bundle, and following and publishing are off there (`GFromBundle`).
  `briefs.json` lets the APK's cards carry the brief with no server. Shared focus and history stay server-only.
- **Stop and Follow.** Use the rim caption itself, not a new panel, so the control sits where the owner already looks.
  The comfort rule holds: Stop leaves the view still, and Follow eases there.
- **History.** It comes from the record (C2), not from a per-device list, so the web and the table agree on "back".

### 4.5 Build constraints

- **One UE machine.** Lynx: Windows 11 on ARM64, UE 5.8.4 running as emulated x64, Meta XR v207 (DOSSIER §1).
- **One UBT or one editor at a time, machine-wide.** Start the editor only through `apps/vr/tools/start-editor.ps1`,
  and drive UBT with its environment (`.claude/spark/config.md:72-73`). The hackathon's `ue-turn.mjs` is a
  hackathon-only wrapper.
- **The main checkout only.** The Meta plugins, the schema and PoF junctions, Binaries and DDC are git-ignored
  (`.gitignore:48-62`), so a worktree lacks them. The hackathon got around this with host-wired copies. The next
  sessions build after the branch lands.
- **Rendered-capture acceptance.** A visual UE change is accepted on a rendered capture from the target pose, taken
  with PoF `capture_viewport` in PIE over the editor MCP and looked at by the builder (`.claude/spark/config.md:74`).
- **The deadline.** The Meta VR Start competition closes 2026-11-18. The APK's unpaired line is re-run at every VR step.

## 5. Impact on Personas (summary; the detail is [`personas.md`](personas.md))

- **The topology (owner).** **bp builds, Personas reads.**
  - Features are built and proven in bp first.
  - Personas takes bp's contracts (schemas, goldens, copy targets) and bp's computed state (the shared focus, the
    morning), and reads them.
  - Personas writes only through the path it already has: `lens_scan_decide` → `store.mjs`.
  - bp and Personas still meet in `scan.db` (DOSSIER §7.6). The new seam is Rust → bp's loopback HTTP.
- **What changes in its ported Blueprint.**
  - The brief is ported, with the golden test, and shown on `ProposalCard` (S3).
  - The Monitor becomes a 1 Hz follower through a Rust module. It maps bp place ids to Personas nodes (a bp room is a
    Personas bay) and opens the sheet at a place (S6).
  - The Morning deck is shown read-only, with Approve through Personas' own decide (S6).
- **The Rust commands it needs.** `bp_focus_start`, `bp_focus_stop`, `bp_products` and `bp_morning`, emitting
  `bp-focus:view`. `bp_focus_publish` comes only if G7 is chosen. Every call goes from Rust, because the shipped CSP's
  `connect-src` has no localhost (`src-tauri/tauri.conf.json:43`).
- **The wire-version gap.**
  - Personas' TS wire stops at store v3: `wire.ts` `Proposal` has no `tier`, `risk_class`, `origin` or
    `external_ref`, and `source.ts:60` says "1, 2 or 3 today".
  - bp's store is at `user_version = 4`.
  - Rust already reads columns by presence (`src-tauri/db/src/repos/dev/lens_scan.rs:14-18`), so this is mostly a typing
    change.
  - About 54 files carry "PORTED from bp", only 7 with a pinned commit, and no drift gate holds them.
- **What stays read-only.** Release, lens authoring, Defer and Hold (bp's steering log), standing rules (e1, parked), and
  publishing the shared focus unless the owner chooses G7.

## 6. Cross-cutting risks and open questions for the owner

| Risk or question | What we know | Proposed answer, or the question |
|---|---|---|
| **The Host-header token leak** (I1) | Pre-existing on master (`door.server.ts:165-181`). Loopback-only. It affects the human token and e1's grant signatures alike | Fix in S1, before real agent runs (S8). **Question:** is a bound-origin rule enough, or should card execution move in-process (call the handler directly, with no HTTP hop)? |
| **Identity versus likeness in the brief** | Flips rest on identity only, and likeness asks. Measured only on seeded data. Kettle's 40 open gave 34 proceed, 6 ask, 0 flips (e2 HACKLOG 01:31). A re-worded repeat is a known miss | Measure it (D1, S8). **Question:** may S8 read the real stores of `bp` and `pof`, read-only, and commit only aggregate numbers? |
| **Stand-ins that must become real** | The Kettle-copy portfolio with a synthetic night; fake-claude and fake-gh; the scripted agents; the headless and Personas stand-ins; the `/crossing` mock card; VR captures of the Kettle sample | A real portfolio needs real overnight runs (spend). The rest are retired by S4, S6, S7 and S8. **Question:** which real products form the first real morning? |
| **Spend boundaries** | Paid: companion turns (Opus and Haiku legs), the lamp's ElevenLabs voice, real scan, execute and propose jobs, nightly runs (DOSSIER §5) | Demos and gates stay on fakes. **Question:** a budget per session for S8's single paid propose run, H1 and H2, or "not yet"? |
| **One UE machine** | Lynx only, one UBT or editor at a time, the main checkout only. Another session's headless editor may hold it. The competition is on 2026-11-18 | Run S4 and S7 alone, after S1 lands. **Question:** should S4 land before 2026-11-18, and should `briefs.json` ride in the competition APK? |
| **VR writes a decision** (F8) | A VR Decline is memory-only today. The LAN door has no decide verb. Deciding needs the human token | **Question:** keep VR decisions memory-only ("decide at the desk"), or add a door scope with its own ceremony? |
| **Personas publishes** (G7) | Possible from Rust with no bp change. The hazard is a lossy mapping and a ping-pong between two surfaces | **Question:** follower-only first (recommended), publishing later? |
| **Two bp processes** | The record now re-reads on mtime (`a2a1596`), but the event bus is per process | Name apps/server as the focus host, with the web proxying (`BP_COMPANION_URL`). Personas uses the same base URL as the open bp page |
| **Signatures shown on shared cards** | Personas signs `user:personas`, and the brief shows "by personas" | e2's open question 3 for Personas' owner |
| **Where the Personas golden test lives** | Next to `PARITY.md`, or in a cross-repo job | e2's open question 1. This plan proposes both: a copy and test in Personas, and the report in bp |

## 7. Parked: e1, "Rules you set once" (branch `hackathon/bp-sync-1029/e1`)

- **What e1 built.** Standing orders (hold, only, cap) and grants live in `bp-rules.json` beside `scan.db`, and one
  `gate(rules, act)` sits on every agent door. A pure `backtest()` replays a rule over the owner's decided rows; 96 of
  its 107 demo decisions are synthetic. A threshold rule suggests rules from the owner's record.
- **What it would add on top of this plan.**
  - Morning cards could show "held by O-1".
  - A repeated decline could suggest a standing hold.
  - Personas could read the rules through one read-only command (e1 `docs/concepts/rules-personas-adoption.md`).
- **Reuse.** Its replay is the same shape as D1's backtest. Build D1 so the two can share it.
- **Status.** Parked until S8's numbers say how far the owner's record can be trusted to decide alone.

## Sources

- **The fusion branch.** `C:/t/hk-bp-sync-1029/e3` at `2ea1c1e`, and its `.hackathon/{DEMO,HACKLOG,UE}.md`. The e3
  sources are `docs/concepts/one-morning/{README,personas-adoption}.md`. The e2 sources are
  `docs/concepts/decision-brief/{README,personas-adoption}.md` and `golden.json`.
- **e2.** `C:/t/hk-bp-sync-1029/e2/.hackathon/{DEMO,HACKLOG}.md`.
- **e1.** `C:/t/hk-bp-sync-1029/e1/.hackathon/DEMO.md` (as quoted in `judging.md`), `docs/standard/rules-1.md` §8,
  `docs/concepts/rules-personas-adoption.md`.
- **The host.** In `C:/Users/kazda/kiro/bp/.hackathon/arena/bp-sync-1029/`: `host-notes.md`, `judging.md`, `TRACK.md`
  and `DOSSIER.md` (the baseline of facts about both apps).
- **Personas.** The read-only reference `C:/t/hk-bp-ref-personas` at `ad40fcfa10`.
