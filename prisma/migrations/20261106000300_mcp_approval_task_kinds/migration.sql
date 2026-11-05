-- Widening only: approval waits (operation and runbook reviews) can be observed as MCP tasks.
-- Existing RUNBOOK_EXECUTION rows stay valid; no data is rewritten.
ALTER TABLE "McpTask" DROP CONSTRAINT "mcp_task_kind";
ALTER TABLE "McpTask" ADD CONSTRAINT "mcp_task_kind"
  CHECK ("kind" IN ('RUNBOOK_EXECUTION', 'OPERATION_APPROVAL', 'RUNBOOK_APPROVAL'));
