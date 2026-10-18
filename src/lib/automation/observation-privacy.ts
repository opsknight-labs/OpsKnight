import { createHmac } from 'node:crypto';
import { isSensitiveValue } from './context/privacy';

/** Discovery is diagnostic: personal/contact fields are excluded even if routing
 * is intentionally configured to consume them. This is not a general PII classifier.
 */
export function isSensitiveObservation(observation: { key: string; path: string; value: string }) {
  const field = `${observation.key}.${observation.path}`;
  return (
    /(?:email|e_mail|phone|mobile|ssn|social.?security|passport|password|secret|token|credential|authorization|cookie)/i.test(
      field
    ) ||
    isSensitiveValue(observation.value) ||
    /[^\s@]+@[^\s@]+\.[^\s@]+/.test(observation.value) ||
    /^\+?[\d\s().-]{7,25}$/.test(observation.value)
  );
}

/** Domain-separated service-scoped keyed identity prevents offline enumeration
 * of predictable values from a database-only compromise. Rotation starts a new
 * identity space; previous rows expire under ordinary observation retention.
 * Missing signing configuration disables discovery, never LIVE ingestion.
 */
export function observationValueHash(serviceId: string, value: string): string | null {
  const secret = process.env.API_KEY_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) return null;
  return createHmac('sha256', secret)
    .update(JSON.stringify(['opsknight:automation-observation:v1', serviceId, value]))
    .digest('hex');
}

/** Minimize durable job payloads before they enter PostgreSQL. */
export function protectObservationValues<T extends { key: string; path: string; value: string }>(
  serviceId: string,
  observations: T[],
  allowPreviews: boolean
): Array<T & { valueHash: string }> {
  return observations.flatMap(observation => {
    if (isSensitiveObservation(observation)) return [];
    const hash = observationValueHash(serviceId, observation.value);
    return hash
      ? [{ ...observation, value: allowPreviews ? observation.value : '', valueHash: hash }]
      : [];
  });
}
