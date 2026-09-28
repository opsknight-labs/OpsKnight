import type { LoadUserFixture, ScaleDimensions } from '../users';

export interface LoadScheduleLayerFixture {
  id: string;
  scheduleId: string;
  name: string;
  start: Date;
  rotationLengthHours: number;
  shiftLengthHours: number;
  priority: number;
  userIds: string[];
}

export interface LoadScheduleOverrideFixture {
  id: string;
  scheduleId: string;
  userId: string;
  replacesUserId: string;
  start: Date;
  end: Date;
}

export interface LoadScheduleFixture {
  id: string;
  name: string;
  timeZone: string;
  layers: LoadScheduleLayerFixture[];
  overrides: LoadScheduleOverrideFixture[];
}

const SCHEDULE_TIMEZONES = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Kolkata'] as const;

export function buildScheduleFixtures(
  scale: ScaleDimensions,
  users: LoadUserFixture[],
  referenceTime = new Date()
): LoadScheduleFixture[] {
  const schedules: LoadScheduleFixture[] = [];
  const responders = users.filter(u => u.role !== 'USER');
  const pool = responders.length > 0 ? responders : users;

  // Anchor layer start 30 days in the past so rotation math is always active
  const layerStart = new Date(referenceTime.getTime() - 30 * 24 * 60 * 60 * 1000);
  const overrideStart = new Date(referenceTime.getTime() - 2 * 60 * 60 * 1000);
  const overrideEnd = new Date(referenceTime.getTime() + 6 * 60 * 60 * 1000);

  for (let i = 0; i < scale.schedules; i++) {
    const index = i + 1;
    const scheduleId = `lt-schedule-${String(index).padStart(3, '0')}`;
    const offset = (i * 4) % pool.length;

    const primaryUsers = [
      pool[offset % pool.length].id,
      pool[(offset + 1) % pool.length].id,
      pool[(offset + 2) % pool.length].id,
    ];
    const secondaryUsers = [
      pool[(offset + 3) % pool.length].id,
      pool[(offset + 4) % pool.length].id,
      pool[(offset + 5) % pool.length].id,
    ];

    const layers: LoadScheduleLayerFixture[] = [
      {
        id: `lt-layer-pri-${String(index).padStart(3, '0')}`,
        scheduleId,
        name: 'Primary 24x7 Rotation',
        start: layerStart,
        rotationLengthHours: 24,
        shiftLengthHours: 8,
        priority: 10,
        userIds: primaryUsers,
      },
      {
        id: `lt-layer-sec-${String(index).padStart(3, '0')}`,
        scheduleId,
        name: 'Secondary Shadow Rotation',
        start: layerStart,
        rotationLengthHours: 168,
        shiftLengthHours: 24,
        priority: 5,
        userIds: secondaryUsers,
      },
    ];

    const overrides: LoadScheduleOverrideFixture[] =
      index % 3 === 0
        ? [
            {
              id: `lt-override-${String(index).padStart(3, '0')}`,
              scheduleId,
              userId: secondaryUsers[0],
              replacesUserId: primaryUsers[0],
              start: overrideStart,
              end: overrideEnd,
            },
          ]
        : [];

    schedules.push({
      id: scheduleId,
      name: `LoadCert On-Call Schedule ${String(index).padStart(3, '0')}`,
      timeZone: SCHEDULE_TIMEZONES[i % SCHEDULE_TIMEZONES.length],
      layers,
      overrides,
    });
  }

  return schedules;
}
