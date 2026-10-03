/**
 * api_client.js — the SPA's half of dl_conn's HTTP auth surface.
 *
 * Two things live here, both of them about *how* a credential travels rather
 * than about what it authorizes:
 *
 *  1. Token redemption. A one-time token used to be handed to the daemon in a
 *     query string, which put it in the browser's history, in cloudflared's
 *     and the backend's access logs, and in the Referer of whatever the
 *     landing page loaded. The daemon still accepts that form (with a Sunset
 *     header) but the SPA's own redemption path does neither: it submits a
 *     hidden <form method="POST"> whose body carries the token, and the
 *     daemon answers 303 to the destination — a top-level navigation, so
 *     the Set-Cookie on that response lands in a first-party context and
 *     travels with the redirect to the service. That first-party property
 *     is the whole reason this is a form submission and not a fetch():
 *     modern Chrome blocks the cross-origin Set-Cookie from a fetch() when
 *     the SPA is hosted on a different origin than the tunnel (e.g. GitHub
 *     Pages), which is what made a click on a service card bounce the user
 *     back to the login page after a successful login. The URL the browser
 *     ends up on still carries no credential at all.
 *
 *  2. Step-up proofs. Endpoints the operator marks as sensitive want a
 *     short-lived proof in addition to the session (see
 *     docs/okf/concepts/security.md). The proof lives in memory only — it is
 *     bound to one session and dies with it, so persisting it would only
 *     widen the window it is meant to narrow.
 *
 * Neither helper throws: every failure resolves to a value the caller can
 * degrade from, because both run on the path that opens a service and a
 * thrown error there is a dead end for the user.
 */

/** Daemon path that mints a step-up proof for the current session. */
export const STEP_UP_PATH = "/api/auth/stepup";

/** Request header carrying a step-up proof. */
export const STEP_UP_HEADER = "X-Dl-Conn-StepUp";

/** How long a proof is treated as usable client-side.
 *
 *  Matches the daemon's 5-minute window, minus a margin: sending a proof the
 *  server considers expired produces a 401 that looks like a broken feature,
 *  while a client that refreshes slightly early costs one extra round trip. */
export const STEP_UP_TTL_MS = 4 * 60 * 1000;

/**
 * Destination for a service, with no credential in it.
 *
 * The token is not part of this URL by design. Once it has been redeemed, the
 * session cookie is what authorizes the request, and a link that can be
 * bookmarked, shared, middle-clicked or opened in a new tab should not be
 * carrying a one-time secret that the recipient cannot use anyway.
 */
export function serviceHref(tunnelURL, redirectPath) {
  if (!tunnelURL) return redirectPath || "/";
  return tunnelURL.replace(/\/+$/, "") + (redirectPath || "/");
}

/**
 * Redeem a one-time token by submitting a hidden <form method="POST"> to
 * /auth, so the token never appears in a URL and the Set-Cookie on the
 * response lands in a first-party context.
 *
 * The form is submitted programmatically: that is a top-level navigation,
 * the same way a clicked link is, so the browser navigates this tab (or the
 * new tab named by `target`) to the daemon, the response carries a
 * Set-Cookie that establishes the session, and a 303 follows to the
 * destination. The token stays in the form body — not in the action URL —
 * so it never reaches browser history, cloudflared's access log, or the
 * Referer of whatever the landing page loads.
 *
 * A fetch() with `mode: "no-cors"` was the previous shape of this helper,
 * and it works when the SPA and the tunnel live on the same origin (the
 * daemon-served copy of the SPA). It breaks when they don't, because
 * modern Chrome blocks the cross-origin Set-Cookie from a fetch(): the
 * fetch() is a sub-resource request, the response lands in the third-party
 * cookie bucket, and the next navigation to the service has no session —
 * the symptom was a click on a service card bouncing back to the login
 * page right after a successful login. The form submission is a real
 * navigation, so the destination origin becomes first-party for cookie
 * purposes and the Set-Cookie sticks.
 *
 * @param {string} tunnelURL   tunnel origin (e.g. "https://x.trycloudflare.com")
 * @param {string} token        one-time token to redeem
 * @param {string} redirectPath same-origin destination (e.g. "/hass/")
 * @param {string} [target]     form target; "_blank" opens a new tab,
 *                              anything else (or omitted) navigates the
 *                              current tab.
 * @returns {boolean} true when the form was submitted; false when no token
 *   or no tunnelURL was supplied, so a caller can early-out without
 *   triggering a navigation that has nothing to do.
 */
