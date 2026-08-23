# Relay contract v1

Two relays implement this document: `server/relay.py` (local / self-host) and
`worker/src/index.js` (hosted, Cloudflare). They are interchangeable. The
frontend's `llmClient` relay mode takes a base URL and **must not be able to
tell which implementation is behind it**.

## Design rule: the relay is dumb

The relay does not know what tarot is, does not know what a prompt is, and does
not construct one. It receives a provider-native request body that the frontend
already assembled, forwards it verbatim, and streams the bytes back.

Consequences that are the point, not side effects:

- Editing a pack, the persona prompt, or a few-shot never requires a relay
  deploy. Locally it is a file save; hosted it is a Pages deploy.
- Adding a provider is a **config** change (see `PROVIDERS`), not a code change.
- The relay holds no session state, no key material, and no user data at rest.

## Endpoints

### `POST /v1/chat`

The only endpoint that talks to a provider. Used for both conversational turns
and structured judge calls — they differ only in the payload the frontend built.

**Request**

```
POST {relay_base}/v1/chat
Authorization: Bearer <user's provider API key>
Content-Type: application/json

{
  "provider": "anthropic",
  "payload": { ...provider-native request body, verbatim... }
}
```

- `provider` — a key into the relay's `PROVIDERS` config. Not a URL: the client
  cannot point the relay at an arbitrary host.
- `payload` — forwarded to the upstream **unread and unmodified**. Streaming is
  requested inside the payload (e.g. `"stream": true`), per the provider's own
  API. The relay does not inspect this field, so it has no opinion about it.

**Response**

The upstream's status code, `Content-Type`, and body, streamed through. For a
streaming payload that is `text/event-stream` in provider-native SSE format;
otherwise `application/json` in the provider's own shape. The frontend parses
provider-native responses — the relay adds no envelope.

Bytes must be forwarded as they arrive. Buffering the upstream response and
writing it in one go is a contract violation (see `test_stream_is_incremental`).

### `GET /v1/health`

```json
{ "ok": true, "providers": ["anthropic", "openai"] }
```

Used by the debug page and the contract suite. **No field may identify the
implementation** — no `"relay": "python"`, no version banner, no distinguishing
header. If a client could branch on which relay it is talking to, the contract
has failed.

### `OPTIONS` (any path)

CORS preflight. Responds with the matched allowed origin, `POST, GET, OPTIONS`,
and allowed request headers `Authorization, Content-Type`.

## Key handling (hard requirements, both relays)

The user's API key arrives in the `Authorization` header, is used once inside
the single request that carried it, and is then gone.

- **Never stored.** No session map, no global, no file, no database, no cache.
- **Never logged.** Redact by header name (`authorization`, `x-api-key`,
  `api-key`, `cookie`, and anything matching `/token|secret/i`) *and* by value —
  if the key string appears anywhere in a body or an upstream error, it is
  scrubbed before that string reaches an output stream.
- **Never echoed.** Error responses do not include request headers.
- No cross-request state of any kind, with one narrow exception: the Worker's
  per-IP rate-limit counters (coarse, TTL-bounded, no key material, no user
  content). The Python relay has no rate limiter and therefore no state at all.

The relay translates the incoming `Authorization: Bearer <key>` into whatever
auth header the upstream wants, per the provider's `auth` setting. The client
always sends a bearer token regardless of provider — another thing it must not
need to know.

## Provider config (`PROVIDERS`)

A JSON map supplied by the operator: `PROVIDERS` in `.env` for Python, a
`wrangler.toml` var for the Worker. Client-supplied provider names are looked up
here and nowhere else.

```json
{
  "anthropic": {
    "url": "https://api.anthropic.com/v1/messages",
    "auth": "x-api-key",
    "headers": { "anthropic-version": "2023-06-01" }
  },
  "openai": {
    "url": "https://api.openai.com/v1/chat/completions",
    "auth": "bearer"
  }
}
```

- `url` — full upstream URL, operator-controlled.
- `auth` — `"x-api-key"` (header `x-api-key: <key>`) or `"bearer"`
  (header `Authorization: Bearer <key>`).
- `headers` — optional static headers merged into the upstream request.

