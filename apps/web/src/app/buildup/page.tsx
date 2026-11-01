import type { Metadata } from 'next';
import { BuildupLab } from '@/buildup/BuildupLab';

export const metadata: Metadata = {
  title: 'bp · build-up lab',
  description: 'The onboarding build-up: three shortlisted variants driven by one event contract (spark project-onboarding).',
};

// /buildup?v=a|b|e&product=<slug>&source=demo|real&speed=1 - a lab surface, not linked from the product nav.
export default function BuildupPage() {
  return <BuildupLab />;
}
