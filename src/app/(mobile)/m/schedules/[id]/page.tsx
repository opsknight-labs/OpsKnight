import prisma from '@/lib/prisma';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MobileAvatar } from '@/components/mobile/MobileUtils';
import { getDefaultAvatar } from '@/lib/avatar';
import MobileCard from '@/components/mobile/MobileCard';
import { ArrowLeft } from 'lucide-react';
import { getActiveOnCallShifts } from '@/lib/oncall-shifts';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MobileScheduleDetailPage({ params }: PageProps) {
  const { id } = await params;

  const schedule = await prisma.onCallSchedule.findUnique({
    where: { id },
    include: {
      layers: {
        include: {
          users: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatarUrl: true,
                  gender: true,
                },
              },
            },
            orderBy: { position: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      },
    },
  });

  if (!schedule) {
    notFound();
  }

  const activeShifts = await getActiveOnCallShifts();
  const currentShift = activeShifts.find(s => s.scheduleId === schedule.id);
  const currentOnCall = currentShift
    ? {
        id: currentShift.user.id,
        name: currentShift.user.name,
        email: '',
        avatarUrl: currentShift.user.avatarUrl,
        gender: currentShift.user.gender ?? null,
      }
    : null;
  const totalParticipants = schedule.layers.reduce((acc, layer) => acc + layer.users.length, 0);

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      {/* Back Button */}
      <Link
        href="/m/schedules"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Schedules
      </Link>

      {/* Schedule Header */}
      <MobileCard padding="lg">
        <div className="space-y-2">
          <h1 className="text-lg font-bold text-[color:var(--text-primary)]">{schedule.name}</h1>
          <p className="text-xs text-[color:var(--text-muted)]">
            📅 {schedule.layers.length} layer{schedule.layers.length !== 1 ? 's' : ''} • 👥{' '}
            {totalParticipants} participant{totalParticipants !== 1 ? 's' : ''}
          </p>
          {schedule.timeZone && (
            <p className="text-[11px] text-[color:var(--text-muted)]">
              🌍 Timezone: {schedule.timeZone}
            </p>
          )}
        </div>

        {/* Current On-Call */}
        {currentOnCall && (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-900/40 dark:bg-emerald-950/40">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              CURRENTLY ON-CALL
            </div>
            <div className="mt-2 flex items-center gap-2">
              <MobileAvatar
                name={currentOnCall.name || currentOnCall.email}
                size="sm"
                src={
                  currentOnCall.avatarUrl ||
                  getDefaultAvatar(currentOnCall.gender, currentOnCall.id)
                }
              />
              <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                {currentOnCall.name || currentOnCall.email}
              </span>
            </div>
          </div>
        )}
      </MobileCard>

      {/* Layers Section */}
      <div className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
          Rotation Layers
        </h3>
        <div className="flex flex-col gap-3">
          {schedule.layers.map((layer, index) => (
            <MobileCard key={layer.id} padding="md">
              <div className="mb-3">
                <div className="text-sm font-semibold text-[color:var(--text-primary)]">
                  {layer.name || `Layer ${index + 1}`}
                </div>
                <div className="mt-1 text-[11px] text-[color:var(--text-muted)]">
                  ⏱️ {layer.rotationLengthHours}h rotation • {layer.users.length} participants
                </div>
              </div>

              {/* Layer Participants */}
              <div className="flex flex-col gap-2">
                {layer.users.map((layerUser, userIndex) => (
                  <div
                    key={layerUser.id}
                    className="flex items-center gap-2 rounded-lg bg-[color:var(--bg-secondary)] px-2.5 py-2"
                  >
                    <span className="w-6 text-[10px] font-semibold text-[color:var(--text-muted)]">
                      #{userIndex + 1}
                    </span>
                    <MobileAvatar
                      name={layerUser.user.name || layerUser.user.email}
                      size="sm"
                      src={
                        layerUser.user.avatarUrl ||
                        getDefaultAvatar(layerUser.user.gender, layerUser.user.id)
                      }
                    />
                    <span className="text-sm text-[color:var(--text-primary)]">
                      {layerUser.user.name || layerUser.user.email}
                    </span>
                  </div>
                ))}
              </div>
            </MobileCard>
          ))}
        </div>
      </div>

      {/* View on Desktop Link */}
      <div className="pt-2 text-center">
        <Link href={`/schedules/${schedule.id}`} className="text-sm font-semibold text-primary">
          View full schedule on desktop →
        </Link>
      </div>
    </div>
  );
}
