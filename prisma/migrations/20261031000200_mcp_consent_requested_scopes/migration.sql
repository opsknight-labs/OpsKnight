-- Which pending scopes the assistant asked for by name, so consent can pre-select only those
-- change permissions. Existing pending requests expire within minutes and default to none.
ALTER TABLE "McpConsentRequest" ADD COLUMN "requestedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[];
