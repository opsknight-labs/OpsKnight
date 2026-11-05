/**
 * Deployment-level kill switch. MCP_FORCE_DISABLED=true turns MCP off for every surface (the /mcp
 * endpoint, OAuth sign-in, token refresh, registration and discovery) whatever the stored policy
 * says, so an operator can stop all assistant access with a config flip and a restart instead of
 * an admin session. Read on each call: tests and orchestrators may change it at runtime.
 */
export function mcpForceDisabled(): boolean {
  return process.env.MCP_FORCE_DISABLED?.trim().toLowerCase() === 'true';
}

/** Whether a stored policy row is in force: enabled by an admin and not forced off by deployment. */
export function mcpPolicyInForce(policy: { enabled: boolean } | null | undefined): boolean {
  return Boolean(policy?.enabled) && !mcpForceDisabled();
}
