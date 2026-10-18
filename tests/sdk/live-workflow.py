"""Invoked by live-workflows.mjs. Credentials arrive on stdin, never command-line arguments."""
import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "sdk" / "python"))
from opsknight_v2 import Client

configuration = json.load(sys.stdin)
client = Client(configuration["baseUrl"], configuration["token"], allow_insecure_http=True)
suffix = uuid.uuid4().hex
created = client.call("createRunbook", {
    "body": {"name": "Python live SDK verification", "slug": "python-sdk-" + suffix},
    "headers": {"Idempotency-Key": "create-" + suffix},
})["data"]
params = {"id": created["id"], "versionId": created["draftVersionId"]}
validation = client.call("validateRunbookDraft", {"params": params, "body": {}})
assert validation["data"]["valid"] is True
published = client.call("publishRunbookDraft", {
    "params": params, "body": {},
    "headers": {"If-Match": '"0"', "Idempotency-Key": "publish-" + suffix},
})
assert published["data"]["state"] == "PUBLISHED"
rows = list(client.paginate("listRunbooks", {"query": {"limit": 1}}, max_pages=100))
assert created["id"] in [row["id"] for row in rows]
assert configuration["typescriptRunbookId"] in [row["id"] for row in rows]
print("Python live create/validate/publish/cursor workflows passed.")

lifecycle = client.call("createRunbook", {"body": {"name": "Python lifecycle", "slug": "python-lifecycle-" + suffix}, "headers": {"Idempotency-Key": uuid.uuid4().hex}})["data"]
lifecycle_params = {"id": lifecycle["id"]}
metadata = client.call("getRunbookMetadata", {"params": lifecycle_params})["data"]
def lifecycle_headers(revision):
    return {"If-Match": '\"%s\"' % revision, "Idempotency-Key": uuid.uuid4().hex}
changed = client.call("updateRunbookMetadata", {"params": lifecycle_params, "body": {"description": "Reviewed through Python"}, "headers": lifecycle_headers(metadata["revision"])})["data"]
archived = client.call("archiveRunbook", {"params": lifecycle_params, "body": {}, "headers": lifecycle_headers(changed["revision"])})["data"]
assert archived["archivedAt"] is not None
restored = client.call("restoreRunbook", {"params": lifecycle_params, "body": {}, "headers": lifecycle_headers(archived["revision"])})["data"]
assert restored["archivedAt"] is None
copy = client.call("duplicateRunbook", {"params": lifecycle_params, "body": {}, "headers": lifecycle_headers(restored["revision"])})["data"]
comparison = client.call("compareRunbookVersions", {"params": {"id": created["id"], "versionId": published["data"]["id"]}, "query": {"baseVersionId": published["data"]["id"]}})["data"]
assert all(step["change"] == "UNCHANGED" for step in comparison["steps"])
assert client.call("checkRunbookDeletion", {"params": {"id": copy["id"]}})["data"]["canDelete"]
client.call("deleteRunbook", {"params": {"id": copy["id"]}, "body": {"confirmationText": copy["name"]}, "headers": lifecycle_headers(copy["revision"])})
print("Python live metadata/archive/restore/duplicate/comparison/deletion workflows passed.")

