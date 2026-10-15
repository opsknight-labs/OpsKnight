import { expect, it } from 'vitest';
import { authenticatedContactReady } from '../../../agent/src/contact-readiness';
it('becomes unready on failed contact or a prolonged partition and recovers on an authenticated roundtrip', () => {
  expect(authenticatedContactReady(100, null, null)).toBe(false);
  expect(authenticatedContactReady(100, 100, null)).toBe(true);
  expect(authenticatedContactReady(101, 100, 'unreachable')).toBe(false);
  expect(authenticatedContactReady(189, 100, null)).toBe(true);
  expect(authenticatedContactReady(190, 100, null)).toBe(false);
  expect(authenticatedContactReady(400, 100, null)).toBe(false);
  expect(authenticatedContactReady(401, 400, null)).toBe(true);
});
