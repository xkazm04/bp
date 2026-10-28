import type { Metadata } from 'next';
import { BlueprintApp } from '@/components/BlueprintApp';

export const metadata: Metadata = {
  title: 'Kettle blueprint · the crossing',
  description: 'The Desk Becomes the Table: the crossing from the web blueprint to the VR light table, as a web prototype. Sample data.',
};

// The blueprint itself, with the crossing opened at the hash's place once the plan is there (components/crossing).
export default function CrossingPage() {
  return <BlueprintApp variantId="subtle" />;
}
