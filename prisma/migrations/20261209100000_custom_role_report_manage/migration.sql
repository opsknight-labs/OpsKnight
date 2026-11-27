-- report.manage splits writing reports and dashboards out of report.read. Custom roles that can
-- read reports keep the write access they had; built-in roles are granted in code. Idempotent.
UPDATE "CustomRole"
SET "capabilities" = array_append("capabilities", 'report.manage')
WHERE 'report.read' = ANY("capabilities")
  AND NOT ('report.manage' = ANY("capabilities"));
