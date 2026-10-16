"""Standard-library REST client. Request/response types are in the generated stub."""
from __future__ import annotations

import json
import math
import re
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Iterator
from urllib.error import HTTPError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

with Path(__file__).with_name("operations.json").open(encoding="utf-8") as _source:
    _OPERATIONS = json.load(_source)

_MAX_RESPONSE_BYTES = 8 * 1024 * 1024


class ApiError(Exception):
    def __init__(self, status: int, code: str, request_id: str | None):
        super().__init__(f"OpsKnight request failed ({status}, {code}).")
        self.status = status
        self.code = code
        self.request_id = request_id


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Client:
    def __init__(self, base_url: str, token: str, *, max_retries: int = 2,
                 timeout: float = 30, allow_insecure_http: bool = False):
        parsed = urlsplit(base_url)
        if (not parsed.hostname or parsed.username or parsed.password or parsed.query or
                parsed.fragment or (parsed.scheme != "https" and not
                (parsed.scheme == "http" and allow_insecure_http))):
            raise ValueError("Use an HTTPS API root without credentials, query or fragment. HTTP requires allow_insecure_http.")
        if not token or any(character.isspace() for character in token):
            raise ValueError("A nonempty API token without whitespace is required.")
        if type(max_retries) is not int or not 0 <= max_retries <= 3:
            raise ValueError("max_retries must be 0–3.")
        if not isinstance(timeout, (float, int)) or not math.isfinite(timeout) or not 0 < timeout <= 120:
            raise ValueError("timeout must be greater than zero and at most 120 seconds.")
        self.__base_url = base_url.rstrip("/")
        self.__token = token
        self.__max_retries = max_retries
        self.__timeout = timeout
        self.__opener = build_opener(_NoRedirect())

    def call(self, operation: str, request: dict[str, Any]) -> Any:
        definition = _OPERATIONS.get(operation)
        if definition is None:
            raise ValueError("Unknown OpsKnight operation.")

        def parameter(match):
            name = match.group(1)
            value = request.get("params", {}).get(name)
            if not isinstance(value, str) or not value or value in (".", ".."):
                raise ValueError(f"Missing or invalid path parameter: {name}")
            return quote(value, safe="")

        path = re.sub(r"\{(\w+)\}", parameter, definition["path"])
        query = {key: str(value).lower() if isinstance(value, bool) else value
                 for key, value in request.get("query", {}).items() if value is not None}
        url = self.__base_url + path + (("?" + urlencode(query)) if query else "")
        headers = {"authorization": "Bearer " + self.__token, "accept": "application/json"}
        for key, value in request.get("headers", {}).items():
            if key.lower() not in ("idempotency-key", "if-match"):
                raise ValueError("Only If-Match and Idempotency-Key may be supplied as custom headers.")
            if not isinstance(value, str) or "\r" in value or "\n" in value:
                raise ValueError("Header values must be strings without line breaks.")
            headers[key.lower()] = value
        for name in definition["requiredHeaders"]:
            if not headers.get(name.lower(), "").strip():
                raise ValueError(f"Required header: {name}")
        if definition["bodyRequired"] and "body" not in request:
            raise ValueError("A request body is required.")
        body = None
        if "body" in request:
            body = json.dumps(request["body"], allow_nan=False).encode("utf-8")
            headers["content-type"] = "application/json"
        retry_safe = definition["method"] == "GET" or (
            definition["idempotency"] in ("supported", "required") and
            bool(headers.get("idempotency-key")))

        for attempt in range(self.__max_retries + 1):
            outgoing = Request(url, data=body, headers=headers, method=definition["method"])
            try:
                response = self.__opener.open(outgoing, timeout=self.__timeout)
            except HTTPError as error:
                response = error
            with response:
                status = response.code
                if retry_safe and attempt < self.__max_retries and status in (429, 502, 503, 504):
                    delay = self._retry_delay(response.headers.get("Retry-After"), attempt)
                    if delay <= 30:
                        # Close before sleeping so retries do not retain sockets.
                        response.close()
                        time.sleep(delay)
                        continue
                raw = response.read(_MAX_RESPONSE_BYTES + 1)
                if len(raw) > _MAX_RESPONSE_BYTES:
                    raise ValueError("API response exceeds the supported size.")
                payload = None
                if raw:
                    try:
                        payload = json.loads(raw)
                    except (ValueError, UnicodeDecodeError):
                        if 200 <= status < 300:
                            raise ValueError("API returned invalid JSON.") from None
                if not 200 <= status < 300:
                    code = payload.get("code", "HTTP_ERROR") if isinstance(payload, dict) else "HTTP_ERROR"
                    raise ApiError(status, code if isinstance(code, str) else "HTTP_ERROR",
                                   response.headers.get("x-request-id"))
                return None if status == 204 else payload
        raise RuntimeError("Retry limit exceeded.")

    @staticmethod
    def _retry_delay(value: str | None, attempt: int) -> float:
        if value and value.isascii() and value.isdigit():
            return float(value)
        if value:
            try:
                when = parsedate_to_datetime(value)
                return max(0, (when - datetime.now(timezone.utc)).total_seconds())
            except (ValueError, TypeError, OverflowError):
                pass
        return min(0.25 * 2 ** attempt, 2)

    def paginate(self, operation: str, request: dict[str, Any], *, max_pages: int = 10000) -> Iterator[Any]:
        definition = _OPERATIONS.get(operation)
        if not definition or definition["method"] != "GET" or definition["kind"] != "list":
            raise ValueError("Pagination requires a list operation.")
        if type(max_pages) is not int or not 1 <= max_pages <= 10000:
            raise ValueError("max_pages must be 1–10000.")
        query = dict(request.get("query", {}))
        seen: set[str] = set()
        for _ in range(max_pages):
            response = self.call(operation, {**request, "query": query})
            if not isinstance(response, dict) or not isinstance(response.get("data"), list):
                raise ValueError("List response has no data array.")
            yield from response["data"]
            pagination = response.get("pagination")
            if not pagination or not pagination.get("hasMore"):
                return
            cursor = pagination.get("nextCursor")
            if not isinstance(cursor, str) or not cursor or cursor in seen:
                raise ValueError("Invalid or repeated pagination cursor.")
            seen.add(cursor)
            query["cursor"] = cursor
        raise ValueError("Pagination exceeded max_pages.")
