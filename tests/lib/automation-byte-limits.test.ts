import { expect, it } from 'vitest';
import { fieldSchema } from '@/lib/automation/contract';
import { normalizeValue } from '@/lib/automation/context/normalize';

it.each(['é'.repeat(128), '😀'.repeat(64)])(
  'accepts exactly 256 UTF-8 bytes in canonical ENUM values and aliases',
  canonical => {
    const field = fieldSchema.parse({
      fieldId: 'value',
      key: 'value',
      label: 'Value',
      type: 'ENUM',
      allowedValues: [canonical],
      aliases: { [canonical]: canonical },
    });
    expect(normalizeValue(canonical, field)).toEqual({ state: 'RECOGNIZED', value: canonical });
    for (const update of [
      { allowedValues: [canonical + 'x'] },
      { aliases: { [canonical + 'x']: canonical } },
      { aliases: { short: canonical + 'x' } },
    ])
      expect(fieldSchema.safeParse({ ...field, ...update }).success).toBe(false);
  }
);
