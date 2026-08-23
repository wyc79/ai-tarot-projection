"""One suite, both relays. See RELAY.md.

The relay under test is named by RELAY_BASE; everything else is identical, which
is the whole point -- if a test needs to know which implementation answered, the
contract has failed.

    RELAY_BASE=http://127.0.0.1:8788 RELAY_LOG=/tmp/relay.log \
        python3 -m unittest discover -s tests/contract -v

Driven by scripts/run_contract_tests.sh, which starts each relay in turn.
"""

import json
import os
import re
import time
import unittest
import urllib.error
import urllib.request

BASE = os.environ.get("RELAY_BASE", "http://127.0.0.1:8788").rstrip("/")
LOG = os.environ.get("RELAY_LOG")
RATE_LIMIT = os.environ.get("RELAY_RATE_LIMIT")
ALLOWED_ORIGIN = os.environ.get("RELAY_ORIGIN", "http://localhost:1234")

# Distinctive enough that finding it in any output stream is unambiguous.
CANARY_KEY = "sk-canary-0ff1ce-do-not-log-me"

WORKER_SRC = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "worker", "src", "index.js")


def call(path="/v1/chat", body=None, key=CANARY_KEY, origin=None, method="POST", raw=None):
    """Returns (status, headers, body_bytes). Relay errors are responses, not exceptions."""
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if key:
        req.add_header("Authorization", "Bearer %s" % key)
    if origin:
        req.add_header("Origin", origin)
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def as_json(body):
    return json.loads(body.decode())


class HealthTest(unittest.TestCase):
    def test_health_shape(self):
        status, _, body = call("/v1/health", method="GET", key=None)
        self.assertEqual(status, 200)
        payload = as_json(body)
        self.assertEqual(set(payload), {"ok", "providers"})
        self.assertIs(payload["ok"], True)
        self.assertIn("test", payload["providers"])

    def test_health_does_not_identify_the_implementation(self):
        _, _, body = call("/v1/health", method="GET", key=None)
        text = body.decode().lower()
        for tell in ("python", "worker", "cloudflare", "wrangler", "http.server"):
            self.assertNotIn(tell, text, "health response names the implementation")


class ErrorShapeTest(unittest.TestCase):
    def assert_relay_error(self, status, headers, body, expected_status, code):
        self.assertEqual(status, expected_status)
        self.assertEqual(headers.get("X-Relay-Error"), "1")
        self.assertEqual(as_json(body)["error"]["code"], code)

    def test_missing_key(self):
        self.assert_relay_error(*call(body={"provider": "test", "payload": {}}, key=None),
                                expected_status=401, code="missing_key")

    def test_unknown_provider(self):
        self.assert_relay_error(*call(body={"provider": "nope", "payload": {}}),
                                expected_status=400, code="unknown_provider")

    def test_bad_request(self):
        self.assert_relay_error(*call(raw=b"not json at all"),
                                expected_status=400, code="bad_request")

    def test_origin_denied(self):
        self.assert_relay_error(*call(body={"provider": "test", "payload": {}},
                                      origin="http://evil.example"),
                                expected_status=403, code="origin_denied")

    def test_allowed_origin_passes(self):
        status, headers, _ = call(body={"provider": "test", "payload": {"x": 1}},
                                  origin=ALLOWED_ORIGIN)
        self.assertEqual(status, 200)
        self.assertNotIn("X-Relay-Error", headers)

    def test_upstream_unreachable(self):
        self.assert_relay_error(*call(body={"provider": "test-dead", "payload": {}}),
                                expected_status=502, code="upstream_unreachable")


