-- Additive enum value. Existing rows and code paths keep RELATED/DUPLICATE_OF/CAUSED_BY unchanged.
ALTER TYPE "IncidentRelationshipType" ADD VALUE IF NOT EXISTS 'PARENT_CHILD';
