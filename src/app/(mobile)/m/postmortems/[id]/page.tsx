import prisma from '@/lib/prisma';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import MobileCard from '@/components/mobile/MobileCard';
import { ArrowLeft } from 'lucide-react';
import { getUserPermissions } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MobilePostmortemDetailPage({ params }: PageProps) {
  const { id } = await params;

  const pm = await prisma.postmortem.findUnique({
    where: { id },
    include: {
      incident: {
        select: {
          title: true,
          service: { select: { name: true } },
          createdAt: true,
          resolvedAt: true,
        },
      },
      createdBy: { select: { name: true, email: true } },
    },
  });

  if (!pm) {
    notFound();
  }

  const permissions = await getUserPermissions();
  if (pm.status !== 'PUBLISHED' && !permissions.isResponderOrAbove) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      {/* Header */}
      <div className="space-y-2">
        <Link
          href="/m/postmortems"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Postmortems
        </Link>

        <div className="space-y-2">
          <div
            className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${
              pm.status === 'PUBLISHED'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                : 'bg-[color:var(--bg-secondary)] text-[color:var(--text-secondary)]'
            }`}
          >
            {pm.status}
          </div>
          <h1 className="text-lg font-bold text-[color:var(--text-primary)]">
            Postmortem: {pm.incident.title}
          </h1>
          <div className="text-xs text-[color:var(--text-muted)]">
            Author: {pm.createdBy.name || pm.createdBy.email}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <MobileCard>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
            Executive Summary
          </h3>
          <div className="text-sm leading-relaxed text-[color:var(--text-secondary)]">
            {pm.summary || 'No summary provided.'}
          </div>
        </MobileCard>

        <MobileCard>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
            Root Cause
          </h3>
          <div className="text-sm leading-relaxed text-[color:var(--text-secondary)]">
            {pm.rootCause || 'No root cause analysis provided.'}
          </div>
        </MobileCard>

        {/* Could add Lessons Learned, Timeline, etc here */}
      </div>
    </div>
  );
}
