// A future-dated request can remain valid for twice the symmetric signature window.
export const AGENT_SIGNATURE_WINDOW_MS = 5 * 60 * 1000;
export const AGENT_NONCE_RETENTION_MS = 2 * AGENT_SIGNATURE_WINDOW_MS + 60_000;
