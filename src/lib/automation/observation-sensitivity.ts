import { isSensitiveValue } from './context/privacy';

/** Discovery excludes obvious credentials and contact data in both server and browser. */
export function isSensitiveObservation(observation: { key: string; path: string; value: string }) {
  const field = `${observation.key}.${observation.path}`;
  return (
    /(?:email|e_mail|phone|mobile|ssn|social.?security|passport|password|secret|token|credential|authorization|cookie)/i.test(field) ||
    isSensitiveValue(observation.value) ||
    /[^\s@]+@[^\s@]+\.[^\s@]+/.test(observation.value) ||
    /^\+?[\d\s().-]{7,25}$/.test(observation.value)
  );
}
