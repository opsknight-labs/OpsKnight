import { describe, expect, it } from 'vitest';
import {
  conversationScopeSchema,
  savedTurnInputSchema,
} from '@/lib/intelligence/conversations/contract';

const action = {
  receiptId: 'e3b63f6e-5135-4d2d-b875-fb1daf5ca968',
  action: 'add_incident_note',
  title: 'Add a note',
  incidentId: 'incident-1',
};

describe('saved Squire memory boundary', () => {
  it('accepts read-only outcome references and refuses reusable confirmation tokens', () => {
    expect(savedTurnInputSchema.safeParse({ actions: [action] }).success).toBe(true);
    expect(
      savedTurnInputSchema.safeParse({ actions: [{ ...action, token: 'sealed-confirmation' }] })
        .success
    ).toBe(false);
    expect(savedTurnInputSchema.safeParse({ token: 'sealed-confirmation' }).success).toBe(false);
  });
  it('requires a canonical internal citation destination', () => {
    const citation = {
      kind: 'incident',
      id: 'incident-1',
      label: 'Incident',
      href: '/incidents/incident-1',
    };
    expect(savedTurnInputSchema.safeParse({ citations: [citation] }).success).toBe(true);
    expect(
      savedTurnInputSchema.safeParse({
        citations: [{ ...citation, href: 'https://external.example/' }],
      }).success
    ).toBe(false);
    expect(
      savedTurnInputSchema.safeParse({ citations: [{ ...citation, href: '/incidents/other' }] })
        .success
    ).toBe(false);
  });
  it('bounds notices and action references independently of encrypted text', () => {
    expect(savedTurnInputSchema.safeParse({ actions: [action, action, action] }).success).toBe(
      false
    );
    expect(savedTurnInputSchema.safeParse({ notices: ['x'.repeat(1_001)] }).success).toBe(false);
  });
  it('distinguishes global and incident conversations without accepting contradictory scope fields', () => {
    expect(conversationScopeSchema.safeParse({ kind: 'GLOBAL' }).success).toBe(true);
    expect(
      conversationScopeSchema.safeParse({ kind: 'INCIDENT', incidentId: 'incident-1' }).success
    ).toBe(true);
    expect(
      conversationScopeSchema.safeParse({ kind: 'GLOBAL', incidentId: 'incident-1' }).success
    ).toBe(false);
  });
});
