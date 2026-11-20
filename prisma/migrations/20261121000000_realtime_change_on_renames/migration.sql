-- Names of policies, teams, schedules, status pages, runbooks and users are shown
-- on the dashboard, incident and analytics views, whose caches are keyed on the
-- realtime change generation. Bump it when one of those names changes (or the row
-- is created/deleted) so renames show up everywhere without waiting for an
-- incident change. `UPDATE OF "name"` keeps busy tables (User activity) quiet.
CREATE TRIGGER "EscalationPolicy_realtime_change"
AFTER INSERT OR UPDATE OF "name" OR DELETE ON "EscalationPolicy"
FOR EACH STATEMENT EXECUTE FUNCTION public."opsknight_append_realtime_change"();

CREATE TRIGGER "Team_realtime_change"
AFTER INSERT OR UPDATE OF "name" OR DELETE ON "Team"
FOR EACH STATEMENT EXECUTE FUNCTION public."opsknight_append_realtime_change"();

CREATE TRIGGER "OnCallSchedule_realtime_change"
AFTER INSERT OR UPDATE OF "name" OR DELETE ON "OnCallSchedule"
FOR EACH STATEMENT EXECUTE FUNCTION public."opsknight_append_realtime_change"();

CREATE TRIGGER "StatusPage_realtime_change"
AFTER INSERT OR UPDATE OF "name" OR DELETE ON "StatusPage"
FOR EACH STATEMENT EXECUTE FUNCTION public."opsknight_append_realtime_change"();

CREATE TRIGGER "Runbook_realtime_change"
AFTER INSERT OR UPDATE OF "name" OR DELETE ON "Runbook"
FOR EACH STATEMENT EXECUTE FUNCTION public."opsknight_append_realtime_change"();

CREATE TRIGGER "User_realtime_change"
AFTER UPDATE OF "name" ON "User"
FOR EACH STATEMENT EXECUTE FUNCTION public."opsknight_append_realtime_change"();
