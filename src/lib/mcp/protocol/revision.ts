/**
 * The MCP revision OpsKnight serves natively (tasks, listen). 2025-revision clients are served
 * statelessly by the SDK. One constant so the route, the setup check and the settings page
 * cannot drift apart on the next protocol bump.
 */
export const MCP_PROTOCOL_REVISION = '2026-07-28';
