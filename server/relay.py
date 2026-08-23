"""Local relay + static server for self-hosting. Implements RELAY.md.

Two jobs, both dumb:

  1. Serve the static frontend (web/ at the root, data/ under /data/) so that
     relative asset paths resolve identically here and on GitHub Pages.
  2. Forward one provider call per request and stream the answer back.

It does not know what tarot is. It never reads the payload it forwards, never
stores the caller's API key, and never logs auth material. DEV_LOG=1 logs
request and response bodies for prompt iteration -- that is the one thing this
relay does that the Worker deliberately cannot.

    python3 server/relay.py
"""

import json
import os
import re
import socketserver
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(ROOT, "web")
DATA_DIR = os.path.join(ROOT, "data")

DEFAULT_PROVIDERS = {
    "anthropic": {
        "url": "https://api.anthropic.com/v1/messages",
        "auth": "x-api-key",
        "headers": {"anthropic-version": "2023-06-01"},
    },
    "openai": {
        "url": "https://api.openai.com/v1/chat/completions",
        "auth": "bearer",
    },
}

SECRET_HEADER = re.compile(r"authorization|api[-_]?key|cookie|token|secret", re.I)

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
}


def load_env(path):
    """Minimal .env reader, so self-hosting needs no dependencies."""
    if not os.path.exists(path):
        return
    for line in open(path):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        os.environ.setdefault(key.strip(), val.strip().strip("'\""))


load_env(os.path.join(ROOT, ".env"))

PROVIDERS = json.loads(os.environ.get("PROVIDERS", "")) if os.environ.get("PROVIDERS") \
    else DEFAULT_PROVIDERS
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",")]
DEV_LOG = os.environ.get("DEV_LOG") == "1"
PORT = int(os.environ.get("PORT", "8787"))


def redact(text, key):
    """Scrub auth material out of anything headed for an output stream.

    Two passes, because the key can arrive two ways: named in a header line, or
    embedded in a body or an upstream error message.
    """
    if not text:
        return text
    out = []
    for line in str(text).splitlines():
        name = line.split(":", 1)[0] if ":" in line else ""
        out.append("%s: <redacted>" % name if SECRET_HEADER.search(name) else line)
    text = "\n".join(out)
    if key:
        text = text.replace(key, "<redacted>")
    return text


def devlog(message, key):
    if DEV_LOG:
        print(redact(message, key), file=sys.stderr, flush=True)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "relay"    # no version banner: the client must not be able
    sys_version = ""            # to tell this relay from the Worker

    # -- plumbing ---------------------------------------------------------

    def log_message(self, fmt, *args):
        """Access logs would record URLs but never bodies; keep them behind DEV_LOG."""
        if DEV_LOG:
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def cors_headers(self):
        origin = self.headers.get("Origin")
        allowed = "*" if "*" in ALLOWED_ORIGINS else (origin or "")
        self.send_header("Access-Control-Allow-Origin", allowed)
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")

    def origin_allowed(self):
        origin = self.headers.get("Origin")
        return origin is None or "*" in ALLOWED_ORIGINS or origin in ALLOWED_ORIGINS

    def send_json(self, status, obj, relay_error=False):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if relay_error:
            self.send_header("X-Relay-Error", "1")
        self.cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def send_error_code(self, status, code, message):
        """The only response shape this relay invents. Never includes the key."""
        self.send_json(status, {"error": {"code": code, "message": message}}, relay_error=True)

    # -- routes -----------------------------------------------------------

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if not self.origin_allowed():
            return self.send_error_code(403, "origin_denied", "origin not allowed")
        path = self.path.split("?", 1)[0]
        if path == "/v1/health":
            return self.send_json(200, {"ok": True, "providers": sorted(PROVIDERS)})
        return self.serve_static(path)

    def do_POST(self):
        # Read the body first, whatever happens next: a keep-alive connection
        # left holding an unread body would corrupt the request after it.
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))

        if not self.origin_allowed():
            return self.send_error_code(403, "origin_denied", "origin not allowed")
        if self.path.split("?", 1)[0] != "/v1/chat":
            return self.send_error_code(404, "bad_request", "no such endpoint")

        auth = self.headers.get("Authorization", "")
        key = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        if not key:
            return self.send_error_code(401, "missing_key", "missing bearer token")

        try:
            body = json.loads(raw)
            provider_name, payload = body["provider"], body["payload"]
        except (ValueError, KeyError, TypeError):
            return self.send_error_code(400, "bad_request", "expected JSON {provider, payload}")

        provider = PROVIDERS.get(provider_name)
        if not provider:
            return self.send_error_code(400, "unknown_provider", "provider not configured")

        devlog("--> %s %s" % (provider_name, json.dumps(payload)), key)
        self.forward(provider, payload, key)

    # -- the actual relaying ----------------------------------------------

    def forward(self, provider, payload, key):
        headers = {"Content-Type": "application/json"}
        headers.update(provider.get("headers", {}))
        if provider.get("auth") == "bearer":
            headers["Authorization"] = "Bearer %s" % key
        else:
            headers["x-api-key"] = key

        req = urllib.request.Request(
            provider["url"], data=json.dumps(payload).encode(), headers=headers, method="POST")

        try:
            upstream = urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            upstream = e  # provider's own error: pass it through untouched
        except urllib.error.URLError as e:
            devlog("!!! upstream unreachable: %s" % e.reason, key)
            return self.send_error_code(502, "upstream_unreachable", "could not reach provider")

        self.send_response(upstream.status)
        self.send_header("Content-Type", upstream.headers.get("Content-Type", "application/json"))
        self.send_header("Transfer-Encoding", "chunked")
        self.cors_headers()
        self.end_headers()

        # read1(), not read(): read() would block for a full buffer and turn a
        # token stream into one late delivery.
        seen = []
        while True:
            chunk = upstream.read1(65536)
            if not chunk:
                break
            self.wfile.write(b"%x\r\n" % len(chunk) + chunk + b"\r\n")
            self.wfile.flush()
            if DEV_LOG:
                seen.append(chunk)
        self.wfile.write(b"0\r\n\r\n")
        self.wfile.flush()
        if DEV_LOG:
            devlog("<-- %s" % b"".join(seen).decode("utf-8", "replace"), key)

    # -- static frontend ---------------------------------------------------

    def serve_static(self, path):
        """web/ at the root, data/ under /data/ -- the same shape Pages serves."""
        rel = path.lstrip("/") or "index.html"
        if rel.startswith("data/"):
            base, rel = DATA_DIR, rel[len("data/"):]
        else:
            base = WEB_DIR
        target = os.path.realpath(os.path.join(base, rel))
        if not target.startswith(os.path.realpath(base) + os.sep) or not os.path.isfile(target):
            return self.send_error_code(404, "bad_request", "not found")

        with open(target, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type",
                         CONTENT_TYPES.get(os.path.splitext(target)[1], "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.cors_headers()
        self.end_headers()
        self.wfile.write(data)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    print("relay on http://localhost:%d  providers=%s  DEV_LOG=%s"
          % (port, ",".join(sorted(PROVIDERS)), "on" if DEV_LOG else "off"))
    Server(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
