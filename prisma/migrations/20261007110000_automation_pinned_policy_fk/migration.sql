-- PostgreSQL referential integrity also fences deletion against concurrently
-- inserted decisions, including after the publishing version is deactivated.
ALTER TABLE "IncidentAutomationDecision" ADD CONSTRAINT "IncidentAutomationDecision_escalationPolicyId_fkey"
FOREIGN KEY ("escalationPolicyId") REFERENCES "EscalationPolicy"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