The contract suite registers a `test` provider pointing at a local mock upstream.
That is config, not a test-only code path.

## Errors

Relay-originated errors carry the header `X-Relay-Error: 1` and this body:

```json
{ "error": { "code": "missing_key", "message": "..." } }
```

| code | status | when |
|---|---|---|
| `origin_denied` | 403 | `Origin` present and not in `ALLOWED_ORIGINS` |
| `missing_key` | 401 | no `Authorization` header, or not a bearer token |
| `bad_request` | 400 | body is not JSON, or `provider`/`payload` missing |
| `unknown_provider` | 400 | `provider` is not a key in `PROVIDERS` |
| `rate_limited` | 429 | per-IP limit exceeded (Worker only; Python never emits it) |
| `upstream_unreachable` | 502 | the upstream connection failed |

Anything the upstream itself returns — including its 4xx/5xx — passes through
verbatim **without** `X-Relay-Error`. That header is the only way the client
distinguishes "the relay refused" from "the provider refused", and it is the
only response field either relay adds.

`message` is safe, static text. It never contains request headers, the key, or
the upstream body.

## Logging

Asymmetric on purpose.

- **Python:** `DEV_LOG=1` in `.env` (default off) logs full request and response
  bodies, with auth material redacted per the rules above. This is what M3 prompt
  iteration and consented playtest transcripts run on. A self-hoster logging
  their own conversations on their own machine is the intended use.
- **Worker:** no logging code path exists. Not a disabled one, not a commented
  one, not a `console.log` behind a flag. Hosted users' conversations are
  unloggable by construction, and `test_worker_has_no_logging_code` greps the
  source to keep it that way.

## Config

| var | Python | Worker | meaning |
|---|---|---|---|
| `PROVIDERS` | `.env` | `wrangler.toml` var | provider map above |
| `ALLOWED_ORIGINS` | `.env` | `wrangler.toml` var | comma-separated; `*` allows all (local dev default) |
| `DEV_LOG` | `.env` | — | `1` enables body logging; Python only |
| `PORT` | `.env` | — | default 8787 |
| `RATE_LIMIT` | — | `wrangler.toml` var | requests per IP per minute |

## Contract tests

`tests/contract/` is one suite run against a base URL, so both relays are
exercised by identical assertions. Stdlib `unittest`, no test dependencies:

```
RELAY_BASE=http://127.0.0.1:8788 python3 -m unittest discover -s tests/contract -t . -v
```

`scripts/run_contract_tests.sh` starts a mock provider and each relay in turn and
runs the suite against both. The Worker leg uses `wrangler` from PATH, else
`npx wrangler`; with neither available it skips loudly rather than passing one
relay and reporting two.

Both must pass:

- `test_health_shape` — `{ok, providers}` and nothing else
- `test_health_does_not_identify_the_implementation` — no "python", "worker",
  "cloudflare" or similar anywhere in the response
- `test_missing_key`, `test_unknown_provider`, `test_bad_request`,
  `test_origin_denied`, `test_upstream_unreachable` — status, code, and
  `X-Relay-Error: 1` on each
- `test_allowed_origin_passes` — an allowed `Origin` is not refused
- `test_payload_forwarded_verbatim` — the mock provider receives the payload unchanged
- `test_auth_translated_to_x_api_key` / `test_auth_translated_to_bearer` — the
  provider sees its own auth header, and never the client's `Authorization`
- `test_static_provider_headers_are_added` — a provider's static headers are merged in
- `test_upstream_error_passes_through` — an upstream 429 arrives as 429 with no
  `X-Relay-Error`
- `test_stream_is_incremental` — the first chunk arrives well before the last,
  so a token stream is not buffered into one late delivery
- `test_key_never_logged` — a canary key appears in no captured output
- `test_error_paths_never_leak_key` — the canary survives no error branch, in
  neither the response body nor the log
- `test_dev_log_still_captured_something` — guards the two above: an empty log
  would pass them vacuously
- `test_worker_has_no_logging_code` — the Worker source, comments stripped,
  contains no logging call at all

Worker-only:

- `test_rate_limited` — exceeding `RATE_LIMIT` yields 429 `rate_limited`
  (skipped for the Python relay, which has no limiter)
