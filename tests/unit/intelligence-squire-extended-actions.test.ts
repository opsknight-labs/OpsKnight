// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import {
  SQUIRE_ACTION_INPUTS,
  SQUIRE_ACTION_JSON_SCHEMAS,
  SQUIRE_ACTION_KIND,
  SQUIRE_ACTION_NAMES,
} from '@/lib/intelligence/squire/actions/catalog';
import {
  EXTENDED_SQUIRE_ACTION_INPUTS,
  EXTENDED_SQUIRE_ACTION_NAMES,
  FOLLOW_UP_ONLY_ACTIONS,
  SQUIRE_SNOOZE_BOUNDS,
} from '@/lib/intelligence/squire/actions/catalog-extended';
import { extractSlots, normalizeMessage } from '@/lib/intelligence/squire/basic/nlu';
import { aiSettingsInputSchema } from '@/lib/intelligence/ai/contract';

describe('extended action catalog', () => {
  it('adds every extended action to the closed catalog as a write', () => {
    for (const name of EXTENDED_SQUIRE_ACTION_NAMES) {
      expect(SQUIRE_ACTION_NAMES).toContain(name);
      // eslint-disable-next-line security/detect-object-injection -- name from the fixed list
      expect(SQUIRE_ACTION_KIND[name]).toBe('WRITE');
    }
    expect([...FOLLOW_UP_ONLY_ACTIONS]).toEqual(['publish_status_update']);
  });

  it('keeps the model JSON schemas in step with the server input schemas', () => {
    for (const name of EXTENDED_SQUIRE_ACTION_NAMES) {
      // eslint-disable-next-line security/detect-object-injection -- name from the fixed list
      const json = SQUIRE_ACTION_JSON_SCHEMAS[name] as {
        properties: Record<string, unknown>;
        required: string[];
        additionalProperties: boolean;
      };
      // eslint-disable-next-line security/detect-object-injection -- name from the fixed list
      const shape = (SQUIRE_ACTION_INPUTS[name] as z.ZodObject).shape;
      expect(Object.keys(json.properties).sort()).toEqual(Object.keys(shape).sort());
      expect(json.additionalProperties).toBe(false);
      for (const key of json.required)
        // eslint-disable-next-line security/detect-object-injection -- key from the schema itself
        expect(shape[key].safeParse(undefined).success).toBe(false);
    }
  });

  it('bounds snoozing and rejects unknown fields', () => {
    const snooze = EXTENDED_SQUIRE_ACTION_INPUTS.snooze_incident;
    expect(
      snooze.safeParse({ incidentId: 'i', minutes: SQUIRE_SNOOZE_BOUNDS.minMinutes - 1 }).success
    ).toBe(false);
    expect(
      snooze.safeParse({ incidentId: 'i', minutes: SQUIRE_SNOOZE_BOUNDS.maxMinutes + 1 }).success
    ).toBe(false);
    expect(snooze.safeParse({ incidentId: 'i', minutes: 30.5 }).success).toBe(false);
    expect(snooze.safeParse({ incidentId: 'i', minutes: 30 }).success).toBe(true);
    expect(
      EXTENDED_SQUIRE_ACTION_INPUTS.escalate_incident.safeParse({ incidentId: 'i', level: 3 })
        .success
    ).toBe(false);
    expect(
      EXTENDED_SQUIRE_ACTION_INPUTS.change_urgency.safeParse({
        incidentId: 'i',
        urgency: 'CRITICAL',
      }).success
    ).toBe(false);
    expect(
      EXTENDED_SQUIRE_ACTION_INPUTS.add_responder.parse({ incidentId: 'i', userId: 'u' }).role
    ).toBe('FOLLOWER');
  });
});

describe('extended actions setting', () => {
  it('is optional so older settings forms keep the saved value', () => {
    const base = {
      enabled: false,
      squireEnabled: true,
      squireName: 'Squire',
      allowExternalFallback: false,
      requestsPerMinutePerUser: 20,
      dailyTokenBudget: 500_000,
      maxOutputTokens: 1024,
      requestTimeoutMs: 30_000,
      expectedRevision: 0,
    };
    expect(aiSettingsInputSchema.parse(base).squireExtendedActions).toBeUndefined();
    expect(
      aiSettingsInputSchema.parse({ ...base, squireExtendedActions: true }).squireExtendedActions
    ).toBe(true);
  });
});

describe('basic-mode extended action slots', () => {
  const slot = (text: string) => extractSlots(normalizeMessage(text), text);
  it.each([
    ['escalate this', { action: 'escalate' }],
    ['please escalate', { action: 'escalate' }],
    ['page the next level', { action: 'escalate' }],
    ['set urgency to low', { action: 'urgency', targetUrgency: 'LOW' }],
    ['change the urgency to medium', { action: 'urgency', targetUrgency: 'MEDIUM' }],
    ['make this high urgency', { action: 'urgency', targetUrgency: 'HIGH' }],
    ['lower the urgency', { action: 'urgency' }],
    ['snooze this for 2 hours', { action: 'snooze', snoozeMinutes: 120 }],
  ])('reads %s', (text, expected) => {
    expect(slot(text)).toMatchObject(expected);
  });

  it('leaves questions about escalation to guidance', () => {
    expect(slot('how do escalation policies work').action).toBeUndefined();
    expect(slot('what is the urgency?').action).toBeUndefined();
    expect(slot('acknowledge this').action).toBe('acknowledge');
  });
});
