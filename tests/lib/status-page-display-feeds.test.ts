import { describe, expect, it } from 'vitest';
import {
  changelogDisplayWhere,
  currentAnnouncementDisplayWhere,
  maintenanceInProgressDisplayWhere,
  maintenanceUpcomingDisplayWhere,
  mergeDisplayMaintenance,
  STATUS_PAGE_DISPLAY_FEED_LIMIT,
} from '@/lib/status-pages/display-feeds';

const now = new Date('2026-09-10T12:00:00.000Z');

describe('status page display feeds', () => {
  it('gives each public category its own bounded query instead of one shared take-200', () => {
    expect(STATUS_PAGE_DISPLAY_FEED_LIMIT).toBe(200);
    expect(currentAnnouncementDisplayWhere('page-1', now)).toMatchObject({
      type: { notIn: ['MAINTENANCE', 'UPDATE'] },
      startDate: { lte: now },
    });
    expect(maintenanceInProgressDisplayWhere('page-1', now)).toMatchObject({
      type: 'MAINTENANCE',
      startDate: { lte: now },
    });
    expect(maintenanceUpcomingDisplayWhere('page-1', now)).toMatchObject({
      type: 'MAINTENANCE',
      startDate: { gt: now },
    });
    expect(changelogDisplayWhere('page-1', now)).toMatchObject({
      type: 'UPDATE',
      startDate: { lte: now },
    });
  });

  it('keeps in-progress maintenance ahead of upcoming windows', () => {
    expect(
      mergeDisplayMaintenance(
        [{ id: 'current' }, { id: 'dup' }],
        [{ id: 'dup' }, { id: 'soon' }]
      ).map(item => item.id)
    ).toEqual(['current', 'dup', 'soon']);
  });
});