class ForwardingTest(unittest.TestCase):
    def test_payload_forwarded_verbatim(self):
        payload = {"model": "x", "messages": [{"role": "user", "content": "hi"}],
                   "nested": {"deep": [1, 2, {"three": True}]}, "stream": False}
        status, _, body = call(body={"provider": "test", "payload": payload})
        self.assertEqual(status, 200)
        self.assertEqual(as_json(body)["echo_body"], payload,
                         "relay altered the payload it was told to forward")

    def test_auth_translated_to_x_api_key(self):
        _, _, body = call(body={"provider": "test", "payload": {}})
        headers = as_json(body)["echo_headers"]
        self.assertEqual(headers.get("x-api-key"), CANARY_KEY)
        self.assertNotIn("authorization", headers,
                         "client's Authorization header reached the provider unchanged")

    def test_auth_translated_to_bearer(self):
        _, _, body = call(body={"provider": "test-bearer", "payload": {}})
        headers = as_json(body)["echo_headers"]
        self.assertEqual(headers.get("authorization"), "Bearer %s" % CANARY_KEY)

    def test_static_provider_headers_are_added(self):
        _, _, body = call(body={"provider": "test", "payload": {}})
        self.assertEqual(as_json(body)["echo_headers"].get("x-contract-test"), "yes")

    def test_upstream_error_passes_through(self):
        status, headers, body = call(body={"provider": "test-error", "payload": {}})
        self.assertEqual(status, 429)
        self.assertNotIn("X-Relay-Error", headers,
                         "a provider refusal was labelled as a relay refusal")
        self.assertEqual(as_json(body)["error"]["type"], "rate_limit_error")

    def test_stream_is_incremental(self):
        """Chunks must arrive as the provider emits them, not all at the end."""
        req = urllib.request.Request(
            BASE + "/v1/chat",
            data=json.dumps({"provider": "test-stream", "payload": {}}).encode(),
            method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", "Bearer %s" % CANARY_KEY)

        start = time.monotonic()
        arrivals, received = [], b""
        resp = urllib.request.urlopen(req, timeout=15)
        self.assertIn("text/event-stream", resp.headers.get("Content-Type", ""))
        while True:
            chunk = resp.read1(65536)
            if not chunk:
                break
            arrivals.append(time.monotonic() - start)
            received += chunk

        self.assertEqual(received, b"data: one\n\ndata: two\n\ndata: three\n\n")
        self.assertGreaterEqual(len(arrivals), 2, "whole stream arrived as one buffered lump")
        self.assertLess(arrivals[0], arrivals[-1] - 0.2,
                        "first chunk did not arrive meaningfully before the last")


class KeyRedactionTest(unittest.TestCase):
    """The key is the thing this project promises to never write down."""

    def read_log(self):
        if not LOG or not os.path.exists(LOG):
            self.skipTest("no RELAY_LOG captured for this relay")
        with open(LOG, errors="replace") as f:
            return f.read()

    def test_key_never_logged(self):
        call(body={"provider": "test", "payload": {"prompt": "a fully assembled prompt"}})
        time.sleep(0.3)
        log = self.read_log()
        self.assertNotIn(CANARY_KEY, log, "the API key reached an output stream")

    def test_error_paths_never_leak_key(self):
        for body, raw, origin in (
            ({"provider": "nope", "payload": {}}, None, None),
            (None, b"not json", None),
            ({"provider": "test-dead", "payload": {}}, None, None),
            ({"provider": "test", "payload": {}}, None, "http://evil.example"),
        ):
            _, _, resp = call(body=body, raw=raw, origin=origin)
            self.assertNotIn(CANARY_KEY, resp.decode(errors="replace"),
                             "an error response echoed the key back")
        time.sleep(0.3)
        self.assertNotIn(CANARY_KEY, self.read_log(), "an error path logged the key")

    def test_dev_log_still_captured_something(self):
        """Guards the redaction tests: an empty log would pass them vacuously."""
        if not LOG or not os.path.exists(LOG):
            self.skipTest("no RELAY_LOG captured for this relay")
        if os.environ.get("RELAY_DEV_LOG") != "1":
            self.skipTest("DEV_LOG is off for this relay")
        call(body={"provider": "test", "payload": {"prompt": "canary-prompt-marker"}})
        time.sleep(0.3)
        self.assertIn("canary-prompt-marker", self.read_log(),
                      "DEV_LOG=1 logged nothing, so the redaction tests prove nothing")


class WorkerSourceTest(unittest.TestCase):
    """Structural, not behavioural: runs regardless of which relay is up."""

    def strip_comments(self, src):
        src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
        return re.sub(r"(?<!:)//.*", "", src)

    def test_worker_has_no_logging_code(self):
        with open(WORKER_SRC) as f:
            code = self.strip_comments(f.read())
        for call_site in re.findall(r"\bconsole\s*\.\s*\w+|\.\s*log\s*\(", code):
            self.fail("worker contains a logging call (%r); it must have none, "
                      "not even a disabled one" % call_site)


class RateLimitTest(unittest.TestCase):
    def test_rate_limited(self):
        if RATE_LIMIT != "1":
            self.skipTest("rate limiting is Worker-only; set RELAY_RATE_LIMIT=1")
        codes = set()
        for _ in range(40):
            status, headers, body = call(body={"provider": "test", "payload": {}})
            if status == 429 and headers.get("X-Relay-Error") == "1":
                codes.add(as_json(body)["error"]["code"])
                break
        self.assertEqual(codes, {"rate_limited"}, "limit never tripped in 40 requests")


if __name__ == "__main__":
    unittest.main()
