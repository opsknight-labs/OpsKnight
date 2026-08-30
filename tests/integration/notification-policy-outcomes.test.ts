import { beforeEach, describe, expect, it } from 'vitest';
import { sendIncidentNotifications, sendUserNotification } from '@/lib/user-notifications';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('notification policy outcomes', { timeout: 30000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function setupRecipientWithoutExternalChannels() {
    const user = await createTestUser({
      email: 'no-external-channels@example.com',
      name: 'No External Channels',
      emailNotificationsEnabled: false,
      smsNotificationsEnabled: false,
      pushNotificationsEnabled: false,
      whatsappNotificationsEnabled: false,
    });
    const service = await createTestService('Notification Policy Service');
    const incident = await createTestIncident('Notification policy incident', service.id, {
      assigneeId: user.id,
    });
    return { user, incident };
  }

  it('treats a user preference with no external channels as a successful skip', async () => {
    const { user, incident } = await setupRecipientWithoutExternalChannels();

    const result = await sendUserNotification(
      incident.id,
      user.id,
      'Respect the user notification preference.'
    );

    expect(result).toMatchObject({
      success: true,
      disposition: 'SKIPPED',
      suppressedByPreference: true,
      channelsUsed: [],
    });
    expect(await testPrisma.notification.count({ where: { userId: user.id } })).toBe(0);
    expect(
      await testPrisma.inAppNotification.count({
        where: { userId: user.id, entityId: incident.id },
      })
    ).toBe(1);
  });

  it('does not fail the aggregate incident delivery because a recipient opted out externally', async () => {
    const { user, incident } = await setupRecipientWithoutExternalChannels();

    const result = await sendIncidentNotifications(incident.id, 'triggered');

    expect(result).toMatchObject({ success: true, disposition: 'SKIPPED' });
    expect(await testPrisma.notification.count({ where: { userId: user.id } })).toBe(0);
  });
});