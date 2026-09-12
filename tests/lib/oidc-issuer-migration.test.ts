import { describe, expect, it } from 'vitest';
import {
  hasIssuerMigrationConfirmation,
  isOidcIssuerMigration,
  normalizeOidcIssuer,
} from '@/lib/oidc/issuer-migration';

describe('OIDC issuer migration policy', () => {
  it('normalizes only equivalent trailing slash forms', () => {
    expect(normalizeOidcIssuer('https://id.example.com/')).toBe('https://id.example.com');
    expect(normalizeOidcIssuer('https://id.example.com///')).toBe('https://id.example.com');
    expect(normalizeOidcIssuer('https://id.example.com/oauth2/default//')).toBe(
      'https://id.example.com/oauth2/default'
    );
    expect(isOidcIssuerMigration('https://id.example.com', 'https://id.example.com/')).toBe(false);
    expect(isOidcIssuerMigration('https://id.example.com///', 'https://id.example.com/')).toBe(
      false
    );
  });

  it('treats host and path changes as trust-boundary migrations', () => {
    expect(isOidcIssuerMigration('https://id.example.com', 'https://login.example.com')).toBe(true);
    expect(
      isOidcIssuerMigration('https://id.example.com/oauth2/default', 'https://id.example.com')
    ).toBe(true);
  });

  it('requires an explicit form confirmation', () => {
    const missing = new FormData();
    expect(hasIssuerMigrationConfirmation(missing)).toBe(false);
    missing.set('confirmIssuerMigration', 'on');
    expect(hasIssuerMigrationConfirmation(missing)).toBe(true);
  });
});
