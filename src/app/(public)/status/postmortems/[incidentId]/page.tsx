import prisma from '@/lib/prisma';
import { notFound, redirect } from 'next/navigation';
import PostmortemDetailView from '@/components/postmortem/PostmortemDetailView';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';

export default async function PublicPostmortemPage({
  params,
}: {
  params: Promise<{ incidentId: string }>;
}) {
  const { incidentId } = await params;

  const statusPage = await prisma.statusPage.findFirst({
    where: { enabled: true },
    select: { requireAuth: true },
  });
  if (statusPage?.requireAuth) {
    const session = await getServerSession(await getAuthOptions());
    if (!session) redirect(`/login?callbackUrl=/status/postmortems/${incidentId}`);
  }

  const postmortem = await prisma.postmortem.findFirst({
    where: {
      incidentId,
      status: 'PUBLISHED',
      isPublic: true,
    },
    include: {
      incident: {
        select: {
          id: true,
          title: true,
          resolvedAt: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  if (!postmortem) {
    notFound();
  }

  const sanitizedPostmortem = {
    ...postmortem,
    createdBy: {
      id: postmortem.createdBy?.id ?? 'deleted-user',
      name: postmortem.createdBy?.name ?? 'OpsKnight Team',
      email: '',
    },
  };

  return (
    <main style={{ padding: 'var(--spacing-6)' }}>
      <div style={{ marginBottom: 'var(--spacing-6)' }}>
        <Link
          href="/status"
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
      />
    </main>
  );
}
