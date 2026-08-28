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
 * FILL THIS IN once the Cloudflare project exists. It is the Worker's URL with
 * no trailing slash and no path -- https://ai-tarot-relay.<subdomain>.workers.dev
 * on the workers.dev domain, or whatever custom domain the route uses.
 *
 * Until it is filled in, the Pages deployment falls back to same origin, where
 * there is no relay, and every call fails with a 404 the status bar reports.
 * That is the honest failure: the hosted demo does not work until this line and
 * ALLOWED_ORIGINS in worker/wrangler.toml agree about the two ends of the hop.
 */
export const HOSTED_RELAY_BASE = "";

/** Where .github/workflows/pages.yml publishes. A fork changes this line. */
export const PAGES_ORIGIN = "https://wyc79.github.io";

/**
 * @param {string} origin  location.origin of the page asking
 * @returns {string} relay base URL, or "" for same origin
 */
export function defaultRelayBase(origin) {
  return origin === PAGES_ORIGIN ? HOSTED_RELAY_BASE : "";
}
