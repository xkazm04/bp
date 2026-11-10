import type { Metadata } from 'next';
import { HeadsetsPage } from '@/headsets/HeadsetsPage';

export const metadata: Metadata = {
  title: 'bp · headsets',
  description: 'Pair a VR headset with this PC by the code it shows, see and revoke paired headsets, and read what was decided at the table.',
};

// /headsets (`?fixture=1`, `off`, `cable`, `paired`, `empty`, `noserver` or `nowire` fakes the server for screenshots:
// apps/web/src/headsets/api.ts).
export default function Headsets() {
  return <HeadsetsPage />;
}
