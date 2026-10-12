import { expect, it } from 'vitest';
import {
  assertControlledImageConfigs,
  resolveControlledImageReference,
} from '../load/helpers/automation-environment';
it('requires every running application replica to match the built config digest', () => {
  const digest = 'sha256:' + 'a'.repeat(64);
  expect(() => assertControlledImageConfigs(digest, [digest, digest])).not.toThrow();
  expect(() => assertControlledImageConfigs(digest, [])).toThrow('match');
  expect(() => assertControlledImageConfigs(digest, [digest, 'sha256:' + 'b'.repeat(64)])).toThrow(
    'match'
  );
  expect(() => assertControlledImageConfigs('invalid', [digest])).toThrow('match');
});

it('resolves immutable imported aliases through CRI inventory and fails closed for ambiguous or missing identities', () => {
  const id = 'sha256:' + 'a'.repeat(64);
  const reference = 'docker.io/library/import-date@sha256:' + 'b'.repeat(64);
  const image = { id, repoDigests: [reference] };
  expect(resolveControlledImageReference(reference, [image])).toBe(id);
  expect(resolveControlledImageReference(id, [image])).toBe(id);
  expect(() => resolveControlledImageReference(reference, [])).toThrow('unambiguously');
  expect(() => resolveControlledImageReference(reference, [image, image])).toThrow('unambiguously');
  expect(() => resolveControlledImageReference('opsknight-automation:audit35', [image])).toThrow(
    'unambiguously'
  );
});