export function redeemToken(tunnelURL, token, redirectPath, target) {
  if (!tunnelURL || !token) return false;
  const form = document.createElement("form");
  form.method = "POST";
  form.action = tunnelURL.replace(/\/+$/, "") + "/auth";
  // Submission happens before the user could see it, but display:none keeps
  // the brief flicker away too — same as the rest of the SPA.
  form.style.display = "none";
  if (target) form.target = target;

  const tokenInput = document.createElement("input");
  tokenInput.type = "hidden";
  tokenInput.name = "token";
  tokenInput.value = token;
  form.appendChild(tokenInput);

  if (redirectPath) {
    const redirectInput = document.createElement("input");
    redirectInput.type = "hidden";
    redirectInput.name = "redirect";
    redirectInput.value = redirectPath;
    form.appendChild(redirectInput);
  }

  document.body.appendChild(form);
  // form.submit() initiates the navigation synchronously; the form is then
  // attached to a discarded document. Leaving it in place is safe and avoids
  // racing the navigation in browsers that tear down the document on submit.
  form.submit();
  return true;
}

/**
 * Redeem the token by submitting the form, opening the service in a new
 * tab (when `target === "_blank"`) or in the current tab (default).
 *
 * The form submission is itself the navigation, so the caller does not
 * need to follow up with window.open / window.location.assign — the
 * browser navigates to /auth, the daemon answers 303 to the destination,
 * and the browser follows the redirect. `redirectPath` is for the daemon
 * only; it never reaches the URL the browser ends up on.
 *
 * Kept as a separate function for symmetry with the old fetch-based
 * redeemAndOpen — it exists so callers that want a new tab can write
 * `redeemAndOpen(tunnel, token, "/hass/", "_blank")` and callers that
 * want the same tab can write `redeemAndOpen(tunnel, token, "/hass/")`,
 * without having to know that the implementation is a form submit.
 */
export function redeemAndOpen(tunnelURL, token, redirectPath, target) {
  return redeemToken(tunnelURL, token, redirectPath, target);
}

/**
 * In-memory holder for the current step-up proof.
 *
 * A module-level singleton rather than a field on SessionManager: the proof is
 * a per-request credential, not session state, and it must never reach
 * localStorage — unlike the vault key, there is nothing here worth surviving a
 * reload, and something worth surviving a reload is something worth stealing.
 */
let stepUpValue = null;
let stepUpExpiresAt = 0;

/** Returns the proof to attach to a sensitive request, or null. */
export function getStepUpHeader() {
  if (!stepUpValue) return null;
  if (Date.now() >= stepUpExpiresAt) {
    stepUpValue = null;
    return null;
  }
  return { [STEP_UP_HEADER]: stepUpValue };
}

/** Forgets the proof — on lock, on logout, on identity change. */
export function clearStepUp() {
  stepUpValue = null;
  stepUpExpiresAt = 0;
}

/**
 * Fetches a fresh proof from the daemon and remembers it until it is close to
 * expiring.
 *
 * @param {string} tunnelURL tunnel origin
 * @param {typeof fetch} [fetchImpl] injected in tests
 * @returns {Promise<string|null>} the proof, or null when the endpoint is not
 *   enabled, refused, or unreachable — all of which mean "send no proof", and
 *   the daemon then answers exactly as it did before step-up existed.
 */
export async function requestStepUp(tunnelURL, fetchImpl) {
  if (!tunnelURL) return null;
  const doFetch = fetchImpl || fetch;
  try {
    const response = await doFetch(
      tunnelURL.replace(/\/+$/, "") + STEP_UP_PATH,
      { method: "POST", mode: "no-cors", credentials: "include" }
    );
    if (!response || response.status === 404) return null;
    const payload = await response.json();
    if (!payload || !payload.value) return null;
    stepUpValue = payload.value;
    const ttl = Number(payload.ttlSec) > 0 ? Number(payload.ttlSec) : STEP_UP_TTL_MS / 1000;
    stepUpExpiresAt = Date.now() + ttl * 1000 - STEP_UP_MARGIN_MS;
    return stepUpValue;
  } catch {
    return null;
  }
}

/** Safety margin subtracted from the server's TTL when caching the proof. */
const STEP_UP_MARGIN_MS = 30 * 1000;
