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
