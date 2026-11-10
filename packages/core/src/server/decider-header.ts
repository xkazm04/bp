// Pure: one constant, no imports, no React, DOM or Next.
// The header that carries a paired headset's decider seal inside apps/server (decider.server.ts says what it proves).
// Its own module, with no imports, so apps/server's mount.ts can strip it without loading the companion's server half.
export const DECIDER_SEAL_HEADER = 'x-bp-decider-seal';
/** The same kind of in-process mark for a pairing that holds `onboard` (table-link-v2.md section 14): it may start reading a
 *  project the PC offers. Its own header and its own value, so `decide` never implies `onboard` or the other way round. */
export const ONBOARD_SEAL_HEADER = 'x-bp-onboard-seal';
