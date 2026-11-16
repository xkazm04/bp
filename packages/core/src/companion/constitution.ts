// Glim's constitution, parsed (G1, 2026-11-11; registry companion-identity/constitution-self-model-split). The law is the
// owner's file docs/companion/glim-constitution.md; prompt.server.ts reads it and this module checks and renders it. The
// heading vocabulary is CLOSED and defined once, here: every `## ` heading of the file must be one of SECTIONS, each exactly
// once, all present. A heading that is not on the list belongs to nobody and fails the load (nothing can mint a heading).
// WHAT I CAN DO is generated from the catalog's `plain` lines at load (capability-exercise-ledger: the inventory is derived,
// so "what can you do" is answered from the truth). Nothing the companion can call writes the file; its learned notes (the
// brain, memory.note) are the self-model and are loaded apart, below the law. Pure: no Node, no DOM.

import { TOOLS, classOf, type ToolSpec } from './catalog.ts';

export const SECTIONS = ['WHO I AM', "WHAT I'M FOR", 'HOW I TALK', 'WHEN WE GO ELSEWHERE', 'WHAT I NEVER DO', 'WHAT I CAN DO', 'HOW I ACT'] as const;
export type Section = (typeof SECTIONS)[number];
/** The repo-relative file the owner edits. */
export const CONSTITUTION_PATH = 'docs/companion/glim-constitution.md';
export const COMPANION_NAME = 'Glim';

export type Parsed = { ok: true; sections: Record<Section, string> } | { ok: false; error: string };

/** Splits the file at its `## ` headings; the preamble above the first one (the owner's note on the file) is dropped. */
export function parseConstitution(text: string): Parsed {
  const out: Partial<Record<Section, string>> = {};
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let cur: Section | null = null, buf: string[] = [];
  const flush = () => { if (cur) out[cur] = buf.join('\n').trim(); buf = []; };
  for (const l of lines) {
    const h = /^##\s+(.+?)\s*$/.exec(l);
    if (h) {
      flush();
      const name = h[1] as Section;
      if (!SECTIONS.includes(name)) return { ok: false, error: `heading "${h[1]}" is not one of ${SECTIONS.join(', ')}` };
      if (name in out) return { ok: false, error: `heading "${name}" appears twice` };
      cur = name;
      continue;
    }
    if (/^#\s/.test(l) && cur) return { ok: false, error: `a top-level heading inside "${cur}"` };
    if (cur) buf.push(l);
  }
  flush();
  const missing = SECTIONS.filter((s) => !(s in out) || (s !== 'WHAT I CAN DO' && !out[s]));
  if (missing.length) return { ok: false, error: `missing or empty: ${missing.join(', ')}` };
  return { ok: true, sections: out as Record<Section, string> };
}

/** The generated WHAT I CAN DO: one line per catalog tool, in plain words, a card's tools marked. */
export function canDoBlock(tools: readonly ToolSpec[] = TOOLS): string {
  const auto = tools.filter((t) => classOf(t) === 'AUTO'), gated = tools.filter((t) => classOf(t) === 'GATED');
  return [
    'On my own (nothing here spends money, ships code or decides for you):',
    ...auto.map((t) => `- ${t.plain} (${t.name})`),
    'Only with your yes (each files a card; it runs only when you approve it):',
    ...gated.map((t) => `- ${t.plain} (${t.name})`),
    'Nothing else: no web, no files, no shell, no email, no code edits of my own.',
  ].join('\n');
}

/** The law as the prompt's static half carries it: every section in the fixed order, WHAT I CAN DO generated. */
export function renderConstitution(sections: Record<Section, string>, tools: readonly ToolSpec[] = TOOLS): string {
  return SECTIONS.map((s) => `## ${s}\n${s === 'WHAT I CAN DO' ? canDoBlock(tools) : sections[s]}`).join('\n\n');
}
