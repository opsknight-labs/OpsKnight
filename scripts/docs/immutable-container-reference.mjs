const REPOSITORY_DIGEST = /^[^\s@]+@sha256:[0-9a-f]{64}$/;
const LOCAL_IMAGE_ID = /^sha256:[0-9a-f]{64}$/;

/** Accept registry content digests and Docker's immutable local image IDs. */
export function isImmutableContainerReference(value) {
  return typeof value === 'string' && (REPOSITORY_DIGEST.test(value) || LOCAL_IMAGE_ID.test(value));
}
