import type { Metadata } from 'next';
import { BuildupLab } from '@/buildup/BuildupLab';

export const metadata: Metadata = {
  title: 'bp · build-up lab',
  description: 'The onboarding build-up (the outline becomes the building), driven by the onboarding event contract.',
};

// /buildup?product=<slug>&source=demo|real|live[&feed=<origin>]&speed=1 - a lab surface, not linked from the product nav.
export default function BuildupPage() {
  return <BuildupLab />;
}
