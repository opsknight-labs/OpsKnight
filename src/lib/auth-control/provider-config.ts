import { z } from 'zod';
import { normalizeOidcIssuer } from '@/lib/oidc/issuer-migration';

export const roleRuleSchema = z
  .object({
    claim: z.string().trim().min(1).max(128),
    value: z.string().min(1).max(512),
    role: z.enum(['ADMIN', 'RESPONDER', 'AUDITOR', 'USER']),
  })
  .strict();
export const providerConfigSchema = z
  .object({
    issuer: z
      .string()
      .url()
      .max(2048)
      .refine(value => {
        const url = new URL(value);
        return (
          url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
        );
      }, 'Use an HTTPS issuer without user information, query or fragment.')
      .transform(normalizeOidcIssuer),
    clientId: z.string().trim().min(1).max(512),
    clientSecret: z.string().max(16384),
    enabled: z.boolean().default(true),
    autoProvision: z.boolean().default(false),
    allowedDomains: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)
      )
      .max(100)
      .default([]),
    roleMapping: z.array(roleRuleSchema).max(100).default([]),
    customScopes: z.string().max(2048).nullable().default(null),
    providerType: z.enum(['azure', 'google', 'okta', 'auth0', 'custom']).default('custom'),
    providerLabel: z.string().trim().max(80).nullable().default(null),
    organizationId: z.string().trim().max(128).nullable().default(null),
    tokenEndpointAuthMethod: z
      .enum(['client_secret_basic', 'client_secret_post'])
      .default('client_secret_basic'),
    profileMapping: z
      .object({
        department: z.string().max(128).optional(),
        jobTitle: z.string().max(128).optional(),
        avatarUrl: z.string().max(128).optional(),
      })
      .strict()
      .default({}),
    sessionMaxAgeSeconds: z.number().int().min(900).max(2592000).nullable().default(null),
    sessionIdleTimeoutSeconds: z.number().int().min(300).max(604800).nullable().default(null),
  })
  .strict()
  .refine(
    value =>
      value.sessionIdleTimeoutSeconds == null ||
      value.sessionMaxAgeSeconds == null ||
      value.sessionIdleTimeoutSeconds <= value.sessionMaxAgeSeconds,
    'Idle timeout cannot exceed maximum session age.'
  );
export type ProviderConfiguration = z.infer<typeof providerConfigSchema>;
