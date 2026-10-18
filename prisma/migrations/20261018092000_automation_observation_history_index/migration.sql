-- Stable discovery pagination must stay bounded as value counters grow.
CREATE INDEX "AutomationContextObservation_serviceId_firstSeenAt_id_idx"
ON "AutomationContextObservation" ("serviceId", "firstSeenAt", "id");
