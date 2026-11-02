import type { Metadata } from 'next';
import { OnboardingScreen } from '@/onboarding/OnboardingScreen';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: decodeURIComponent(slug) + ' · onboarding', description: 'The project being onboarded: its plan drawn as the run learns it.' };
}

// /projects/<slug>/onboarding[?job=<id>][?preset=demo|real][?feed=<origin>]: the adopt job's build-up, full window.
export default async function OnboardingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <OnboardingScreen slug={decodeURIComponent(slug)} />;
}
