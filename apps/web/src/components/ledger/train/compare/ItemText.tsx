// An item's proposal body (Summary, Description, Flow, Expected impact, Evaluation, a rebuild's Brief) as React
// elements: headings, paragraphs, ordered and bullet lists, quotes, fenced code blocks (the contest winner's renderer
// dropped them) and inline `code` and **bold**. No HTML strings: every piece of text is a React text node.
import { memo, useMemo, type ReactNode } from 'react';
import './ItemText.css';

type Block =
  | { k: 'h'; text: string }
  | { k: 'p'; text: string }
  | { k: 'q'; text: string }
  | { k: 'ol' | 'ul'; items: string[] }
  | { k: 'code'; lang: string; text: string };

/** The body's blocks, line by line. */
export function blocksOf(src: string): Block[] {
  const out: Block[] = [], lines = src.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [], quote: string[] = [], list: { k: 'ol' | 'ul'; items: string[] } | null = null;
  const flush = () => {
    if (para.length) { out.push({ k: 'p', text: para.join(' ') }); para = []; }
    if (quote.length) { out.push({ k: 'q', text: quote.join(' ') }); quote = []; }
    if (list) { out.push(list); list = null; }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m: RegExpExecArray | null;
    if ((m = /^\s*```\s*([\w+-]*)\s*$/.exec(line))) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      out.push({ k: 'code', lang: m[1], text: body.join('\n') });
    } else if ((m = /^#{1,6}\s+(.*)/.exec(line))) { flush(); out.push({ k: 'h', text: m[1].trim() }); }
    else if ((m = /^\s*\d+[.)]\s+(.*)/.exec(line)) || (m = /^\s*[-*+]\s+(.*)/.exec(line))) {
      const k = /^\s*\d/.test(line) ? 'ol' : 'ul';
      if (para.length || quote.length || (list && list.k !== k)) flush();
      if (!list) list = { k, items: [] };
      list.items.push(m[1]);
    } else if ((m = /^\s*>\s?(.*)/.exec(line))) {
      if (para.length || list) flush();
      if (m[1].trim()) quote.push(m[1].trim());
    } else if (!line.trim()) flush();
    else if (list && /^\s{2,}\S/.test(line)) list.items[list.items.length - 1] += ' ' + line.trim(); // a wrapped list item
    else { if (list || quote.length) flush(); para.push(line.trim()); }
  }
  flush();
  return out;
}

/** Inline `code` and **bold** inside a line of text. */
export function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean).map((t, i) =>
    t.startsWith('`') && t.endsWith('`') && t.length > 1 ? <code key={i}>{t.slice(1, -1)}</code>
      : t.startsWith('**') && t.endsWith('**') && t.length > 3 ? <b key={i}>{t.slice(2, -2)}</b>
      : t);
}

export const ItemText = memo(function ItemText({ body }: { body: string }) {
  const blocks = useMemo(() => blocksOf(body), [body]);
  return (
    <div className="tr-md">
      {blocks.map((b, i) => {
        switch (b.k) {
          case 'h': return <h4 key={i}>{inline(b.text)}</h4>;
          case 'p': return <p key={i}>{inline(b.text)}</p>;
          case 'q': return <blockquote key={i}>{inline(b.text)}</blockquote>;
          case 'code': return <pre key={i} data-lang={b.lang || undefined}><code>{b.text}</code></pre>;
          default: { const L = b.k; return <L key={i}>{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</L>; }
        }
      })}
    </div>
  );
});
