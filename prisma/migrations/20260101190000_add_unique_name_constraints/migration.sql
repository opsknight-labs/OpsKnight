-- De-duplicate names before adding unique constraints.

WITH duplicates AS (
    SELECT id, name, ROW_NUMBER() OVER (PARTITION BY name ORDER BY "createdAt", id) AS rn
    FROM "Team"
)
UPDATE "Team" t
SET name = CONCAT(d.name, ' (', d.rn, '-', LEFT(d.id, 8), ')'),
    "updatedAt" = NOW()
FROM duplicates d
WHERE t.id = d.id AND d.rn > 1;

WITH duplicates AS (
    SELECT id, name, ROW_NUMBER() OVER (PARTITION BY name ORDER BY "createdAt", id) AS rn
    FROM "Service"
)
UPDATE "Service" s
SET name = CONCAT(d.name, ' (', d.rn, '-', LEFT(d.id, 8), ')'),
    "updatedAt" = NOW()
FROM duplicates d
WHERE s.id = d.id AND d.rn > 1;

WITH duplicates AS (
    SELECT id, name, ROW_NUMBER() OVER (PARTITION BY name ORDER BY "createdAt", id) AS rn
    FROM "EscalationPolicy"
)
UPDATE "EscalationPolicy" e
SET name = CONCAT(d.name, ' (', d.rn, '-', LEFT(d.id, 8), ')'),
    "updatedAt" = NOW()
FROM duplicates d
WHERE e.id = d.id AND d.rn > 1;

WITH duplicates AS (
    SELECT id, name, ROW_NUMBER() OVER (PARTITION BY name ORDER BY "createdAt", id) AS rn
    FROM "OnCallSchedule"
)
UPDATE "OnCallSchedule" o
SET name = CONCAT(d.name, ' (', d.rn, '-', LEFT(d.id, 8), ')'),
    "updatedAt" = NOW()
FROM duplicates d
WHERE o.id = d.id AND d.rn > 1;

WITH duplicates AS (
    SELECT id, name, ROW_NUMBER() OVER (PARTITION BY name ORDER BY "createdAt", id) AS rn
    FROM "IncidentTemplate"
)
UPDATE "IncidentTemplate" i
SET name = CONCAT(d.name, ' (', d.rn, '-', LEFT(d.id, 8), ')'),
    "updatedAt" = NOW()
FROM duplicates d
WHERE i.id = d.id AND d.rn > 1;

WITH duplicates AS (
    SELECT id, name, ROW_NUMBER() OVER (PARTITION BY name ORDER BY "createdAt", id) AS rn
    FROM "WebhookIntegration"
)
UPDATE "WebhookIntegration" w
SET name = CONCAT(d.name, ' (', d.rn, '-', LEFT(d.id, 8), ')'),
    "updatedAt" = NOW()
FROM duplicates d
WHERE w.id = d.id AND d.rn > 1;

WITH duplicates AS (
    SELECT id, name, ROW_NUMBER() OVER (PARTITION BY name ORDER BY "createdAt", id) AS rn
    FROM "StatusPage"
)
UPDATE "StatusPage" s
SET name = CONCAT(d.name, ' (', d.rn, '-', LEFT(d.id, 8), ')'),
    "updatedAt" = NOW()
FROM duplicates d
WHERE s.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");
CREATE UNIQUE INDEX "Service_name_key" ON "Service"("name");
CREATE UNIQUE INDEX "EscalationPolicy_name_key" ON "EscalationPolicy"("name");
CREATE UNIQUE INDEX "OnCallSchedule_name_key" ON "OnCallSchedule"("name");
CREATE UNIQUE INDEX "IncidentTemplate_name_key" ON "IncidentTemplate"("name");
CREATE UNIQUE INDEX "WebhookIntegration_name_key" ON "WebhookIntegration"("name");
CREATE UNIQUE INDEX "StatusPage_name_key" ON "StatusPage"("name");
