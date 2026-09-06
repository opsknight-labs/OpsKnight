import { notFound } from 'next/navigation';
import { getPublicStatusMetadata, renderPublicStatusPage } from '../page';
import { isStatusPageSlug } from '@/lib/validation';
import { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return getPublicStatusMetadata(slug);
}

export default async function SlugStatusPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isStatusPageSlug(slug)) notFound();
  return renderPublicStatusPage(slug);
}
