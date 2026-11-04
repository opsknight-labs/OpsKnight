import { z } from 'zod/v3';
import { normalizeOidcIssuer } from '@/lib/oidc/issuer-migration';

const roleSchema = z.enum(['ADMIN', 'RESPONDER', 'AUDITOR', 'USER']);
/** A claim name, or a dotted path into nested claims such as realm_access.roles. */
const claimPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  // Each dot-separated part must be non-empty and contain no spaces (checked without a
  // backtracking-prone regular expression).
  .refine(
    value => value.split('.').every(part => part.length > 0 && !/\s/.test(part)),
    'Use a claim name or a dotted path such as realm_access.roles.'
  );
const claimValueSchema = z
  .string()
  .trim()
  .min(1, 'Enter the group or role value to match.')
  .max(512);

export const roleRuleSchema = z
  .object({
    claim: claimPathSchema,
    value: claimValueSchema,
    role: roleSchema,
    // New rules ignore letter case; rules saved before v2.2 were case-sensitive and keep that.
    caseSensitive: z.boolean().default(false),
  })
  .strict();

export const teamRuleSchema = z
  .object({
    claim: claimPathSchema,
    value: claimValueSchema,
    caseSensitive: z.boolean().default(false),
    teamId: z.string().trim().min(1).max(64),
  })
  .strict();
export type TeamMappingRule = z.infer<typeof teamRuleSchema>;
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
    defaultRole: roleSchema.default('USER'),
    unmatchedPolicy: z.enum(['DEFAULT_ROLE', 'DENY']).default('DEFAULT_ROLE'),
    rolePrecedence: z.enum(['FIRST_MATCH', 'HIGHEST_ROLE']).default('HIGHEST_ROLE'),
    domainTrustedLinking: z.boolean().default(false),
    teamMapping: z.array(teamRuleSchema).max(200).default([]),
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
