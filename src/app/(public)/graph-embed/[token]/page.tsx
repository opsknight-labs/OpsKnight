import type { Metadata } from 'next';
import GraphEmbed from '@/components/service-graph/GraphEmbed';

export const metadata: Metadata = {
  title: 'Dependency graph',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/** Public, read-only, anonymized graph for a share token. No app chrome; failures are one generic message. */
export default async function GraphEmbedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="mx-auto min-h-screen w-full max-w-[1400px] space-y-3 px-4 py-4">
      <GraphEmbed token={token} />
    </main>
  );
}
