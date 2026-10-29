import { describe, expect, it } from 'vitest';
import { selectAnnouncementRecipientsNeedingReplacement } from '@/lib/status-pages/announcement-recipient-reconciliation';

describe('announcement recipient reconciliation', () => {
  it('continues a corrected generation only to recipients not already accepted by a provider', () => {
    const recipients = Array.from({ length: 10_000 }, (_, index) => ({
      id: `subscriber-${index + 1}`,
    }));
    const alreadyAccepted = new Set(recipients.slice(0, 4_000).map(recipient => recipient.id));

    const replacement = selectAnnouncementRecipientsNeedingReplacement(
      recipients,
      alreadyAccepted
    );

    expect(replacement).toHaveLength(6_000);
    expect(replacement[0]?.id).toBe('subscriber-4001');
    expect(replacement.at(-1)?.id).toBe('subscriber-10000');
    expect(replacement.some(recipient => alreadyAccepted.has(recipient.id))).toBe(false);
  });

  it('does not create a duplicate replacement when every recipient already reached the provider', () => {
    const recipients = [{ id: 'subscriber-1' }, { id: 'subscriber-2' }];
    const alreadyAccepted = new Set(recipients.map(recipient => recipient.id));

    expect(
      selectAnnouncementRecipientsNeedingReplacement(recipients, alreadyAccepted)
    ).toEqual([]);
  });

  it('preserves all current recipients when no prior generation reached the provider', () => {
    const recipients = [{ id: 'subscriber-1' }, { id: 'subscriber-2' }];

    expect(
      selectAnnouncementRecipientsNeedingReplacement(recipients, new Set())
    ).toEqual(recipients);
  });
});
