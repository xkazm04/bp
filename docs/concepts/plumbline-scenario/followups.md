# Plumbline follow-ups - for another session

Written 2026-11-17 at the owner's request. Product state at that point:
- public repo https://github.com/xkazm04/plumbline;
- live Desk https://plumbline.xkazm04.workers.dev, signed with kid `91971cfa8d0e630c`, signature valid until 2027-02-15;
- Agent Atlas scores it 100;
- the Devpost deadline is 2027-01-11 16:00 UTC.

Read `README.md` (the phases) and `lessons.md` (L1 to L16) beside this file first. The spark vault note
`.spark/Spark/ideas/agentic-web-hackathon.md` has every decision, and the ones rejected.

## 1. Otari

The challenge sponsor's LLM router. The Desk's manifest already names hosted Otari as its router (`https://api.otari.ai/api/v1`) with no key, and the runtime's BYOK panel lists Otari first.

- **Owner:** create an Otari account. For the submission you need the account email and one or two sentences on a problem you hit with Otari and how it could improve.
- **First real model run:** do a chat turn through Otari on the live Desk with the owner's key, entered in the BYOK panel in the browser and never committed. Record:
  - which model (`alibaba/qwen3.8-flash` is the spec's example);
  - latency;
  - whether the Desk's front agent calls the right `website_*` tool for each sample query;
  - whether it obeys the new instruction that tool text is data and the page's verdict is the authority;
  - what it costs per turn.
- **Write down the Otari problem as it happens.** The submission asks for one, so note it the moment it appears instead of reconstructing it later.
- **Decide whether the publisher should fund a demo model for judges.** It was rejected as a default at design time; it needs a hard daily cap and the owner's approval.

## 2. End-to-end tests (what has never been exercised)

Everything below was explicitly "not verified" in a builder report or a Director review:
- **Real LLM behaviour.** All agent tests used a scripted model. Run the sample queries plus the decline query against a real model. Also check the prompt-injection defences: a peer or an inspected page trying to make the assistant call `sign_files`, `generate_key`, or `verify_site` on an untyped host, or claim a verdict the page does not show.
- **The partner flow end to end.** The consent card, then a partner network's bridge frame, then a reply, for both Agent Atlas and Agent Customs. Run it from the live Desk and from another origin that calls the Desk as a peer (the Desk now sends CORS headers, but no peer has ever called it).
- **Browsers.** Firefox and Safari: `'unsafe-hashes'` CSP support, WebCrypto Ed25519. Also a screen-reader pass, and the keyboard shortcuts 1 to 5 and Escape, which were never driven.
- **The GitHub Action in an adopter's repository.** `action-smoke.yml` proves both commands inside this repo. Still unproven: a separate repo using `xkazm04/plumbline/action@<sha>` with the watch template, which opens and then updates the "Plumbline drift" issue (`gh issue` create, then edit).
- **The Customs receipt path in the browser.** No target the proofs used has a receipt that verifies in the browser.
- **Rotation and revocation in the field:**
  - publish a rotation and a revocation for a test site, and watch the CLI and the Desk react;
  - a successor key adopted through a rotation, then the revocation cascading (`adoptedVia`);
  - the stale-trust window is documented but has never been demonstrated.
- **The private key file mode.** Only checked on Windows (ACL). Run `keygen` on Linux or macOS and assert 0600.
- **Performance.** No probe exists, so the performance lens is unmeasured on every feature. Name a probe in `.claude/lens-scan/config.md` (`## Probes`): for example the gate's wall time on three sites, or the Desk's first paint.

## 3. Developing the use case

Plumbline's job is to keep an agentic website true after it ships. Directions, roughly in order of value:
- **Publisher onboarding in one sitting.** Today a publisher needs the CLI to make a key and sign. The Desk can generate a key and sign files the visitor picks, but nothing walks them from "I have an agentic site" to "it is signed, locked, watched and gated in CI". Build a guided flow, and a `plumbline init` command; `init` is still "not implemented".
- **Identity beyond the origin.** Bind the publisher key to a NANDA Index record (`urn:air:...`, see the nanda-index-v2 TRUST_CONTRACT) so a first contact can be checked out of band. That is the ceremony the docs describe but nothing automates.
- **Upstream.**
  - Offer the signature format to Agent Customs: their `I-AUTHORITY` notice says the host cannot verify publisher identity, and Plumbline answers exactly that.
  - Offer Agent Atlas a "signed by" column.
  - Open a PR adding the Desk to the community list `docs/agentic_websites.md` in cognizant-ai-labs/agentic-web.
- **Known v1 limits worth closing:**
  - rollback protection (a sequence number the verifier remembers);
  - transitive modules imported by signed action code;
  - the page's own scripts (today they rest only on the HTTPS origin and the runtime lock);
  - multi-network sites;
  - per-checker deep pages in the Desk, which were dropped in the port;
  - drift notifications beyond one GitHub issue.
- **Runtime drift is real today.** Upstream nsdeploy is ahead of the copied runtime (`53a787c` vs `4e4cb36`). Decide the policy:
  - who reviews an upstream runtime change;
  - how the copy is refreshed;
  - how the lock, the CSP style hashes (`site/tests/csp.test.mjs`) and the signature are renewed together.
- **The video (owner, in their own voice, under 2 minutes).** A suggested arc:
  1. the problem;
  2. gate a real site;
  3. sign the Desk;
  4. verify `unverifiable`, then `verified`;
  5. edit a file and get `invalid tampered`;
  6. the watch's drift issue.

  Screenshots can be produced by the Director from the live Desk.

## 4. Bookkeeping

- `ai-registry` holds local, unpushed commits: adopt-bp 1.6.1 (`414f09f76`, `48b21085b`) and the contest lesson (`10cddb064`). That checkout carries another session's uncommitted work, so push it deliberately.
- The private key lives at `C:\Users\kazda\.plumbline\keys\plumbline.private.json`. Back it up. Any change to a signed file (the manifest, the network, `site-actions.js`, the bridge, `links.json`, the lock) needs `node dist/cli/index.js sign ...` again, then `npm run build:site` and `npx wrangler deploy`.

## 5. Scanner improvements still open (from the 2026-11-17 full-scope scan)

Built that night: adopt-bp 1.7.0 and lens-scan 1.17.0 (lessons.md L17). Still proposals:

- **Dowser: a lens (or a rule) that owns plain code defects.** The sweep saw that the watch tracked the wrong upstream
  repository and had no lens to file it under; scan-sweep hunts bugs, but a backlog scan should not silently drop one.
- **Dowser: ranking.** The per-lens slot guarantee (`SKILL.md:331-333`, up to 4 per lens before any cross-lens score)
  ranked four indistinguishable impact-2 opportunity cards (5 to 8 points) while two 18-point doc-drift cards went to
  reserve, and a card predicted `reject` ranked because the prediction does not feed ranking. Consider a score floor
  for the guaranteed slots and letting the prediction demote.
- **Dowser: dedupe across anchor granularity.** Two cards for one fix (the Desk's repository link) anchored a section
  and a whole file; `similar` missed them and headless runs skip merges (`SKILL.md:504`).
- **Dowser: young repositories.** The 90/120-day git windows (`opportunity.md:78`, `doc-drift.md:74`) are meaningless
  on a repo whose commits all fall on one day; scale the window to the repo's age.
- **Dowser: doc-versus-doc and doc-versus-remote drift** have no slot in the doc+code pair rule (`doc-drift.md:154`),
  and in-product guide text (`strings.js`) is outside the reader-harm tiers.
- **lens-scan store:** a command to strike a false positive the judgement pass rejected (`metrics.md:53` allows it,
  nothing records it: 27 unsafe sinks and 2 secret hits on plumbline were all false positives and still count); a
  `--lens` on `coverage` so per-lens standardsPct is not hand-split; run-log ids that cannot collide within a second.
- **Retraction:** a value a faulty run wrote stays in the map (L7); the store needs a way to say a key no longer
  applies.
- **Measure the change:** after the backlog wave lands, rerun `/adopt-bp` (map refresh) and `/lens-scan measure --lens
  all` on plumbline and compare the counts and the coverage with the 2026-11-17 runs.

## 6. After the 2026-11-17 backlog wave

- **Done:** 47 of the 50 lens-scan items, from adoption and the full scan, are marked `done` in plumbline's store with their commits:
  - `2765b4b` trust, adopt, `verify --url`, revocation;
  - `7e58639` relock, the true runtime upstream, signature expiry, pending peers, the shared drift module;
  - `5a88eff` the Desk's guards, BYOK, trust export, revoke, accessibility;
  - `dcb92c5` SECURITY.md, THIRD_PARTY.md, the release channel, the Action report;
  - `4ee0067` the template pin;
  - `891c725` relock and re-sign.

  Dowser's 18 cards were resolved by the same commits. Their status lives in Dowser's own store and its Jira flow, which was not used. Run `/dowser` again to see them drop out, or triage them there.
- **Still open in the store:**
  - `p-e05cbf`: report upstream that the runtime's sandbox timeout never terminates the worker. This is an issue in cognizant-ai-labs/agentic-web, outward-facing, so it is the owner's call.
  - `p-b02834`: parse the gate and watch flags with `src/cli/args.ts`. Blocked: args.ts needs repeatable keys (for `--source`) and positionals (for the gate target).
  - `p-a41521`: the core side is built (`applyRevocationText`, `isPrivateKeyFile`). The Desk still uses its own copies in `site/desk.js` (`#checkRevocation` and the private-key shape check), so switch it to the core helpers.
- **The live runtime is one upstream commit behind.** agentic-web's `skills/agentify-website/runtime` moved from `7817c1f` to `7ee54a3`. Deciding whether to take it is the runtime-refresh policy question in section 3.
- **A first tagged release** (for example `v0.2.0`) has not been cut. SECURITY.md and `action/README.md` describe releases as the security channel, so cut one with notes when the owner wants the first public release.
- **Repository settings done:** private vulnerability reporting is enabled, and the labels `security`, `breaking` and `skip-release-notes` exist.

## 7. The second-pass scan (2026-11-17, after the wave) - the next backlog

lens-scan 1.17.0 ran over a refreshed map: measure run `r-20261117225924-6610`, propose run `r-20261117231440-d9d5`.

**What changed against the first pass:**

| Measure | First pass | Second pass |
|---|---|---|
| Proposals filed | 42, none tiered | 41, all tiered (1 tier 1, 9 tier 2, 31 tier 3) |
| Map coverage | 95 of 122 tracked source files | 122 of 122 |
| desk-agent-network: loc | 7089 | 329 |
| desk-agent-network: unsafeSinks | 27 | 0 |
| desk-agent-network: secretHits | 2 | 0 |
| desk-agent-network: dupSites | 6 | 0 |

The desk-agent-network numbers dropped because its vendored runtime is now excluded.

**These 41 proposals are the next session's backlog.** Each waits for the owner's decision in bp's review UI or a stand-up. The top ones:
1. `p-e945d0` (tier 1): close a redirect's connection instead of draining its body outside the fetch timeout.
2. `p-1c7bd9`: refuse to sign when the private key file sits inside the site root.
3. `p-f4e350`: comment on the open drift issue when its findings change.
4. `p-f7d646`: fail the duplicate-key rule closed when the key counter cannot read a file.
5. `p-1aaf28`: say unverifiable when the browser could not read a signed file.
6. `p-9ddaa4`: report a file added to the vendored runtime folder after the lock was written.
7. `p-05d52a`: report a receipt signed by a key Customs no longer publishes as unavailable.
8. `p-c30007`: keep every revocation a site has published.
9. `p-e1e3da`: cover the code the Desk's website tools run with its signature.
10. `p-088c6f`: hold https grounding refs and peer addresses to the peer address rule.

**Scanner friction still open after 1.17.0** (logged in lens-scan's LESSONS):
- **No script lists unmapped files.** The 1.17.0 rule is method text only, and adopt-bp's coverage check counts code files only and ignores `vendored`.
- **An excluded feature keeps its old numbers.** It gets no new row, so `store.mjs latest` still returns the earlier inflated values. That contradicts "no row means unmeasured".
- **Performance is reported as runnable.** `run-start --lenses all` lists it even with no probes.
- **The registry map goes stale.** It is not rebuilt when the context map changes. It was rebuilt by hand that night.

