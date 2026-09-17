import prisma from '@/lib/prisma';
import { notFound, redirect } from 'next/navigation';
import PostmortemDetailView from '@/components/postmortem/PostmortemDetailView';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { resolveStatusPage } from '@/lib/status-page-resolver';
import { canPublishIncidentToStatusPage } from '@/lib/status-page-publication';
import { serializePublicPostmortem } from '@/lib/status-pages/public-postmortem';
import { deriveJiraCapability } from '@/lib/jira-capabilities';

import { cookies, headers } from 'next/headers';
import { getAppUrl } from '@/lib/app-config';
import {
  STATUS_SESSION_COOKIE_NAME,
  hasStatusPageAccess,
  isRequestToAppHost,
} from '@/lib/status-pages/status-auth';

const PUBLIC_READ_ONLY_JIRA_CAPABILITY = deriveJiraCapability({
  workspaceState: 'NOT_CONFIGURED',
  canManage: false,
  serviceMapped: false,
  syncEnabled: false,
  rawEnabled: false,
});

export default async function PublicPostmortemPage({
  params,
}: {
  params: Promise<{ incidentId: string }>;
}) {
  const { incidentId } = await params;
  return renderPublicPostmortem(incidentId);
}

export async function renderPublicPostmortem(incidentId: string, slug?: string) {
  const statusPage = await resolveStatusPage(slug ? { slug } : { default: true });
  if (!statusPage) notFound();
  if (statusPage?.requireAuth) {
    const cookieStore = await cookies();
    const statusCookie = cookieStore.get(STATUS_SESSION_COOKIE_NAME)?.value;
    const headerStore = await headers();
    const host =
      headerStore
        .get('x-forwarded-host')
        ?.split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .at(-1) ||
      headerStore.get('host') ||
      '';
    const appUrl = await getAppUrl();
    const isAppHost = isRequestToAppHost(host, appUrl);

    let isAuthorized = false;
    if (statusCookie) {
      isAuthorized = await hasStatusPageAccess({
        pageId: statusPage.id,
        statusSessionCookie: statusCookie,
        isAppHost,
      });
    }
    if (!isAuthorized && isAppHost) {
      const session = await getServerSession(await getAuthOptions());
      isAuthorized = !!session;
    }

    if (!isAuthorized) {
      if (isAppHost) {
        const callbackUrl = slug
          ? `/status/${encodeURIComponent(slug)}/postmortems/${incidentId}`
          : `/status/postmortems/${incidentId}`;
        redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
      } else {
        const proto = headerStore.get('x-forwarded-proto') || 'https';
        const currentUrl = `${proto}://${host}/postmortems/${encodeURIComponent(incidentId)}`;
        redirect(
          `${appUrl}/status-auth/start?pageId=${encodeURIComponent(statusPage.id)}&returnTo=${encodeURIComponent(currentUrl)}`
        );
      }
    }
  }

  const postmortem = await prisma.postmortem.findFirst({
    where: {
      OR: [{ id: incidentId }, { incidentId }],
      incident: { visibility: 'PUBLIC' },
      status: 'PUBLISHED',
      isPublic: true,
    },
    select: {
      id: true,
      incidentId: true,
      title: true,
      summary: true,
      timeline: true,
      impact: true,
      rootCause: true,
      resolution: true,
      lessons: true,
      status: true,
      isPublic: true,
      createdAt: true,
      publishedAt: true,
      incident: {
        select: {
          id: true,
          title: true,
          resolvedAt: true,
        },
      },
    },
  });

  if (!postmortem) {
    notFound();
  }

  if (!(await canPublishIncidentToStatusPage(statusPage.id, postmortem.incidentId, 'postmortem'))) {
    notFound();
  }

  const sanitizedPostmortem = serializePublicPostmortem(postmortem);

  return (
    <main style={{ padding: 'var(--spacing-6)' }}>
      <div style={{ marginBottom: 'var(--spacing-6)' }}>
        <Link
          href={slug ? `/status/${encodeURIComponent(slug)}` : '/status'}
          style={{
            color: 'var(--text-muted)',
            textDecoration: 'none',
            fontSize: 'var(--font-size-sm)',
            marginBottom: 'var(--spacing-2)',
            display: 'inline-block',
          }}
        >
          ← Back to Status Page
        </Link>
      </div>
      <PostmortemDetailView
        postmortem={sanitizedPostmortem}
        users={[]}
        canEdit={false}
        incidentId={incidentId}
        isPublicView={true}
        jiraCapability={PUBLIC_READ_ONLY_JIRA_CAPABILITY}
      />
    </main>
  );
}
