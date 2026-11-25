import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import StatusPageEmbed from '@/components/status-page/StatusPageEmbed';
import { getOpenStatusSnapshot } from '@/lib/status-pages/public-access';

// Shared-cacheable like the JSON endpoints: the window is short because pages can turn private.
export const revalidate = 30;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Chrome-free widget for iframes. Private, token-gated and disabled pages answer 404. */
export default async function StatusEmbedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const snapshot = await getOpenStatusSnapshot(slug);
  if (!snapshot) notFound();
  return <StatusPageEmbed snapshot={snapshot} />;
}
