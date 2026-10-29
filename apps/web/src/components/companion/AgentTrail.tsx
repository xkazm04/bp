'use client';
// "Agents read your decisions": the cards slip's account of agents on the MCP door that read the decision brief before
// proposing (GET /api/companion/trail, packages/core/src/companion/trail.ts words it). It polls, not the companion
// stream: the agent's server and this page may be two processes sharing one BP_HOME, and the bus is per process. Polls
// every TRAIL_POLL_MS while the page is visible; shows the newest session of this product; a session can be put away
// (until it gets a newer row). It steps aside while a decision card is open (companion.css), which says the same thing.
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { TrailSession } from '@bp/core/companion/trail';

export const TRAIL_POLL_MS = 4000;
const ago = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; };

export function AgentTrail({ product }: { product: string }) {
  const [sessions, setSessions] = useState<TrailSession[]>([]);
  const [hidden, setHidden] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await fetch('/api/companion/trail?product=' + encodeURIComponent(product), { signal: AbortSignal.timeout(5000) });
        if (r.ok && live) setSessions(((await r.json()) as { sessions?: TrailSession[] }).sessions ?? []);
      } catch { /* the slip simply keeps what it had */ }
    };
    void load();
    const t = setInterval(load, TRAIL_POLL_MS);
    return () => { live = false; clearInterval(t); };
  }, [product]);
  const shown = sessions.filter((s) => hidden[s.conversation] !== s.at);
  if (!shown.length) return null;
  return (
    <section className="cp-trail" aria-label="Agents read your decisions">
      <AnimatePresence initial={false}>
        {shown.slice(0, 1).map((s) => (
          <motion.div key={s.conversation} className="cp-card cp-tr" layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <div className="tr-k"><span>Agent read your decisions</span><button type="button" aria-label="Put away" onClick={() => setHidden((h) => ({ ...h, [s.conversation]: s.at }))}>✕</button></div>
            <ul>{s.lines.map((l, i) => <li key={i} className={'t-' + l.tone}>{l.text}</li>)}</ul>
            <small>{s.conversation} · {s.reads} brief{s.reads === 1 ? '' : 's'} read · {ago(s.at)}</small>
          </motion.div>
        ))}
      </AnimatePresence>
    </section>
  );
}
