import 'server-only';
import { z } from 'zod/v3';
import { requireMcp } from '../core/errors';

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

function validRedirect(value: string) {
  try {
    const url = new URL(value);
    return (
      url.href === value &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}
const informationalUrl = z.string().url().max(2048);
// Informational URLs are accepted for standard client compatibility but never fetched,
// rendered as trusted links, or persisted. Registration conveys no user authority.
export const registrationSchema = z
  .object({
    client_name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[^\u0000-\u001f\u007f]+$/)
      .default('MCP assistant'),
    redirect_uris: z
      .array(z.string().max(2048).refine(validRedirect))
      .min(1)
      .max(5)
      .refine(uris => new Set(uris).size === uris.length),
    token_endpoint_auth_method: z.literal('none').default('none'),
    grant_types: z
      .array(z.enum(['authorization_code', 'refresh_token']))
      .min(1)
      .max(2)
      .refine(types => types.includes('authorization_code') && new Set(types).size === types.length)
      .default(['authorization_code', 'refresh_token']),
    response_types: z.array(z.literal('code')).length(1).default(['code']),
    scope: z.string().trim().min(1).max(2048).optional(),
    client_uri: informationalUrl.optional(),
    logo_uri: informationalUrl.optional(),
    tos_uri: informationalUrl.optional(),
    policy_uri: informationalUrl.optional(),
    contacts: z.array(z.string().email().max(254)).max(5).optional(),
    software_id: z.string().max(256).optional(),
    software_version: z.string().max(100).optional(),
    application_type: z.enum(['web', 'native']).optional(),
  })
  .strict();
