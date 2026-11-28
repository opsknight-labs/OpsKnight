import { isSensitiveValue } from './context/privacy';

/** Discovery excludes obvious credentials and contact data in both server and browser. */
export function isSensitiveObservation(observation: { key: string; path: string; value: string }) {
  const field = `${observation.key}.${observation.path}`;
  return (
    /(?:email|e_mail|phone|mobile|ssn|social.?security|passport|password|secret|token|credential|authorization|cookie)/i.test(field) ||
    isSensitiveValue(observation.value) ||
    /[^\s@]+@[^\s@]+\.[^\s@]+/.test(observation.value) ||
    looksLikePhoneNumber(observation.value)
  );
}

/** Phone-shaped, not just digits: an epoch, an account id, an IPv4 address or a date must stay visible. */
function looksLikePhoneNumber(raw: string) {
  const value = raw.trim();
  if (!/^\+?[\d\s().-]{7,25}$/.test(value)) return false;
  const digits = value.replace(/\D/g, '').length;
  if (digits < 7 || digits > 15) return false;
  if (value.startsWith('+')) return true;
  if (/^\d{3}\.\d{3}\.\d{4}$/.test(value)) return true;
  if (/^\d+$/.test(value) || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)) return false;
  if (/^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}-\d{1,2}-\d{4})$/.test(value)) return false;
  return /[\s()-]/.test(value);
}
