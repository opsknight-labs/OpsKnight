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
