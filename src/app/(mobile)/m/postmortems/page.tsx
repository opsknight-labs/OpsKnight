import prisma from '@/lib/prisma';
import Link from 'next/link';
import { ChevronRight, FileText } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/shadcn/card';
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
    <div className="responsive-page space-y-4">
      <div className="px-0.5 text-[11px] text-muted-foreground">
        {postmortems.length} {postmortems.length === 1 ? 'postmortem' : 'postmortems'}
      </div>

      {postmortems.length === 0 ? (
        <EmptyState
          icon={<FileText aria-hidden="true" />}
          title="No postmortems"
          description="Postmortems appear here after incidents are resolved and reviewed."
          size="sm"
        />
      ) : (
        <Card className="overflow-hidden rounded-xl border-border bg-card shadow-none">
          {postmortems.map((postmortem, index) => (
            <Link
              key={postmortem.id}
              href={`/m/postmortems/${postmortem.id}`}
              className={`block min-w-0 px-3.5 py-3 text-card-foreground transition-colors hover:bg-accent/40 ${
                index > 0 ? 'border-t border-border/70' : ''
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                    postmortem.status === 'PUBLISHED'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                      : 'border-border bg-muted text-muted-foreground'
                  }`}
                >
                  {postmortem.status}
                </span>
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                  <MobileTime value={postmortem.createdAt} format="date" />
                </span>
              </div>
              <div className="mt-1.5 flex min-w-0 items-center gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="line-clamp-2 text-[12px] font-semibold leading-snug text-foreground">
                    {postmortem.incident.title}
                  </h2>
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">
                    {postmortem.incident.service.name} · {postmortem.createdBy?.name || postmortem.createdBy?.email || 'Deleted user'}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </div>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
