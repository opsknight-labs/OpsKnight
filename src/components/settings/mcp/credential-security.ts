/**
 * How MCP credentials are protected, as shown on the Connections page. Kept in one place and
 * pinned by a test against the implementation (keyed HMAC-SHA256 digests in auth/config.ts,
 * PKCE S256 and refresh-token reuse revocation in auth/oauth-model.ts), so the page cannot claim
 * a storage design the code does not use.
 */
export const MCP_CREDENTIAL_SECURITY_COPY =
  'Authorization codes, access tokens and refresh tokens are stored only as keyed HMAC-SHA256 ' +
  'digests (the key is derived from the application encryption key), so they cannot be read ' +
  'back from the database, only revoked or replaced. Sign-in uses OAuth with PKCE (S256). ' +
  'Refresh tokens rotate on every use, and replaying a used one after its short grace period ' +
  'revokes the whole connection.';