rule_service_id = configuration["runbookRuleServiceId"]
rule_body = {"configuration": {"runbookId": created["id"], "runbookVersionId": published["data"]["id"], "mode": "AUTOMATIC", "versionStrategy": "PINNED"}, "expectedVersionId": published["data"]["id"], "trigger": {"event": "INCIDENT_CREATED", "conditions": []}}
rule = client.call("createServiceRunbookRule", {"params": {"id": rule_service_id}, "body": rule_body, "headers": {"Idempotency-Key": uuid.uuid4().hex}})["data"]
rule_params = {"id": rule_service_id, "ruleId": rule["id"]}
rule = client.call("getServiceRunbookRule", {"params": rule_params})["data"]
assert client.call("validateServiceRunbookRule", {"params": rule_params, "body": {}})["data"]["configurationRevision"] == rule["configurationRevision"]
rule = client.call("replaceRunbookRuleTriggers", {"params": rule_params, "body": {"event": "INCIDENT_CREATED", "conditions": [{"field": "incident.urgency", "operator": "EQUALS", "value": "HIGH"}]}, "headers": lifecycle_headers(rule["configurationRevision"])})["data"]
rule = client.call("activateServiceRunbookRule", {"params": rule_params, "body": {"confirmMatchAll": False}, "headers": lifecycle_headers(rule["configurationRevision"])})["data"]
assert rule["enabled"]
rule = client.call("updateServiceRunbookRule", {"params": rule_params, "body": {"configuration": {"name": "Python reviewed rule"}, "expectedVersionId": published["data"]["id"]}, "headers": lifecycle_headers(rule["configurationRevision"])})["data"]
assert not rule["enabled"]
rule = client.call("pauseServiceRunbookRule", {"params": rule_params, "body": {}, "headers": lifecycle_headers(rule["configurationRevision"])})["data"]
rule_copy = client.call("duplicateServiceRunbookRule", {"params": rule_params, "body": {}, "headers": lifecycle_headers(rule["configurationRevision"])})["data"]
assert rule_copy["id"] != rule["id"] and not rule_copy["enabled"]
rule_list = client.call("listServiceRunbookRules", {"params": {"id": rule_service_id}, "query": {"limit": 1}})["data"]
assert len(rule_list) == 1 and "inputValues" not in rule_list[0]
client.call("detachServiceRunbookRule", {"params": {"id": rule_service_id, "ruleId": rule_copy["id"]}, "body": {}, "headers": lifecycle_headers(rule_copy["configurationRevision"])})
policy_book = client.call("createRunbook", {"body": {"name": "Python policy workflow", "slug": "python-policy-" + suffix, "definition": {"steps": [{"key": "check", "name": "Check", "type": "LINUX_DIAGNOSTICS", "riskClass": "READ_ONLY", "config": {"action": "summary"}}]}}, "headers": {"Idempotency-Key": uuid.uuid4().hex}})["data"]
policy_version = client.call("publishRunbookDraft", {"params": {"id": policy_book["id"], "versionId": policy_book["draftVersionId"]}, "body": {}, "headers": {"If-Match": '\"0\"', "Idempotency-Key": uuid.uuid4().hex}})["data"]
policy_rule = client.call("createServiceRunbookRule", {"params": {"id": rule_service_id}, "body": {"configuration": {"runbookId": policy_book["id"], "runbookVersionId": policy_version["id"], "versionStrategy": "PINNED", "mode": "MANUAL", "enabled": False, "defaultAgentId": configuration["runbookRuleAgentId"]}, "expectedVersionId": policy_version["id"]}, "headers": {"Idempotency-Key": uuid.uuid4().hex}})["data"]
policy_params = {"id": rule_service_id, "ruleId": policy_rule["id"]}
policy_request = client.call("requestRunbookRulePolicyChecks", {"params": policy_params, "body": {}, "headers": lifecycle_headers(policy_rule["configurationRevision"])})["data"]
assert policy_request["checkedTargets"] == 1 and policy_request["status"] == "PENDING" and len(policy_request["checkIds"]) == 1
policy_checks = client.call("listRunbookRulePolicyChecks", {"params": policy_params})["data"]
assert len(policy_checks) == 1 and "steps" not in policy_checks[0] and "results" not in policy_checks[0]
print("Python live service-rule authoring/revision/readiness/activation/policy-check workflows passed.")

# Each automation endpoint is exercised through the generated operation manifest
# against HTTP, independently of the TypeScript/browser journey.
params = {"id": configuration["automationServiceId"]}
settings = client.call("getAutomationSettings", {})["data"]
client.call("updateAutomationSettings", {
    "body": {"automationEnabled": True, "automationTraceRetentionDays": settings["automationTraceRetentionDays"]},
    "headers": {"If-Match": '"%s"' % settings["automationSettingsRevision"], "Idempotency-Key": uuid.uuid4().hex},
})
snapshot = {"schemaVersion": 1, "fields": [], "rules": []}
draft = client.call("getAutomationDraft", {"params": params})["data"]
saved = client.call("saveAutomationDraft", {"params": params, "body": {"snapshot": snapshot},
    "headers": {"If-Match": '"%s"' % draft["revision"], "Idempotency-Key": uuid.uuid4().hex}})["data"]
assert client.call("validateAutomation", {"params": params, "body": {"snapshot": snapshot}})["data"]["valid"]
simulation = client.call("simulateAutomation", {"params": params, "body": {
    "snapshot": snapshot, "integrationType": "EVENTS_API_V2", "event": {
        "event_action": "trigger", "dedup_key": uuid.uuid4().hex,
        "payload": {"summary": "Python private simulation", "source": "python-sdk-source", "severity": "info"},
    },
}})["data"]
assert simulation["result"]["outcome"]["type"] == "SERVICE_DEFAULT"
assert "Python private simulation" not in json.dumps(simulation)
published = client.call("publishAutomationVersion", {"params": params,
    "body": {"expectedActiveVersionId": None},
    "headers": {"If-Match": '"%s"' % saved["revision"], "Idempotency-Key": uuid.uuid4().hex}})["data"]
current = client.call("getServiceAutomation", {"params": params})["data"]
assert current["mode"] == "DISABLED"
client.call("updateServiceAutomationMode", {"params": params,
    "body": {"mode": "SHADOW", "expectedActiveVersionId": published["id"]},
    "headers": {"If-Match": '"%s"' % current["revision"], "Idempotency-Key": uuid.uuid4().hex}})
