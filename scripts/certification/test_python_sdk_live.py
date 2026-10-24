#!/usr/bin/env python3
import json
import sys
import uuid
from pathlib import Path

# Add python sdk to path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "sdk" / "python"))
from opsknight_v2 import Client, ApiError

def main():
    fixtures_path = Path(__file__).resolve().parents[2] / "tests" / "certification" / "fixtures.json"
    with open(fixtures_path, "r", encoding="utf-8") as f:
        fixtures = json.load(f)

    api_base = fixtures.get("apiBase", "http://127.0.0.1:3900/api/v2")
    admin_token = fixtures["tokens"]["admin"]
    limited_token = fixtures["tokens"]["limited"]

    print(f"Testing Python SDK against {api_base}...")
    client = Client(api_base, admin_token, allow_insecure_http=True, max_retries=2, timeout=15)

    tests_run = 0
    tests_passed = 0

    def check(name, fn):
        nonlocal tests_run, tests_passed
        tests_run += 1
        try:
            fn()
            tests_passed += 1
            print(f"  [PASS] {name}")
        except Exception as e:
            print(f"  [FAIL] {name}: {e}")
            raise e

    # 1. Users
    check("client.call('listUsers')", lambda: [
        assert_true("data" in client.call("listUsers", {"query": {"limit": 5}}), "Expected data in listUsers")
    ])
    check("client.call('getUser')", lambda: [
        assert_equal(client.call("getUser", {"params": {"id": fixtures["users"]["responderId"]}})["data"]["id"],
                     fixtures["users"]["responderId"], "User ID mismatch")
    ])

    # 2. Services
    check("client.call('listServices')", lambda: [
        assert_true(len(client.call("listServices", {"query": {"limit": 5}})["data"]) > 0, "Expected services")
    ])
    check("client.call('getService')", lambda: [
        assert_equal(client.call("getService", {"params": {"id": fixtures["services"]["serviceAId"]}})["data"]["id"],
                     fixtures["services"]["serviceAId"], "Service ID mismatch")
    ])

    # 3. Incidents
    check("client.call('listIncidents')", lambda: [
        assert_true("data" in client.call("listIncidents", {"query": {"limit": 5}}), "Expected data in listIncidents")
    ])
    check("client.call('getIncident')", lambda: [
        assert_equal(client.call("getIncident", {"params": {"id": fixtures["incidents"]["openId"]}})["data"]["id"],
                     fixtures["incidents"]["openId"], "Incident ID mismatch")
    ])

    # 4. Pagination traversal
    def test_pagination():
        count = 0
        for row in client.paginate("listIncidents", {"query": {"limit": 2}}, max_pages=3):
            count += 1
            if count >= 3:
                break
        assert_true(count > 0, "Expected at least 1 incident from pagination")
    check("client.paginate('listIncidents')", test_pagination)

    # 5. Runbook Lifecycle
    suffix = uuid.uuid4().hex[:8]
    created = client.call("createRunbook", {
        "body": {
            "name": f"Python SDK Runbook {suffix}",
            "slug": f"py-sdk-{suffix}",
            "description": "Created by Python live certification runner"
        },
        "headers": {"Idempotency-Key": f"py-create-{suffix}"}
    })["data"]

    rb_id = created["id"]
    draft_ver_id = created["draftVersionId"]

    check("client.call('validateRunbookDraft')", lambda: [
        assert_true(client.call("validateRunbookDraft", {
            "params": {"id": rb_id, "versionId": draft_ver_id},
            "body": {}
        })["data"]["valid"] is True, "Draft validation failed")
    ])

    published = client.call("publishRunbookDraft", {
        "params": {"id": rb_id, "versionId": draft_ver_id},
        "body": {},
        "headers": {"If-Match": '"0"', "Idempotency-Key": f"py-pub-{suffix}"}
    })["data"]

    check("client.call('publishRunbookDraft')", lambda: [
        assert_equal(published["state"], "PUBLISHED", "Runbook state not published")
    ])

    # 6. Metadata update & ETag conditional write
    meta = client.call("getRunbookMetadata", {"params": {"id": rb_id}})["data"]
    check("client.call('updateRunbookMetadata')", lambda: [
        assert_true("description" in client.call("updateRunbookMetadata", {
            "params": {"id": rb_id},
            "body": {"description": "Updated via Python SDK"},
            "headers": {"If-Match": f'"{meta["revision"]}"', "Idempotency-Key": f"py-upd-{suffix}"}
        })["data"], "Update metadata failed")
    ])

    # 7. Error Handling (404 ApiError)
    def test_404():
        try:
            client.call("getService", {"params": {"id": "cmv_nonexistent_service_id"}})
            raise AssertionError("Expected 404 ApiError was not raised")
        except ApiError as e:
            assert_equal(e.status, 404, "Expected status 404")

    check("ApiError handling on 404", test_404)

    # 8. Scope Denial (403 ApiError)
    def test_403():
        ltd_client = Client(api_base, limited_token, allow_insecure_http=True)
        try:
            ltd_client.call("deleteTeam", {"params": {"id": fixtures["teams"]["teamAId"]}})
            raise AssertionError("Expected 403 ApiError was not raised")
        except ApiError as e:
            assert_true(e.status in (401, 403), "Expected status 401 or 403")

    check("ApiError handling on 403 scope denial", test_403)

    print(f"\nPython Live SDK Certification: {tests_passed}/{tests_run} passed (100%)\n")

def assert_true(cond, msg):
    if not cond:
        raise AssertionError(msg)

def assert_equal(a, b, msg):
    if a != b:
        raise AssertionError(f"{msg}: {a} != {b}")

if __name__ == "__main__":
    main()
