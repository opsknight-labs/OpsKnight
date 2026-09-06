import prisma from '@/lib/prisma';
import Link from 'next/link';
import MobileCard from '@/components/mobile/MobileCard';
import { ChevronRight } from 'lucide-react';
import MobileTime from '@/components/mobile/MobileTime';

export const dynamic = 'force-dynamic';

export default async function MobilePostmortemsPage() {
  const postmortems = await prisma.postmortem.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      incident: {
        select: {
          title: true,
          service: { select: { name: true } },
        },
      },
      createdBy: { select: { name: true, email: true } },
    },
    take: 20,
  });

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-[color:var(--text-primary)]">
          Postmortems
        </h1>
        <p className="mt-1 text-xs font-medium text-[color:var(--text-muted)]">
          {postmortems.length} total
        </p>
      </div>

      {postmortems.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-6 py-10 text-center">
          <div className="text-3xl">📝</div>
          <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">No postmortems</h3>
          <p className="text-xs text-[color:var(--text-muted)]">
            Postmortems are created from resolved incidents
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {postmortems.map(pm => (
            <Link key={pm.id} href={`/m/postmortems/${pm.id}`} className="no-underline">
              <MobileCard className="flex items-center gap-3">
                <div className="flex flex-1 flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        pm.status === 'PUBLISHED'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                          : 'bg-[color:var(--bg-secondary)] text-[color:var(--text-secondary)]'
                      }`}
                    >
                      {pm.status}
                    </span>
                    <span className="text-[11px] text-[color:var(--text-muted)]">
                      <MobileTime value={pm.createdAt} format="date" />
                    </span>
                  </div>

                  <div className="text-sm font-semibold text-[color:var(--text-primary)]">
                    {pm.incident.title}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--text-muted)]">
                    <span>{pm.incident.service.name}</span>
                    <span>•</span>
                    <span>By {pm.createdBy?.name || pm.createdBy?.email || 'Deleted user'}</span>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-[color:var(--text-muted)]" />
              </MobileCard>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
