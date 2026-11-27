import { describe, expect, it } from 'vitest';
import { templateFormSchema } from '@/components/incident/TemplateCreateForm';
import { IncidentTemplateInputSchema } from '@/lib/incidents/templates';

const base = {
  name: 'Database outage',
  title: 'Database is down',
  defaultUrgency: 'HIGH' as const,
  isPublic: false,
};

// The server action runs IncidentTemplateInputSchema.parse() and has no catch, so anything the
// form lets through that the server refuses ends in the error boundary and loses the input.
describe('template create form limits match the server schema', () => {
  it.each([
    ['title', 200, 'x'],
    ['description', 5000, 'y'],
    ['descriptionText', 10000, 'z'],
  ])('%s: accepts exactly the server maximum and rejects one more', (field, max, ch) => {
    const atMax = { ...base, [field]: ch.repeat(max) };
    expect(templateFormSchema.safeParse(atMax).success).toBe(true);
    expect(IncidentTemplateInputSchema.safeParse(atMax).success).toBe(true);

    const over = { ...base, [field]: ch.repeat(max + 1) };
    expect(templateFormSchema.safeParse(over).success).toBe(false);
  });
});
