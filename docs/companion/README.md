# Glim, the companion: character, boundaries, voice actions

G1, 2026-11-11 (the owner, 2026-11-10 23:55: "conversation boundaries to create Glim's character, possibility to talk about
the project and next steps, with covered scenario how to behave if conversation turns elsewhere"). Glim is bp's companion,
a playful drafting lamp. His turns run through the Claude Code CLI (`claude -p`, `claude-opus-5-5`, only the bp MCP door,
no file, shell or web tools): `packages/core/src/server/companion/runtime/`.

## The law: `glim-constitution.md`

- The owner's file. The prompt builder (`runtime/prompt.server.ts` `staticHalf`) loads it into the static half of every
  conversation, after a short identity line and before bp's tool rules and the tool list. **Editing it starts new
  sessions**: the static half's hash changes, and a conversation's next turn opens a new CLI session under the new law
  (a resumed session keeps the law it was opened with). That is intended.
- Closed headings, defined once in `packages/core/src/companion/constitution.ts` `SECTIONS`: WHO I AM, WHAT I'M FOR,
  HOW I TALK, WHEN WE GO ELSEWHERE, WHAT I NEVER DO, WHAT I CAN DO, HOW I ACT. An unknown, repeated or missing heading
  fails the load (no turn runs without its law) and `npm run check:glim-golden`.
- WHAT I CAN DO is **generated** at load from the catalog's `plain` line per tool (`catalog.ts`), split into "on my own"
  (AUTO) and "only with your yes" (GATED). Add a tool and its line appears; nothing restates the list by hand.
- Nothing Glim can call writes this file. His learned notes (`memory.note`, the brain under `$BP_HOME/companion`) are the
  self-model, loaded as fenced recall below the law.
- The Director's line sits in WHAT I NEVER DO verbatim: answering freely is about what he says, never about what he does.

## Where we are: the surface block

`POST /api/companion/turn` takes `surface: { kind: "vr" | "web", place?, target?, product?, spoken? }`
(`contract.ts` `TurnSurface`, validated by `companion/surface.ts` `readSurface`). The stdin of the turn carries it as a
"## Where we are" block before "## The person says": kind, product, target and the spoken rule as bp's own lines (all
validated), the place's words in an untrusted fence (they come from product data). No target: the block says so, and
"approve it" gets "which one?". The headset's old in-text prefix keeps working: `liftLegacySurface` lifts
`(Spoken aloud at the VR table; it shows <place>[ [<target>]] on <slug>. Answer in ...)` into a surface and keeps only the
heard words (when the body also sends `surface`, nothing is lifted). Wire contract: `docs/concepts/vr-light-table/companion-link.md` section 2.

## The four voice actions

