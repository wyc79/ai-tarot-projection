/**
 * Where the relay is when nobody has said.
 *
 * The relay base is a user setting, and a stranger on a phone does not have a
 * Worker URL to paste. So the default is read off the page's own origin: the
 * deployment that served this file is the one that knows which relay stands
 * behind it.
 *
 * Two deployments, two answers:
 *
 *   served by server/relay.py  ->  "" , meaning same origin
 *   served by GitHub Pages     ->  the Worker
 *
 * Same-origin is the right local answer rather than a literal
 * http://localhost:8787, because the Python relay serves the page and the relay
 * from one origin whatever PORT says -- and because the phone that self-host
 * gets tested from reaches the laptop at its LAN address, where "localhost"
 * would be the phone.
 *
 * This module is the only place that knows a deployment exists. llmClient takes
 * a base URL and still cannot tell which relay is behind it; that is RELAY.md's
 * rule and nothing here weakens it.
 */

/**
 * The deployed Worker: its URL with no trailing slash and no path. Deployed
 * from /worker through Cloudflare's Git integration, so this only changes if
 * the Cloudflare project is renamed or moves behind a custom domain.
 *
 * This line and ALLOWED_ORIGINS in worker/wrangler.toml are the two ends of one
 * hop and have to agree -- the page points at the Worker, the Worker allows the
 * origin the page was served from. A fork changes both, and PAGES_ORIGIN below.
 */
export const HOSTED_RELAY_BASE = "https://ai-tarot-relay.yuanchen-wang79.workers.dev";

/** Where .github/workflows/pages.yml publishes. A fork changes this line. */
export const PAGES_ORIGIN = "https://wyc79.github.io";

/**
 * @param {string} origin  location.origin of the page asking
 * @returns {string} relay base URL, or "" for same origin
 */
export function defaultRelayBase(origin) {
  return origin === PAGES_ORIGIN ? HOSTED_RELAY_BASE : "";
}
