/**
 * Client-side form validation utilities
 * Provides real-time validation feedback
 */

// Email validation regex (RFC 5322 compliant)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// URL validation regex
const URL_REGEX = /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/;

/**
 * Validates an email address
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  return EMAIL_REGEX.test(email.trim());
}

/**
 * Validates a URL
 */
export function isValidUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  return URL_REGEX.test(trimmed);
}

/**
 * Validates a phone number (basic validation)
 */
export function isValidPhoneNumber(phone: string): boolean {
  if (!phone || typeof phone !== 'string') return false;
  // Remove common formatting characters
  const cleaned = phone.replace(/[\s\-\(\)\+]/g, '');
  // Check if it's all digits and has reasonable length (10-15 digits)
  return /^\d{10,15}$/.test(cleaned);
}

/**
 * Gets email validation error message
 */
export function getEmailValidationError(email: string): string | null {
  if (!email || !email.trim()) {
    return 'Email is required.';
  }
  if (!isValidEmail(email)) {
    return 'Please enter a valid email address (e.g., name@company.com).';
  }
  if (email.length > 320) {
    return 'Email address must be 320 characters or less.';
  }
  return null;
}

/**
 * Gets URL validation error message
 */
export function getUrlValidationError(url: string | null | undefined): string | null {
  if (!url || !url.trim()) {
    return null; // URLs are often optional
  }
  if (!isValidUrl(url)) {
    return 'Please enter a valid URL starting with http:// or https://';
  }
  if (url.length > 500) {
    return 'URL must be 500 characters or less.';
  }
  return null;
}

/**
 * Validates a deduplication key format
 */
export function isValidDedupKey(key: string): boolean {
  if (!key || typeof key !== 'string') return false;
  // Allow alphanumeric, hyphens, and underscores
  return /^[a-zA-Z0-9_-]+$/.test(key);
}

/**
 * Gets dedup key validation error message
 */
export function getDedupKeyValidationError(key: string): string | null {
  if (!key || !key.trim()) {
    return null; // Dedup keys are optional
  }
  if (!isValidDedupKey(key)) {
    return 'Deduplication key can only contain letters, numbers, hyphens, and underscores.';
  }
  if (key.length > 200) {
    return 'Deduplication key must be 200 characters or less.';
  }
  return null;
}

