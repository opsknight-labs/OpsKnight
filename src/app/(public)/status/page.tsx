/* eslint-disable @typescript-eslint/no-explicit-any */
import { cache } from 'react';
import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import StatusPageSnapshotView from '@/components/status-page/StatusPageSnapshotView';
import { getAuthOptions } from '@/lib/auth';
import { getBaseUrl } from '@/lib/env-validation';
import { getStatusPagePublicUrl } from '@/lib/status-page-url';
import { getStatusPageSnapshotByRoute } from '@/lib/status-pages/snapshot';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const getCachedStatusPageSnapshotByRoute = cache(getStatusPageSnapshotByRoute);

export async function generateMetadata(): Promise<Metadata> {
  return getPublicStatusMetadata();
}

export async function getPublicStatusMetadata(slug?: string): Promise<Metadata> {
  const projected = await getCachedStatusPageSnapshotByRoute(slug || 'default');
  const statusPage = projected.snapshot?.page;
  if (!statusPage) {
    return { title: 'Status Page', description: 'Service status and incident information' };
  }

  const branding =
    statusPage.branding &&
    typeof statusPage.branding === 'object' &&
    !Array.isArray(statusPage.branding)
      ? (statusPage.branding as Record<string, any>)
      : {};
  const title = (branding.metaTitle as string) || statusPage.name;
  const description = (branding.metaDescription as string) || `Status page for ${statusPage.name}`;
  const baseUrl = getBaseUrl();
  const rssUrl = slug
    ? `${baseUrl}/api/status/${encodeURIComponent(slug)}/rss`
    : `${baseUrl}/api/status/rss`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: getStatusPagePublicUrl(statusPage, baseUrl),
      siteName: statusPage.name,
      type: 'website',
    },
    twitter: { card: 'summary', title, description },
    alternates: { types: { 'application/rss+xml': rssUrl } },
  };
}

export default async function PublicStatusPage() {
  return renderPublicStatusPage();
}

export async function renderPublicStatusPage(slug?: string) {
  const projected = await getCachedStatusPageSnapshotByRoute(slug || 'default');
  const snapshot = projected.snapshot;
  const statusPage = snapshot?.page;

  // A missing projection used to be reported as "not configured", which is only true when no page
  // owns this address at all. The route resolving proves one does, so a missing body means the
  // projection is unavailable right now -- an entirely different thing to tell a visitor.
  if (!snapshot || !statusPage) {
    if (!projected.pageId) {
      return (
        <Unavailable
          title="Status page not configured"
          message="No status page has been published at this address."
        />
      );
    }
    if (projected.servingState === 'DISABLED') {
      return (
        <Unavailable
          title="Status page unavailable"
          message="This status page is currently disabled."
        />
      );
    }
    return (
      <Unavailable
        title="Status information unavailable"
        message="We're refreshing the latest service status. Please try again shortly."
      />
    );
  }
  if (statusPage.enabled === false) {
    return (
      <Unavailable
        title="Status page unavailable"
        message="This status page is currently disabled."
      />
    );
  }
  if (statusPage.requireAuth) {
    const session = await getServerSession(await getAuthOptions());
    if (!session) {
      const callbackUrl = slug ? `/status/${encodeURIComponent(slug)}` : '/status';
      redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }
  }

  return <StatusPageSnapshotView snapshot={snapshot} stale={projected.stale} />;
}

/**
 * Shown when there is no projection to render. Deliberately carries no page name, branding or
 * service data: the reason it renders at all is that none of that could be verified.
 */
function Unavailable({ title, message }: { title: string; message: string }) {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '2rem',
        background: '#f8fafc',
        color: '#334155',
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <section
        aria-labelledby="status-unavailable-heading"
        style={{ maxWidth: 460, textAlign: 'center' }}
      >
        <h1
          id="status-unavailable-heading"
          style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 0.5rem', color: '#0f172a' }}
        >
          {title}
        </h1>
        <p style={{ margin: 0, lineHeight: 1.6 }}>{message}</p>
      </section>
    </main>
  );
}
