import prisma from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { CalendarClock, Monitor, PhoneCall, UsersRound } from 'lucide-react';
import { MobileAvatar } from '@/components/mobile/MobileUtils';
import { getDefaultAvatar } from '@/lib/avatar';
import {
  MobileDetailHeader,
  MobileIconTile,
  MobileListCard,
  MobileListRow,
  MobileSection,
  MobileToneBadge,
} from '@/components/mobile/MobileList';
import EmptyState from '@/components/patterns/EmptyState';
import { getActiveOnCallShifts } from '@/lib/oncall-shifts';
import { assertCanViewSchedule } from '@/lib/rbac';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MobileScheduleDetailPage({ params }: PageProps) {
  await requirePageAccess('/m/schedules/[id]');
  const { id } = await params;
  try {
    await assertCanViewSchedule(id);
  } catch {
    notFound();
  }

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

  const currentOnCall = (await getActiveOnCallShifts(new Date(), schedule.id)).map(shift => ({
    id: shift.user.id,
    name: shift.user.name,
    email: '',
    avatarUrl: shift.user.avatarUrl,
    gender: shift.user.gender ?? null,
  }));
  const totalParticipants = schedule.layers.reduce((acc, layer) => acc + layer.users.length, 0);

  return (
    <div className="responsive-page space-y-4">
      <MobileDetailHeader
        leading={<MobileIconTile icon={CalendarClock} tone="shift" size="lg" />}
        title={schedule.name}
        badges={
          currentOnCall.length > 0 ? (
            <MobileToneBadge tone="shift" icon={PhoneCall}>
              {currentOnCall.length} on call now
            </MobileToneBadge>
          ) : (
            <MobileToneBadge tone={null}>Nobody on call</MobileToneBadge>
          )
        }
        facts={[
          {
            label: 'Rotation layers',
            value: schedule.layers.length,
          },
          { label: 'Participants', value: totalParticipants },
          ...(schedule.timeZone ? [{ label: 'Time zone', value: schedule.timeZone }] : []),
        ]}
      />

      <MobileSection id="schedule-oncall" title="On call now">
        {currentOnCall.length === 0 ? (
          <EmptyState
            icon={<PhoneCall aria-hidden="true" />}
            title="Nobody is on call right now"
            description="This schedule has a gap at the moment. Pages fall through to the next escalation step until a shift starts."
            size="sm"
            headingLevel="h3"
          />
        ) : (
          <MobileListCard>
            {currentOnCall.map(responder => (
              <MobileListRow
                key={responder.id}
                leading={
                  <MobileAvatar
                    name={responder.name || responder.email}
                    size="md"
                    src={responder.avatarUrl || getDefaultAvatar(responder.gender, responder.id)}
                  />
                }
                title={responder.name || responder.email}
                trailing={
                  <MobileToneBadge tone="shift" icon={PhoneCall}>
                    On call
                  </MobileToneBadge>
                }
              />
            ))}
          </MobileListCard>
        )}
      </MobileSection>

      {schedule.layers.length === 0 ? (
        <EmptyState
          icon={<UsersRound aria-hidden="true" />}
          title="No rotation layers"
          description="Add a layer with responders in the desktop workspace to start paging people from this schedule."
          size="sm"
        />
      ) : (
        schedule.layers.map((layer, index) => (
          <MobileSection
            key={layer.id}
            id={`schedule-layer-${layer.id}`}
            title={layer.name || `Layer ${index + 1}`}
            description={`${layer.rotationLengthHours}h rotation · ${layer.users.length} ${
              layer.users.length === 1 ? 'participant' : 'participants'
            }`}
          >
            {layer.users.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-3.5 py-3 text-sm text-muted-foreground">
                No responders in this layer yet.
              </p>
            ) : (
              <MobileListCard>
                {layer.users.map((layerUser, userIndex) => (
                  <MobileListRow
                    key={layerUser.id}
                    leading={
                      <span className="flex items-center gap-2.5">
                        <span className="w-5 text-right text-xs font-medium tabular-nums text-muted-foreground">
                          {userIndex + 1}
                        </span>
                        <MobileAvatar
                          name={layerUser.user.name || layerUser.user.email}
                          size="sm"
                          src={
                            layerUser.user.avatarUrl ||
                            getDefaultAvatar(layerUser.user.gender, layerUser.user.id)
                          }
                        />
                      </span>
                    }
                    title={layerUser.user.name || layerUser.user.email}
                  />
                ))}
              </MobileListCard>
            )}
          </MobileSection>
        ))
      )}

      <MobileListCard label="Desktop workspace">
        <MobileListRow
          href={`/schedules/${schedule.id}`}
          leading={<MobileIconTile icon={Monitor} />}
          title="Open full schedule"
          subtitle="Overrides, calendar and layer editing on desktop"
        />
      </MobileListCard>
    </div>
  );
}
