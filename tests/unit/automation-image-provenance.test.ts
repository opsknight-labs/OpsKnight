import { expect, it } from 'vitest';
import { assertControlledImageConfigs } from '../load/helpers/automation-environment';
it('requires every running application replica to match the built config digest', () => {
  const digest = 'sha256:' + 'a'.repeat(64);
  expect(() => assertControlledImageConfigs(digest, [digest, digest])).not.toThrow();
  expect(() => assertControlledImageConfigs(digest, [])).toThrow('match');
  expect(() => assertControlledImageConfigs(digest, [digest, 'sha256:' + 'b'.repeat(64)])).toThrow(
    'match'
  );
  expect(() => assertControlledImageConfigs('invalid', [digest])).toThrow('match');
});
