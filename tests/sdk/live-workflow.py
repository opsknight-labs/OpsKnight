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
