import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BlueprintApp } from '@/components/BlueprintApp';
import { VARIANT_IDS, getVariant } from '@/variants/registry';
import type { VariantId } from '@/variants/types';

export const dynamicParams = false;

export function generateStaticParams() {
  return VARIANT_IDS.map((variant) => ({ variant }));
}

export async function generateMetadata({ params }: { params: Promise<{ variant: string }> }): Promise<Metadata> {
  const { variant } = await params;
  const v = getVariant(variant);
  return { title: v ? 'Kettle blueprint · ' + v.name : 'Kettle blueprint', description: v?.description };
}

export default async function VariantPage({ params }: { params: Promise<{ variant: string }> }) {
  const { variant } = await params;
  if (!getVariant(variant)) notFound();
  return <BlueprintApp variantId={variant as VariantId} />;
}
