// Glim's help corpus (G1, 2026-11-11): short entries on how to use the VR table, written from the app's own docs
// (docs/concepts/vr-light-table/headset-morning-check.md, apps/vr/README.md "How Glim speaks and listens", the tour book's
// chapters and the controls legend). The `help.find` tool (GET /api/companion/help?q=) answers from it, so "how do I use the
// wall" is answered from what the app does, not from what the model guesses. `show` is a focus target the companion may pass
// to focus.show (a console page, contract.ts PAGE_TARGETS). Authored content: the model picks an entry, it never writes one
// (registry conversation-orchestration/show-dont-tell-walkthrough: improvised invocation, authored steps).
// Pure data and a pure search: no Node, no DOM.

import type { PageTarget } from './contract.ts';

export interface HelpEntry { id: string; title: string; text: string; show?: { kind: 'page'; id: PageTarget } }

export const HELP: readonly HelpEntry[] = [
  { id: 'table', title: 'The table', text: 'The blueprint table sits in front of you: wings are your product\'s big areas, rooms sit inside them, features inside rooms. Tap a wing to lift it, tap a room to lift it, tap it again to step in. BACK on the bar goes one level up; a thumbstick click goes home to the site plan.' },
  { id: 'hands', title: 'Hands: tap, menu, back', text: 'Pinch and let go to tap (no pull). Pull a wing toward you to lift it, push it away to go back. MENU on the bar opens the console; BACK goes one level back; CLOSE folds the console to its bar. If taps miss, SETTINGS can widen the aim.', show: { kind: 'page', id: 'settings' } },
  { id: 'pointer', title: 'The pointer', text: 'Your hand\'s ray runs to whatever it meets: the wall, the desk console, the bar, the wrist, me. Its dot turns amber over a control that will act; pinch to press it.' },
  { id: 'wall', title: 'The wall (the main screen)', text: 'With SETTINGS > MAIN SCREEN set to WALL, the open sheet is drawn big on the far wall above the table. Point at it with your hand\'s ray and pinch to press; the pad and the wrist work it too. A loupe magnifies the part of a screenshot that changed. DESK puts the sheet back on the console.', show: { kind: 'page', id: 'settings' } },
  { id: 'wrist', title: 'The wrist', text: 'Raise your left hand and look at your wrist: a small panel with MENU, TOUR, TALK and the decision waiting for you. It turns to face you. SETTINGS > WRIST can move it to the right hand or fix its pose.', show: { kind: 'page', id: 'settings' } },
  { id: 'controllers', title: 'Controllers', text: 'Optional: hands do everything. The thumbstick steps the focus between wings and rooms, A selects, B goes back, Y or the menu button opens the console, X held is talk. On a stand-up card, A once shows A AGAIN: APPROVE and a second A within 6 seconds approves.' },
  { id: 'talk', title: 'Talking to me', text: 'Hold X, or pinch and hold me, or hold TALK on the wrist, then speak and let go. The first time, a sheet says where your voice goes (your PC, then a cloud speech service) with ALLOW and NOT NOW; nothing is recorded without ALLOW. Your words show as a caption so a mishearing is visible. Press B or pinch me to stop me talking.', show: { kind: 'page', id: 'tour' } },
  { id: 'voice-privacy', title: 'Where your voice goes', text: 'The headset runs no speech model. While you hold to talk it records, then sends the clip to your PC, which asks a cloud speech service for the words once; the PC keeps nothing of what you said. Silence never leaves the PC. Each headset has a daily speech budget on the PC.' },
  { id: 'standup', title: 'The stand-up (your morning)', text: 'MENU > STAND-UP is the morning: what agents built overnight, releases checked, the top blockers, and the decisions waiting for you, one card each with its brief. You approve, defer, hold or decline each card yourself; I can recommend, never decide.', show: { kind: 'page', id: 'standup' } },
  { id: 'yesterday', title: 'Yesterday (what your approvals became)', text: 'The stand-up opens with YESTERDAY: what yesterday\'s approvals became, one outcome at a time, BUILT with its commit or FAILED with its reason, who approved it and when, and the BEFORE and AFTER screens side by side. PREV and NEXT step through them; then come today\'s decisions.', show: { kind: 'page', id: 'standup' } },
  { id: 'decide', title: 'Deciding a card', text: 'A decision card shows what it touches, what you said about similar ideas before, how to undo it and what it costs. Approve or decline it on the sheet. When I file something that needs you, it waits as a pending card until you answer it; I never answer it for you.', show: { kind: 'page', id: 'standup' } },
  { id: 'scan', title: 'Scanning a room', text: 'MENU > SCAN looks at a place through one lens and files what it finds. Pick the place, pick a lens, start it; the scan theatre shows it reading and what it found. A directed scan also takes a note of what to look for; that one asks you first.', show: { kind: 'page', id: 'scan' } },
  { id: 'rooms', title: 'Rooms', text: 'MENU > ROOMS lists the rooms of the product with their health; tap one to fly the table there.', show: { kind: 'page', id: 'rooms' } },
  { id: 'menu', title: 'The console menu', text: 'MENU opens the console: ROOMS, SCAN, STAND-UP, ASK, PROJECTS, PACKAGES, SETTINGS, PC LINK and TOUR.', show: { kind: 'page', id: 'menu' } },
  { id: 'your-room', title: 'Your room (passthrough)', text: 'STUDIO on the bar fades the studio out and shows your real room around the table; YOUR ROOM brings the studio back. SETTINGS > ROOM changes the brightness and the fade.', show: { kind: 'page', id: 'settings' } },
  { id: 'tour', title: 'The tour and its chapters', text: 'MENU > TOUR replays the first tour and has short chapters: hands and wrist, scan a room, your morning, your room, talk to me, text size, your PC. A chapter opens the page it teaches; STOP TOUR ends it.', show: { kind: 'page', id: 'tour' } },
  { id: 'pairing', title: 'Pairing with your PC', text: 'MENU > PC LINK, tap PAIR: the headset shows a 6-character code for 2 minutes. On your PC open bp\'s Headsets page, type the code, tick what the headset may do (Decide as you, Scan) and APPROVE. Without a PC the table runs the bundled sample.', show: { kind: 'page', id: 'pc-link' } },
  { id: 'sound', title: 'Sound', text: 'SETTINGS has VOICE (100 % by default) and MUSIC (35 %); the music dips under my voice.', show: { kind: 'page', id: 'settings' } },
  { id: 'text-size', title: 'Text size', text: 'SETTINGS changes the text size of the sheets; the tour has a short chapter on it.', show: { kind: 'page', id: 'settings' } },
  { id: 'sample', title: 'Without a PC (the sample)', text: 'With no PC linked, the table shows Kettle, the built-in sample product, and talking plays a scripted sample exchange marked SAMPLE; the microphone is never opened.' },
];

const words = (s: string): string[] => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 -]+/g, ' ').split(/[\s-]+/).filter((w) => w.length > 1);
const STOP = new Set(['how', 'do', 'does', 'the', 'my', 'me', 'is', 'to', 'use', 'what', 'can', 'you', 'it', 'an', 'and', 'of', 'on', 'in', 'with', 'where', 'i']);

/** The entries that match `q` best (a title word counts three times a body word), at most `limit` (1..10); an empty query
 *  answers every entry. */
export function findHelp(q: string, limit = 3): HelpEntry[] {
  const want = words(q).filter((w) => !STOP.has(w));
  if (!want.length) return [...HELP];
  const score = (e: HelpEntry): number => {
    const t = new Set(words(e.title + ' ' + e.id)), b = new Set(words(e.text));
    return want.reduce((n, w) => n + (t.has(w) || [...t].some((x) => x.startsWith(w) && w.length > 3) ? 3 : 0) + (b.has(w) ? 1 : 0), 0);
  };
  return HELP.map((e) => ({ e, s: score(e) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, Math.max(1, Math.min(limit, 10))).map((x) => x.e);
}
