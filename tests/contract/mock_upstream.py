"""Fake provider for the contract suite.

Stands in for Anthropic/OpenAI so the suite can assert what the relay forwarded
without spending anyone's tokens. Registered as the `test*` providers in the
relay's PROVIDERS config -- which is config, not a test-only code path in either
relay.

    python3 tests/contract/mock_upstream.py 8899
"""

import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CHUNKS = [b"data: one\n\n", b"data: two\n\n", b"data: three\n\n"]
CHUNK_GAP = 0.25


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass  # the suite greps relay output; mock noise would be a false positive

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))

        if self.path == "/stream":
            body = b"".join(CHUNKS)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            for chunk in CHUNKS:
                self.wfile.write(chunk)
                self.wfile.flush()
                time.sleep(CHUNK_GAP)
            return

        if self.path == "/boom":
            # A provider refusing, in the provider's own shape.
            return self.respond(429, {"error": {"type": "rate_limit_error",
                                                "message": "provider says no"}})

        return self.respond(200, {
            "echo_body": json.loads(raw) if raw else None,
            "echo_headers": {k.lower(): v for k, v in self.headers.items()},
        })

    def respond(self, status, obj):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    Server(("127.0.0.1", port), Handler).serve_forever()
