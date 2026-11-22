import { describe, expect, it, vi } from 'vitest';
import { classifyStatusPageChange } from '@/lib/status-pages/publication-policy';
import { subscriberServiceFilter } from '@/lib/status-pages/subscription-policy';
import { statusPageSectionFields } from '@/lib/status-pages/settings-sections';

vi.mock('@/lib/prisma', () => ({ default: {} }));
import { businessServiceUpdateText } from '@/lib/business-services/follower-notifications';

describe('status page classification for business services', () => {
  const current = { serviceLayout: 'FLAT', businessServiceIds: ['a', 'b'] };

  it('treats the layout as presentation only', () => {
    const result = classifyStatusPageChange({ current, patch: { serviceLayout: 'BUSINESS' } });
    expect(result.classes).toEqual(['PRESENTATION']);
    expect(result.failClosed).toBe(false);
  });

  it('withdraws first when a business service is removed, relaxes when one is added', () => {
    expect(
      classifyStatusPageChange({ current, patch: {}, businessServiceIds: ['a'] }).dominant
    ).toBe('PRIVACY_TIGHTENING');
    expect(
      classifyStatusPageChange({ current, patch: {}, businessServiceIds: ['a', 'b', 'c'] }).dominant
    ).toBe('PRIVACY_RELAXING');
    expect(
      classifyStatusPageChange({ current, patch: {}, businessServiceIds: ['b', 'a'] }).classes
    ).toEqual(['PRESENTATION']);
    expect(
      classifyStatusPageChange({ current, patch: {}, businessServiceIds: ['a', 'b'] }).classes
    ).toEqual([]);
  });

  it('saves layout and mapping from the Services section only', () => {
    const fields = statusPageSectionFields('services')!;
    expect(fields.has('serviceLayout')).toBe(true);
    expect(fields.has('businessServiceIds')).toBe(true);
    expect(statusPageSectionFields('privacy')!.has('businessServiceIds')).toBe(false);
  });
});

describe('subscriber matching', () => {
  it('reaches whole-page subscribers, service pickers and business-service pickers', () => {
    expect(subscriberServiceFilter(['svc-1'])).toEqual({
      OR: [
        { selectedServices: { none: {} }, selectedBusinessServices: { none: {} } },
        { selectedServices: { some: { serviceId: { in: ['svc-1'] } } } },
        {
          selectedBusinessServices: {
            some: { businessService: { members: { some: { serviceId: { in: ['svc-1'] } } } } },
          },
        },
      ],
    });
  });
});

describe('follower wording', () => {
  it('speaks about the capability, not the component', () => {
    expect(businessServiceUpdateText(['Checkout'], 'triggered').title).toBe('Checkout is affected');
    expect(businessServiceUpdateText(['Checkout', 'Payments'], 'resolved').title).toBe(
      'Checkout and Payments are back to normal'
    );
    expect(businessServiceUpdateText(['A', 'B', 'C'], 'acknowledged').title).toBe(
      'A, B and others: a team is working on it'
    );
  });
});
