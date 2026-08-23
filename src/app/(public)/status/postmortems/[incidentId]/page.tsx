import prisma from '@/lib/prisma';
import { notFound } from 'next/navigation';
import PostmortemDetailView from '@/components/postmortem/PostmortemDetailView';
import Link from 'next/link';

export default async function PublicPostmortemPage({
  params,
}: {
  params: Promise<{ incidentId: string }>;
}) {
  const { incidentId } = await params;

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
      ...postmortem.createdBy,
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
