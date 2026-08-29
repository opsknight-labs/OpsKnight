import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { buildScheduleBlocks, getFinalScheduleBlocks } from '@/lib/oncall';

function formatICalDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
                  name: true,
                  avatarUrl: true,
                  gender: true,
                },
              },
            },
            orderBy: { position: 'asc' },
          },
        },
      },
      overrides: {
        include: {
          user: {
            select: {
              name: true,
              avatarUrl: true,
              gender: true,
            },
          },
        },
      },
    },
  });

  if (!schedule) {
    return new NextResponse('Schedule not found', { status: 404 });
  }

  const now = new Date();
  const rangeStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days past
  const rangeEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days future

  const typedLayers = schedule.layers.map(layer => ({
    id: layer.id,
    name: layer.name,
    start: new Date(layer.start),
    end: layer.end ? new Date(layer.end) : null,
    rotationLengthHours: layer.rotationLengthHours,
    shiftLengthHours: layer.shiftLengthHours,
    restrictions: layer.restrictions as any,
    users: layer.users.map(u => ({
      userId: u.userId,
      position: u.position,
      user: {
        name: u.user.name,
        avatarUrl: u.user.avatarUrl,
        gender: u.user.gender,
      },
    })),
  }));

  const typedOverrides = schedule.overrides.map(override => ({
    id: override.id,
    userId: override.userId,
    user: {
      name: override.user.name,
      avatarUrl: override.user.avatarUrl,
      gender: override.user.gender,
    },
    start: new Date(override.start),
    end: new Date(override.end),
    replacesUserId: override.replacesUserId,
  }));

  const layerPriorities = new Map(schedule.layers.map(l => [l.id, l.priority ?? 0]));
  const scheduleBlocks = buildScheduleBlocks(
    typedLayers,
    typedOverrides,
    rangeStart,
    rangeEnd,
    schedule.timeZone
  );
  const effectiveBlocks = getFinalScheduleBlocks(scheduleBlocks, layerPriorities);

  // Build RFC 5545 iCalendar content
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpsKnight//On-Call Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:OpsKnight - ${schedule.name}`,
    `X-WR-TIMEZONE:${schedule.timeZone}`,
  ];

  for (const block of effectiveBlocks) {
    const uid = `${block.id}-${formatICalDate(block.start)}@opsknight`;
    const dtstamp = formatICalDate(now);
    const dtstart = formatICalDate(block.start);
    const dtend = formatICalDate(block.end);
    const summary = `On-Call: ${block.userName} (${block.layerName})`;
    const description = `Schedule: ${schedule.name}\\nLayer: ${block.layerName}\\nResponder: ${block.userName}\\nTimezone: ${schedule.timeZone}`;

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${dtstart}`,
      `DTEND:${dtend}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${description}`,
      'STATUS:CONFIRMED',
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  const icsContent = lines.join('\r\n');

  return new NextResponse(icsContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="schedule-${schedule.id}.ics"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}
