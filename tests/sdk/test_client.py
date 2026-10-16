import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "sdk" / "python"))
from opsknight_v2 import ApiError, Client


class Handler(BaseHTTPRequestHandler):
    requests = []
    responses = []

    def log_message(self, *_args):
        pass  # Never print authorization headers or request bodies.

    def do_GET(self):
        self._respond()

    def do_POST(self):
        self._respond()

    def _respond(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        Handler.requests.append((self.command, self.path, dict(self.headers), body))
        status, payload, headers = Handler.responses.pop(0)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())


class ClientTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def setUp(self):
        Handler.requests.clear()
        Handler.responses.clear()
        self.root = f"http://127.0.0.1:{self.server.server_port}/api/v2"
        self.client = Client(self.root, "private-token", allow_insecure_http=True)

    def test_generated_models_import(self):
        import opsknight_v2.models
        self.assertTrue(hasattr(opsknight_v2.models, "RunbookAuthoringVersion"))

    def test_credentials_and_path_encoding(self):
        Handler.responses.append((200, {"data": {"id": "incident"}}, {}))
        self.client.call("getIncident", {"params": {"id": "a/b?c#d"}})
        _, path, headers, _ = Handler.requests[0]
        self.assertEqual(path, "/api/v2/incidents/a%2Fb%3Fc%23d")
        self.assertNotIn("private-token", path)
        self.assertEqual(headers["Authorization"], "Bearer private-token")

    def test_retry_preserves_body_and_idempotency_key(self):
        Handler.responses.extend([(503, {"code": "TEMPORARY"}, {"Retry-After": "0"}),
                                  (202, {"data": {"executionId": "one"}}, {})])
        self.client.call("executeRunbook", {"params": {"id": "runbook"}, "body": {},
                         "headers": {"Idempotency-Key": "one-command"}})
        self.assertEqual(len(Handler.requests), 2)
        self.assertEqual(Handler.requests[0][3], Handler.requests[1][3])
        self.assertTrue(all(row[2]["Idempotency-Key"] == "one-command" for row in Handler.requests))

    def test_one_time_token_issuance_is_never_retried(self):
        Handler.responses.append((503, {"code": "TEMPORARY"}, {"Retry-After": "0"}))
        with self.assertRaises(ApiError):
            self.client.call("issueServiceAccountToken", {"params": {"id": "account"},
                             "body": {"name": "ci", "scopes": ["incidents:read"], "expiresInDays": 1}})
        self.assertEqual(len(Handler.requests), 1)

    def test_redirect_is_not_followed(self):
        Handler.responses.append((302, {}, {"Location": self.root + "/sensitive-target"}))
        with self.assertRaises(ApiError) as failure:
            self.client.call("listIncidents", {})
        self.assertEqual(failure.exception.status, 302)
        self.assertEqual(len(Handler.requests), 1)

    def test_precondition_error_preserves_request_id_without_secret_details(self):
        Handler.responses.append((412, {"code": "PRECONDITION_FAILED", "detail": "SECRET_MARKER"}, {"x-request-id": "request-one"}))
        with self.assertRaises(ApiError) as failure:
            self.client.call("getIncident", {"params": {"id": "incident"}})
        self.assertEqual(failure.exception.code, "PRECONDITION_FAILED")
        self.assertEqual(failure.exception.request_id, "request-one")
        self.assertNotIn("SECRET_MARKER", str(failure.exception))
        self.assertEqual(len(Handler.requests), 1)

    def test_required_headers_and_credentials_are_checked_before_network(self):
        with self.assertRaises(ValueError):
            self.client.call("publishRunbookDraft", {"params": {"id": "runbook", "versionId": "version"}, "body": {}})
        with self.assertRaises(ValueError):
            self.client.call("listIncidents", {"headers": {"Authorization": "another-token"}})
        with self.assertRaises(ValueError):
            Client("https://user:pass@example.com/api/v2", "token")
        with self.assertRaises(ValueError):
            Client("http://example.com/api/v2", "token")
        self.assertEqual(Handler.requests, [])

    def test_long_retry_after_is_not_ignored(self):
        Handler.responses.append((429, {"code": "RATE_LIMITED"}, {"Retry-After": "3600"}))
        with self.assertRaises(ApiError):
            self.client.call("listIncidents", {})
        self.assertEqual(len(Handler.requests), 1)

    def test_cursor_traversal_and_replay_loop_guard(self):
        Handler.responses.extend([
            (200, {"data": [{"id": "one"}], "pagination": {"hasMore": True, "nextCursor": "signed-cursor"}}, {}),
            (200, {"data": [{"id": "two"}], "pagination": {"hasMore": False, "nextCursor": None}}, {})])
        request = {"query": {"limit": 1}}
        self.assertEqual(list(self.client.paginate("listIncidents", request)), [{"id": "one"}, {"id": "two"}])
        self.assertEqual(parse_qs(urlsplit(Handler.requests[1][1]).query)["cursor"], ["signed-cursor"])
        self.assertEqual(request, {"query": {"limit": 1}})
        Handler.responses.extend([(200, {"data": [], "pagination": {"hasMore": True, "nextCursor": "repeat"}}, {})] * 2)
        with self.assertRaisesRegex(ValueError, "repeated pagination cursor"):
            list(self.client.paginate("listIncidents", {}))


if __name__ == "__main__":
    unittest.main()
