import { describe, expect, it } from 'vitest';
import { aboutUserLines, describeRole, viewingLine } from '@/lib/intelligence/squire/about';

describe('what Squire is told about the person and the page', () => {
  it('derives abilities from the capability table and names who can do the rest', () => {
    const user = describeRole('USER');
    expect(user.can).toContain("ack, note, escalate and resolve their teams' incidents");
    expect(user.cannot).toContain('administer the workspace (needs Admin)');
    expect(describeRole('ADMIN').cannot).toEqual([]);
    expect(describeRole('STAKEHOLDER').can).toEqual([]);
  });

  it('includes a first name only when given and lists teams', () => {
    expect(aboutUserLines({ role: 'RESPONDER', teams: ['Core', 'Payments'] })).toEqual(
      expect.arrayContaining(['- Role: Responder. Teams: "Core", "Payments".'])
    );
    expect(aboutUserLines({ role: 'USER', teams: [] }).join('\n')).not.toContain('First name');
    expect(aboutUserLines({ role: 'USER', firstName: 'Ana', teams: [] })).toContain(
      '- First name: "Ana"'
    );
  });

  it('says which page "this" is', () => {
    expect(viewingLine({ kind: 'service', id: 's1', name: 'payments-api' })).toBe(
      'The user is viewing the service "payments-api" /services/s1. "This" means it.'
    );
  });
});
