'use client';
// The neutral slip of the companion's cards (GATED tool calls waiting for the person), shown by the host when the skin
// does not draw cards itself (LampSkin.ownsCards). Front: the card's plain-words summary and up to three facts from its
// args; Approve and Decline are the ledger's Btn. A decided card reads its outcome and fades out after CARD_FADE_MS.
// Also the host's one notice line with a link (a focus command for another product: it never navigates on its own).
import { AnimatePresence, motion } from 'motion/react';
import type { Card } from '@bp/core/companion/contract';
import { Btn } from '../ledger/train/ui/Controls';

const short = (v: unknown): string => {
  if (v === null || v === undefined) return '-';
  if (Array.isArray(v)) return v.length <= 3 ? v.map(short).join(', ') : v.length + ' items';
  if (typeof v === 'object') return Object.keys(v).length + ' fields';
  const s = String(v);
  return s.length > 40 ? s.slice(0, 39) + '…' : s;
};
/** Up to three `name: value` facts from a card's args, in their own order. */
export function cardFacts(args: unknown): [string, string][] {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return [];
  return Object.entries(args as Record<string, unknown>).filter(([, v]) => v !== undefined).slice(0, 3).map(([k, v]) => [k, short(v)]);
}
const OUTCOME: Record<Card['state'], string> = { pending: '', approved: 'Approved', declined: 'Declined', expired: 'Expired', done: 'Done', failed: 'Failed' };

export function Cards({ cards, onCard }: { cards: readonly Card[]; onCard(id: string, d: 'approve' | 'decline'): void }) {
  return (
    <ul className="cp-cards" aria-label="Waiting for you">
      <AnimatePresence initial={false}>
        {cards.map((c) => (
          <motion.li key={c.id} className={'cp-card s-' + c.state} layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <p className="cp-sum">{c.summary}</p>
            {cardFacts(c.args).length > 0 && (
              <dl className="cp-facts">{cardFacts(c.args).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
            )}
            {c.state === 'pending'
              ? <div className="cp-acts"><Btn tone="go" onClick={() => onCard(c.id, 'approve')}>Approve</Btn><Btn onClick={() => onCard(c.id, 'decline')}>Decline</Btn></div>
              : <p className="cp-out">{OUTCOME[c.state]}{c.decidedBy === 'policy' ? ' by policy' : ''}</p>}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

export function Notice({ text, href, onClose }: { text: string; href: string; onClose(): void }) {
  return (
    <motion.div className="cp-note" role="status" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <span>{text}</span>
      <a href={href}>Open</a>
      <button type="button" aria-label="Dismiss" onClick={onClose}>✕</button>
    </motion.div>
  );
}