assert client.call("listAutomationVersions", {"params": params, "query": {"limit": 1}})["data"][0]["id"] == published["id"]
assert client.call("getAutomationVersion", {"params": {**params, "versionId": published["id"]}})["data"]["snapshot"] == snapshot
restored = client.call("restoreAutomationDraft", {"params": params,
    "body": {"sourceVersionId": published["id"]},
    "headers": {"If-Match": '"%s"' % saved["revision"], "Idempotency-Key": uuid.uuid4().hex}})["data"]
assert restored["restoredFromVersionId"] == published["id"]
current = client.call("getServiceAutomation", {"params": params})["data"]
assert current["mode"] == "SHADOW" and current["activeVersionId"] == published["id"]
assert client.call("listAutomationDecisions", {"params": params})["data"] == []
assert client.call("listAutomationObservations", {"params": params, "query": {"unmapped": True}})["data"] == []
client.call("updateServiceAutomationMode", {"params": params,
    "body": {"mode": "DISABLED", "expectedActiveVersionId": published["id"]},
    "headers": {"If-Match": '"%s"' % current["revision"], "Idempotency-Key": uuid.uuid4().hex}})
print("Python live automation validation/simulation/mode/history/restoration/diagnostics passed.")

subscriber_params = {"id": configuration["statusPageId"], "subscriberId": configuration["statusSubscriberId"]}
subscriber = client.call("getStatusPageSubscriber", {"params": subscriber_params})["data"]
assert "token" not in subscriber and "verificationToken" not in subscriber
subscriber_rows = list(client.paginate("listStatusPageSubscribers", {"params": {"id": configuration["statusPageId"]}, "query": {"limit": 1}}, max_pages=1000))
assert subscriber["id"] in [row["id"] for row in subscriber_rows]
client.call("getStatusPageSubscriberStats", {"params": {"id": configuration["statusPageId"]}})
assert client.call("getStatusPageSubscriptionSettings", {"params": {"id": configuration["statusPageId"]}})["data"]["verificationRequired"] is True
client.call("removeStatusPageSubscriber", {"params": subscriber_params, "headers": {"Idempotency-Key": uuid.uuid4().hex}})
assert client.call("getStatusPageSubscriber", {"params": subscriber_params})["data"]["state"] == "UNSUBSCRIBED"
print("Python live status-page subscriber administration passed.")

for read_operation, write_operation, changes in [
    ("getStatusPageContent", "updateStatusPageContent", {"footerText": "Python footer " + suffix}),
    ("getStatusPageSettings", "updateStatusPageSettings", {"organizationName": "Python organization " + suffix}),
    ("getStatusPageAppearance", "updateStatusPageAppearance", {"branding": {"primaryColor": "#654321"}}),
    ("getStatusPagePrivacy", "updateStatusPagePrivacy", {"showIncidentTitles": False}),
]:
    before = client.call(read_operation, {"params": {"id": configuration["statusPageId"]}})["data"]
    after = client.call(write_operation, {"params": {"id": configuration["statusPageId"]}, "body": changes, "headers": {"Idempotency-Key": uuid.uuid4().hex, "If-Match": '\"%s\"' % before["revision"]}})["data"]
    assert after["revision"] >= before["revision"] and "status" in after["publication"]
status_configuration = client.call("getStatusPageSettings", {"params": {"id": configuration["statusPageId"]}})["data"]
components = client.call("setStatusPageServices", {"params": {"id": configuration["statusPageId"]}, "body": {"serviceIds": [configuration["runbookRuleServiceId"]]}, "headers": {"Idempotency-Key": uuid.uuid4().hex, "If-Match": '\"%s\"' % status_configuration["revision"]}})["data"]
client.call("updateStatusPageService", {"params": {"id": configuration["statusPageId"], "serviceId": configuration["runbookRuleServiceId"]}, "body": {"displayName": "Python reviewed component"}, "headers": {"Idempotency-Key": uuid.uuid4().hex, "If-Match": '\"%s\"' % components["revision"]}})
assert client.call("listStatusPageServices", {"params": {"id": configuration["statusPageId"]}, "query": {"limit": 1}})["data"][0]["displayName"] == "Python reviewed component"
print("Python live status-page configuration, privacy and service components passed.")

publication = client.call("getStatusPagePublication", {"params": {"id": configuration["statusPageId"]}})["data"]
retry = client.call("retryStatusPagePublication", {"params": {"id": configuration["statusPageId"]}, "body": {}, "headers": {"Idempotency-Key": uuid.uuid4().hex, "If-Match": '"%s"' % publication["revision"]}})["data"]
assert retry["status"] == "PENDING"
job = client.call("getStatusPagePublicationJob", {"params": {"id": configuration["statusPageId"], "jobId": retry["id"]}})["data"]
assert job["id"] == retry["id"] and job["result"] is None
print("Python live status-page publication inspection and durable retry acceptance passed.")
