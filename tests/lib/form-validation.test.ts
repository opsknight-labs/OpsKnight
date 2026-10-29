import { describe, it, expect } from 'vitest';
import {
  isValidEmail,
  isValidUrl,
  isValidPhoneNumber,
  isValidDedupKey,
  getEmailValidationError,
  getUrlValidationError,
  getDedupKeyValidationError,
} from '@/lib/form-validation';

describe('Form Validation Utilities', () => {
  describe('isValidEmail', () => {
    it('should validate correct email addresses', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
      expect(isValidEmail('user.name@example.co.uk')).toBe(true);
      expect(isValidEmail('user+tag@example.com')).toBe(true);
      expect(isValidEmail('user_name@example-domain.com')).toBe(true);
    });

    it('should reject invalid email addresses', () => {
      expect(isValidEmail('invalid')).toBe(false);
      expect(isValidEmail('invalid@')).toBe(false);
      expect(isValidEmail('@example.com')).toBe(false);
      expect(isValidEmail('invalid@.com')).toBe(false);
      expect(isValidEmail('')).toBe(false);
    });

    it('should handle edge cases', () => {
      // Basic regex allows some edge cases - test against actual implementation
      const trimmed = '  test@example.com  '.trim();
      expect(isValidEmail(trimmed)).toBe(true);
    });
  });

  describe('isValidUrl', () => {
    it('should validate correct URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('http://example.com')).toBe(true);
      expect(isValidUrl('https://www.example.com')).toBe(true);
      expect(isValidUrl('https://example.com/path')).toBe(true);
      expect(isValidUrl('https://example.com/path?query=value')).toBe(true);
    });

    it('should reject invalid URLs', () => {
      expect(isValidUrl('not-a-url')).toBe(false);
      expect(isValidUrl('ftp://example.com')).toBe(false);
      expect(isValidUrl('example.com')).toBe(false);
      expect(isValidUrl('//example.com')).toBe(false);
      expect(isValidUrl('')).toBe(false);
    });
  });

  describe('isValidPhoneNumber', () => {
    it('should validate correct phone numbers', () => {
      expect(isValidPhoneNumber('1234567890')).toBe(true);
      expect(isValidPhoneNumber('+1234567890')).toBe(true);
      expect(isValidPhoneNumber('123456789012345')).toBe(true); // 15 digits max
    });

    it('should reject invalid phone numbers', () => {
      expect(isValidPhoneNumber('123')).toBe(false); // Too short (needs at least 10 digits)
      expect(isValidPhoneNumber('1234567890123456')).toBe(false); // Too long (>15 digits)
      expect(isValidPhoneNumber('abc123')).toBe(false); // Contains letters
      expect(isValidPhoneNumber('')).toBe(false);
    });
  });

  describe('isValidDedupKey', () => {
    it('should validate correct dedup keys', () => {
      expect(isValidDedupKey('cpu-alert-123')).toBe(true);
      expect(isValidDedupKey('api_latency_eu')).toBe(true);
      expect(isValidDedupKey('alert-2024-01-01')).toBe(true);
      expect(isValidDedupKey('ALERT123')).toBe(true);
      expect(isValidDedupKey('alert_123')).toBe(true);
    });

    it('should reject invalid dedup keys', () => {
      expect(isValidDedupKey('alert with spaces')).toBe(false);
      expect(isValidDedupKey('alert@123')).toBe(false);
      expect(isValidDedupKey('alert#123')).toBe(false);
      expect(isValidDedupKey('')).toBe(false);
    });
  });

  describe('getEmailValidationError', () => {
    it('should return null for valid emails', () => {
      expect(getEmailValidationError('test@example.com')).toBeNull();
    });

    it('should return error for empty email', () => {
      expect(getEmailValidationError('')).toBe('Email is required.');
    });

    it('should return error for invalid format', () => {
      expect(getEmailValidationError('invalid')).toContain('valid email address');
    });

    it('should return error for email that is too long', () => {
      const longEmail = 'a'.repeat(321) + '@example.com';
      expect(getEmailValidationError(longEmail)).toContain('320 characters');
    });
  });

  describe('getUrlValidationError', () => {
    it('should return null for valid URLs', () => {
      expect(getUrlValidationError('https://example.com')).toBeNull();
    });

    it('should return null for empty URL (optional field)', () => {
      expect(getUrlValidationError('')).toBeNull();
      expect(getUrlValidationError(null)).toBeNull();
      expect(getUrlValidationError(undefined)).toBeNull();
    });

    it('should return error for invalid URL format', () => {
      expect(getUrlValidationError('not-a-url')).toContain('valid URL');
    });

    it('should return error for URL that is too long', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(500);
      expect(getUrlValidationError(longUrl)).toContain('500 characters');
    });
  });

  describe('getDedupKeyValidationError', () => {
    it('should return null for valid dedup keys', () => {
      expect(getDedupKeyValidationError('cpu-alert-123')).toBeNull();
    });

    it('should return null for empty dedup key (optional field)', () => {
      expect(getDedupKeyValidationError('')).toBeNull();
    });

    it('should return error for invalid format', () => {
      expect(getDedupKeyValidationError('alert with spaces')).toContain('letters, numbers, hyphens, and underscores');
    });

    it('should return error for dedup key that is too long', () => {
      const longKey = 'a'.repeat(201);
      expect(getDedupKeyValidationError(longKey)).toContain('200 characters');
    });
  });
});

