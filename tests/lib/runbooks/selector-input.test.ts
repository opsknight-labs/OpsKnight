import { expect, it } from 'vitest';
import { parseAgentSelector } from '@/lib/runbooks/selector-input';
it('rejects malformed, duplicated and invalid selector keys and permits correction', () => {
  for (const raw of ['{', '{"region":"a","region":"b"}', '{"bad key":"a"}', '__invalid_selector__'])
    expect(parseAgentSelector(raw).success).toBe(false);
  expect(parseAgentSelector('{"region":"west"}')).toEqual({
    success: true,
    data: { region: 'west' },
  });
});
