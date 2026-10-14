export const CONTACT_READINESS_MAX_AGE_SECONDS = 90;
export function authenticatedContactReady(
  now: number,
  last: number | null,
  communicationError: string | null
) {
  return (
    communicationError === null &&
    last !== null &&
    now >= last &&
    now - last < CONTACT_READINESS_MAX_AGE_SECONDS
  );
}
