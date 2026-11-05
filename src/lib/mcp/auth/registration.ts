import 'server-only';
import { z } from 'zod/v3';
import { requireMcp } from '../core/errors';
import { isAllowedRedirect } from './redirect-uri';

export const MAX_DYNAMIC_CLIENTS = 5000;
// Registration is a short, rate-limited insert; a few may overlap so a team onboarding at once
// is not turned away, while the bound still protects the database pool.
const MAX_CONCURRENT_REGISTRATIONS = 3;
let registering = 0;
/** Separate from normal MCP authentication admission; never occupy all pool slots. */
export function acquireRegistrationSlot() {
  requireMcp(registering < MAX_CONCURRENT_REGISTRATIONS, 'MCP_BUSY', 503);
  registering += 1;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      registering -= 1;
    }
  };
}

// Grant types assistants commonly declare. Registration records only the two this server issues;
// the others are known names that are ignored rather than refused (RFC 7591 section 3.2.1).
const KNOWN_GRANT_TYPES = [
  'authorization_code',
  'refresh_token',
  'urn:ietf:params:oauth:grant-type:jwt-bearer',
  'urn:ietf:params:oauth:grant-type:device_code',
  'client_credentials',
] as const;
const informationalUrl = z.string().url().max(2048);
// Informational URLs are accepted for standard client compatibility but never fetched,
// rendered as trusted links, or persisted. Registration conveys no user authority.
const registrationMetadataSchema = z.object({
  client_name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[^\u0000-\u001f\u007f]+$/)
    .default('MCP assistant'),
  redirect_uris: z
    .array(z.string().max(2048).refine(isAllowedRedirect))
    .min(1)
    .max(5)
    .refine(uris => new Set(uris).size === uris.length),
  token_endpoint_auth_method: z.literal('none').default('none'),
  grant_types: z
    .array(z.enum(KNOWN_GRANT_TYPES))
    .min(1)
    .max(KNOWN_GRANT_TYPES.length)
    .refine(types => types.includes('authorization_code') && new Set(types).size === types.length)
    .default(['authorization_code', 'refresh_token']),
  response_types: z.array(z.literal('code')).length(1).default(['code']),
  // Some clients (Gemini CLI) send `scope: ""`; that is no request, so the policy ceiling applies.
  scope: z.preprocess(
    value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).max(2048).optional()
  ),
  client_uri: informationalUrl.optional(),
  logo_uri: informationalUrl.optional(),
  tos_uri: informationalUrl.optional(),
  policy_uri: informationalUrl.optional(),
  contacts: z.array(z.string().email().max(254)).max(5).optional(),
  software_id: z.string().max(256).optional(),
  software_version: z.string().max(100).optional(),
  application_type: z.enum(['web', 'native']).optional(),
  // Accepted for MCP SDK compatibility; never verified or used, since it confers nothing here.
  software_statement: z.string().max(4096).optional(),
});
// Unknown metadata (OIDC fields such as post_logout_redirect_uris, newer SDK fields) is dropped by
// zod's default strip, never persisted or echoed: RFC 7591 §2 has the server ignore what it does
// not understand.
// Secrets and key material are still refused: this server registers public clients only, and a
// client that sends them expects to authenticate with them.
const REFUSED_METADATA = [
  'client_secret',
  'client_secret_expires_at',
  'jwks',
  'jwks_uri',
  'tls_client_auth_subject_dn',
] as const;
export const registrationSchema = z
  .record(z.unknown())
  .superRefine((value, context) => {
    for (const key of REFUSED_METADATA)
      if (Object.hasOwn(value, key))
        context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'not supported' });
  })
  .pipe(registrationMetadataSchema);