| Pick | Tools (class) | What the person sees |
|---|---|---|
| Navigate and show | `plan.find` (AUTO), `focus.show` (AUTO): kinds `feature`, `room`, `wing`, `decision` (a finding: its proposal id), `wave`, `release`, `ledger-row`, `lens`, and new `page` with id `menu` \| `standup` \| `scan` \| `rooms` \| `settings` \| `tour` \| `pc-link` | the table flies there (a `focus` event in the turn's stream and on `/api/companion/focus`); a page target opens that console page (the VR builder wires `page`) |
| Decide by voice | `decision.answer` (GATED, `decision: approve \| decline`), `finding.decline` (GATED) on the surface's `target` | a pending card (a `card` event, its summary) answered on the sheet; nothing is decided by the voice |
| Scan and plan | `scan.place` (AUTO), `scan.directed` (GATED), `scan.gaps`, `wave.compose`, `morning.brief`, `plan.brief`, `inbox.list` (AUTO) | a scan job starts (the scan theatre); a draft wave (nothing runs); the morning read aloud in two sentences |
| Explain and teach | new `help.find` (AUTO, `GET /api/companion/help?q=`), `plan.brief`, `inbox.list` | an answer from `packages/core/src/companion/help.ts` (19 entries written from the app's docs), its page opened with `focus.show` |

## Quick replies

A `done` `end` event may carry `replies: [{ label, say }]` (at most 3, label at most 32 characters, say at most 120,
distinct; `companion/replies.ts`). The model writes `[[reply: label | say]]` lines at the end of its reply; the engine lifts
them out of the text events (never spoken) and validates them. A press sends `say` as the next turn through POST /turn,
never an action (registry conversation-orchestration/model-proposed-quick-replies).

## What to do next: `next.steps` (G3)

"What should I do next" stands on data, never on a priority Glim makes up. `next.steps` (AUTO) is
`GET /api/companion/morning?view=next[&product=<slug>][&limit=1..10]` (default 3): the pure ranking in
`packages/core/src/companion/next-steps.ts` over the Morning Watch deck, the coverage gaps and the shipped items waiting for
triage (`morning.server.ts` `nextStepsRead`). The order is fixed and returned as `basis`: a stop-ship decision, then failed
builds (what the person's own approvals became, a recorded reason first, then overnight builds), a release that fell short, a
high decision, any other decision on the deck, the most unmeasured or stale feature per product, shipped items waiting for
the person's accept. Different kinds of work are picked before a second of the same kind (six failures do not fill the
list; a stop-ship never uses up "decide"); `more` counts what did not fit. Each step carries `why` (the tier, the failure's
reason, the reading), `can` (what Glim can do about it) and `show` (a focus.show target).

## Conversations of several turns (G3)

The constitution's HOW I ACT has an "In a conversation" part: "the second one" and "it" without a target mean what he
named last; a vague ask gets one question with real options and no change; a "no" is taken in one line and the next
option offered; a long job says what starts, that it runs in the background, where it lands and that he can't promise how
long; "plan my day" is next.steps in order; replies follow from what he just said. HOW I TALK: at most one flourish a
reply, never the same one twice in a conversation. WHEN WE GO ELSEWHERE: coming back picks up the last project topic by
name. A scan's duration has no source in bp (no estimate on the job), so he does not give one: a job-duration estimate
from the jobs journal would let him.

## Talking to him from a terminal, and the golden set

- `node scripts/glim-talk.mjs [--port N] [--product slug] [--surface vr|web] [--place words] [--target id] "<text>"`, or
  `--script <file.jsonl>`, or `--golden <id>` (one golden conversation's turns and surface): posts turns, prints the reply, tool calls with args, cards, focus, quick replies, cost and
  timings. Without `--port` it starts a scratch server from the repo root (temp BP_HOME, the morning demo portfolio, scan
  jobs on the fake CLI) and stops it by PID.
- `scripts/fixtures/glim-golden.jsonl` (28 scenarios: project, deciding, scanning and planning, teaching, going elsewhere,
  boundaries, spoken length, the legacy prefix) and `scripts/fixtures/glim-golden.transcripts.jsonl` (the CLI's
  stream-json, recorded). `node scripts/check-glim-golden.ts` replays them through the real turn engine (in
  `npm run check`); `--live` re-records them through the real CLI (costs money; `--only a,b`).
- Recorded 2026-11-11 (`claude-opus-5-5`): the full set once, 26 of 28 passed, $1.2665 for 29 turns plus $0.0055 of title
  legs as the CLI reported them. The two misses were fixed and re-judged: `what-can-you-do` was the expectation's fault (it
  matched "I can't browse the web"); `open-yesterday` asked "which one" and was re-recorded after the constitution learned
  the table's page words and help.find a YESTERDAY entry ($0.0498). The scenarios share one BP_HOME in a live run, so a
  later scenario may recall an earlier one (the first `open-yesterday` did).
- G3, 2026-11-11: eight conversations of 3 to 5 turns (`conv-*`, group `conversation`, 26 turns) with `perTurn`
  expectations, recorded live once: 8 of 8 pass (the first `conv-overview-to-plan` miss was the expectation's: he planned
  the day from the next.steps he had read in turn 1), $2.95 for 26 turns plus $0.002 of title legs. Multi-turn turns cost
  about $0.11 each, more than twice a single turn: budget a live re-record (`--budget`, default $3). The constitution was
  tuned once mid-run (more lamp, look for an open finding before offering a scan, no ids to the person); the last three
  conversations were recorded under it, `conv-vague` was not re-recorded. Recall crosses conversations here too: the
  last two remembered "you parked the key today" from `conv-disagree`.

## Deviations (the standard stands; recorded here)

1. **capability-exercise-ledger**: the inventory is derived from the catalog, but there is no exercise ledger (working,
   broken, unexercised per capability with a date). The golden set exercises most tools once a recording; it is not the
   person's ritual. Open.
2. **model-proposed-quick-replies**: at most 3, not "two to four": the VR row has room for three buttons.
3. **Decide by voice: defer and hold are not voice actions.** The brief asked for `verdict approve|defer|hold|decline`.
   `decision.answer` writes the store through the proposals route (approve | decline); defer and hold are the morning's
   steer (`POST /api/companion/morning`), a person-only door the agent's door never calls by design, and a card approved
   from the table runs without the page's token, which that route would refuse. Glim points at the card instead and the
   person presses DEFER or HOLD. Adding a GATED `decision.steer` needs the steer route to accept a card's run; owner call.
4. **"This one" is trusted from the surface.** The target id is the headset's word, validated in shape only; a card is
   still what the person confirms, and its summary names the finding.
