import { describe, expect, it } from 'vitest';
import { suggestForDraft, type DraftCandidate } from '@/lib/intelligence/helpers/create-suggest';

const row = (over: Partial<DraftCandidate>): DraftCandidate => ({
  incidentId: 'i1',
  title: 'Checkout latency high',
  status: 'RESOLVED',
  urgency: 'HIGH',
  serviceId: 'checkout',
  serviceName: 'Checkout',
  similarity: 0.5,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  ...over,
});

describe('suggestForDraft', () => {
  it('says nothing without look-alikes', () => {
    expect(suggestForDraft([])).toEqual({ service: null, urgency: null, duplicate: null });
    expect(suggestForDraft([row({ similarity: 0.1 }), row({ similarity: 0.2 })])).toEqual({
      service: null,
      urgency: null,
      duplicate: null,
    });
  });

  it('suggests the service and urgency most look-alikes agree on', () => {
    const result = suggestForDraft(
      [
        row({ incidentId: 'a', urgency: 'LOW' }),
        row({ incidentId: 'b', urgency: 'LOW' }),
        row({ incidentId: 'c', serviceId: 'api', serviceName: 'API', similarity: 0.35 }),
      ],
      { urgency: 'HIGH' }
    );
    expect(result.service).toEqual({ id: 'checkout', name: 'Checkout', matches: 2 });
    expect(result.urgency).toEqual({ value: 'LOW', matches: 2 });
  });

  it('needs two agreeing incidents and a clear majority', () => {
    expect(suggestForDraft([row({})]).service).toBeNull();
    expect(
      suggestForDraft([
        row({ incidentId: 'a' }),
        row({ incidentId: 'b' }),
        row({ incidentId: 'c', serviceId: 'api' }),
        row({ incidentId: 'd', serviceId: 'api' }),
      ]).service
    ).toBeNull();
  });

  it('never second-guesses a chosen service and reads urgency from that service only', () => {
    const result = suggestForDraft(
      [
        row({ incidentId: 'a', urgency: 'LOW' }),
        row({ incidentId: 'b', urgency: 'LOW' }),
        row({ incidentId: 'c', serviceId: 'api', urgency: 'MEDIUM' }),
        row({ incidentId: 'd', serviceId: 'api', urgency: 'MEDIUM' }),
      ],
      { serviceId: 'api', urgency: 'HIGH' }
    );
    expect(result.service).toBeNull();
    expect(result.urgency).toEqual({ value: 'MEDIUM', matches: 2 });
  });

  it('does not suggest the urgency already selected', () => {
    expect(
      suggestForDraft([row({ incidentId: 'a' }), row({ incidentId: 'b' })], { urgency: 'HIGH' })
        .urgency
    ).toBeNull();
  });

  it('flags the closest unresolved incident as a probable duplicate', () => {
    const result = suggestForDraft([
      row({ incidentId: 'resolved', similarity: 0.95 }),
      row({ incidentId: 'open', status: 'OPEN', similarity: 0.7 }),
      row({ incidentId: 'acked', status: 'ACKNOWLEDGED', similarity: 0.82 }),
      row({ incidentId: 'weak', status: 'OPEN', similarity: 0.5 }),
    ]);
    expect(result.duplicate).toMatchObject({ incidentId: 'acked', similarity: 0.82 });
  });
});
