// A job log's text as markdown blocks. A Claude Code run answers in markdown (headings, lists, **bold**, `code`, fences), and
// the Agents rail used to show it raw in a <pre>, stars and backticks included. This reads the few shapes a reply uses into
// plain data the rail renders as React elements: nothing becomes HTML or a link (the text is a product repo's CLI output), and
// a line it does not read stays as written. Pure: no React, no DOM.

export type Span = { t: 'text' | 'b' | 'code'; s: string };
export type LogBlock =
  | { k: 'h'; level: 1 | 2 | 3; spans: Span[] }
  | { k: 'p'; spans: Span[] }
  | { k: 'li'; ordered: boolean; n: string; depth: number; spans: Span[] }
  | { k: 'code'; text: string };

/** `**bold**` and `` `code` `` in one line; an unclosed marker stays literal. Code wins inside bold markers' reach. */
export function spans(line: string): Span[] {
  const out: Span[] = [];
  const re = /`([^`]+)`|\*\*(.+?)\*\*/g;
  let at = 0;
  for (let m: RegExpExecArray | null; (m = re.exec(line)); ) {
    if (m.index > at) out.push({ t: 'text', s: line.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ t: 'code', s: m[1] });
    else for (const x of spans(m[2])) out.push(x.t === 'text' ? { t: 'b', s: x.s } : x); // `code` inside bold stays code
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push({ t: 'text', s: line.slice(at) });
  return out;
}

/** The log as blocks: fenced code (an unclosed fence runs to the end, as a tail may cut one), headings, list items, and
 *  paragraphs (consecutive plain lines join with a space). Blank lines separate blocks. */
export function logBlocks(text: string): LogBlock[] {
  const out: LogBlock[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push({ k: 'p', spans: spans(para.join(' ')) }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*```/.test(l)) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) body.push(lines[i]);
      out.push({ k: 'code', text: body.join('\n') });
      continue;
    }
    if (!l.trim()) { flush(); continue; }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (h) { flush(); out.push({ k: 'h', level: Math.min(h[1].length, 3) as 1 | 2 | 3, spans: spans(h[2]) }); continue; }
    const li = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(l);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]);
      out.push({ k: 'li', ordered, n: ordered ? li[2].replace(')', '.') : '', depth: Math.min(Math.floor(li[1].replace(/\t/g, '  ').length / 2), 3), spans: spans(li[3]) });
      continue;
    }
    para.push(l.trim());
  }
  flush();
  return out;
}
