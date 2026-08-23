/**
 * Hosted relay. Implements RELAY.md, identically to server/relay.py.
 *
 * There is no logging in this file. Not a disabled flag, not a commented-out
 * console.log -- none, so that a hosted user's conversation cannot be recorded
 * here even by an operator who wants to. tests/contract/test_worker_source.py
 * greps this file to keep that true.
 *
 * The key arrives in the Authorization header, is used inside a single fetch,
 * and goes out of scope. Nothing is written to storage, and there is no
 * cross-request state except the coarse per-IP rate-limit counters below.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

// Per-isolate, TTL-bounded, holds no key material and no user content. Cloudflare
// may run several isolates, so this is a blunt instrument against open-relay
// abuse, not an exact quota.
const hits = new Map();

function corsFor(request, origins) {
  const origin = request.headers.get("Origin");
  const allowed = origins.includes("*") ? "*" : origin || "";
  return { ...CORS_HEADERS, "Access-Control-Allow-Origin": allowed };
}

function relayError(status, code, message, cors) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "X-Relay-Error": "1" },
  });
}

function rateLimited(ip, limit) {
  const now = Date.now();
  const window = Math.floor(now / 60000);
  for (const [k, v] of hits) if (v.window < window) hits.delete(k);
  const entry = hits.get(ip);
  if (!entry || entry.window < window) {
    hits.set(ip, { window, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

export default {
  async fetch(request, env) {
    const providers = JSON.parse(env.PROVIDERS || "{}");
    const origins = (env.ALLOWED_ORIGINS || "*").split(",").map((o) => o.trim());
    const limit = parseInt(env.RATE_LIMIT || "30", 10);
    const cors = corsFor(request, origins);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const origin = request.headers.get("Origin");
    if (origin && !origins.includes("*") && !origins.includes(origin)) {
      return relayError(403, "origin_denied", "origin not allowed", cors);
    }

    const path = new URL(request.url).pathname;

    if (request.method === "GET") {
      if (path === "/v1/health") {
        // Shape must match the Python relay exactly, and must not say which
        // implementation answered.
        return new Response(
          JSON.stringify({ ok: true, providers: Object.keys(providers).sort() }),
          { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
      return relayError(404, "bad_request", "no such endpoint", cors);
    }

    if (request.method !== "POST" || path !== "/v1/chat") {
      return relayError(404, "bad_request", "no such endpoint", cors);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (rateLimited(ip, limit)) {
      return relayError(429, "rate_limited", "too many requests", cors);
    }

    const auth = request.headers.get("Authorization") || "";
    const key = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    if (!key) {
      return relayError(401, "missing_key", "missing bearer token", cors);
    }

    let provider, payload;
    try {
      const body = await request.json();
      payload = body.payload;
      provider = providers[body.provider];
      if (!payload || typeof body.provider !== "string") {
        return relayError(400, "bad_request", "expected JSON {provider, payload}", cors);
      }
    } catch {
      return relayError(400, "bad_request", "expected JSON {provider, payload}", cors);
    }
    if (!provider) {
      return relayError(400, "unknown_provider", "provider not configured", cors);
    }

    const headers = { "Content-Type": "application/json", ...(provider.headers || {}) };
    if (provider.auth === "bearer") headers["Authorization"] = `Bearer ${key}`;
    else headers["x-api-key"] = key;

    let upstream;
    try {
      upstream = await fetch(provider.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
    } catch {
      // The reason is deliberately not surfaced: it can quote the request.
      return relayError(502, "upstream_unreachable", "could not reach provider", cors);
    }

    // Body streams straight through, provider status and content type intact,
    // and without X-Relay-Error -- an upstream refusal is not a relay refusal.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...cors,
        "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      },
    });
  },
};
