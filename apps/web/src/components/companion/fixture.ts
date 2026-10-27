// The scripted timeline `?lamp-fixture=1` plays: every LampState, a streamed caption, a waiting card and a pointing target,
// with no server. It loops, so a skin can be watched (and captured) in each state. Times are ms from the loop's start.
import type { Card, LampState } from '@bp/core/companion/contract';

export interface FixtureFrame {
  at: number;
  state: LampState;
  caption?: string;
  /** Point at a rect given as fractions of the viewport (x, y, w, h in 0..1). */
  target?: { x: number; y: number; w: number; h: number };
  cards?: Card[];
}

const card: Card = {
  id: 'fx-card-1', tool: 'wave.dispatch', args: { slug: 'kettle', wave: 'w-3' }, product: 'kettle', state: 'pending',
  summary: 'Dispatch wave "Checkout polish": 3 packages, 7 findings. This queues build jobs that edit code.',
  createdAt: '2026-10-26T09:00:00Z',
};

export const FIXTURE: FixtureFrame[] = [
  { at: 0, state: 'idle' },
  { at: 3000, state: 'listening', caption: 'What should I look at first?' },
  { at: 5500, state: 'thinking' },
  { at: 8000, state: 'speaking', caption: 'Three decisions are waiting across bp and pof.' },
  { at: 9500, state: 'speaking', caption: 'Three decisions are waiting across bp and pof. The oldest is a stop-ship in Checkout.' },
  { at: 12000, state: 'pointing', caption: 'This one - the payment retry has no timeout.', target: { x: 0.38, y: 0.42, w: 0.14, h: 0.12 } },
  { at: 16000, state: 'working', caption: 'Composing a wave from the four checkout findings...' },
  { at: 19500, state: 'asking', caption: 'The wave is drafted. Dispatch it?', cards: [card] },
  { at: 25000, state: 'speaking', caption: 'Dispatched. I will tell you when the first package lands.' },
  { at: 28000, state: 'idle' },
];
export const FIXTURE_LOOP_MS = 31000;

/** The frame at `t` ms into the loop. */
export function frameAt(t: number): FixtureFrame {
  const m = t % FIXTURE_LOOP_MS;
  let f = FIXTURE[0];
  for (const x of FIXTURE) if (x.at <= m) f = x;
  return f;
}
