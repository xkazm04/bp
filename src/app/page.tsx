import type { Metadata } from 'next';
import { BlueprintApp } from '@/components/BlueprintApp';

export const metadata: Metadata = {
  title: 'Kettle blueprint',
  description: 'The product drawn as a blueprint, with a simulated agent swarm at work. Sample data.',
};

// The owner adopted the subtle lens expression (2026-10-09); the three prototypes stay at /variants.
export default function Home() {
  return <BlueprintApp variantId="subtle" />;
}
