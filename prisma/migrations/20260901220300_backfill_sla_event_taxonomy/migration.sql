-- Only rewrite the SLA monitor's known historical message contracts.
UPDATE "IncidentEvent"
SET "type" = 'SLA_BREACHED'::"IncidentEventType"
WHERE "type" = 'ESCALATED'::"IncidentEventType"
  AND (
    "message" LIKE '%SLA ACK Breached:%'
    OR "message" LIKE '%SLA RESOLVE Breached:%'
  );

UPDATE "IncidentEvent"
SET "type" = 'SLA_WARNING'::"IncidentEventType"
WHERE "type" = 'COMMENT'::"IncidentEventType"
  AND (
    "message" LIKE '%SLA ACK Warning:%'
    OR "message" LIKE '%SLA RESOLVE Warning:%'
  );
