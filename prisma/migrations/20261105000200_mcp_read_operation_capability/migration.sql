-- Data only, additive. read_operation is a new generic entry point that runs one read by its
-- operationId. Until now call_operation was the only generic entry point, reads included, so an
-- administrator who turned call_operation off also turned generic reads off. Keep that decision
-- for the new tool; it can be turned back on independently in MCP settings. Policies that did not
-- disable call_operation (and policies disabling the whole mcp domain, which already covers
-- read_operation) are left unchanged. Re-running is a no-op.
UPDATE "McpPolicy"
SET "disabledCapabilities" = array_append("disabledCapabilities", 'read_operation')
WHERE 'call_operation' = ANY("disabledCapabilities")
  AND NOT ('read_operation' = ANY("disabledCapabilities"));
