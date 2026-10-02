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
 *     header) but the SPA posts the token in a body instead, and then opens a
 *     URL that carries no secret at all.
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
 * Redeem a one-time token with a POST, so it never appears in a URL.
 *
 * The request is deliberately a CORS-simple one: form-encoded body, no custom
 * headers, `mode: "no-cors"`. The SPA is served from a different origin than
 * the ephemeral tunnel, and dl_conn serves no CORS headers, so a readable
 * cross-origin response is not available — and it is not needed. What matters
 * is the side effect: a `Set-Cookie` on the response establishes the session,
 * and the opaque response still carries it. The next top-level navigation then
 * presents the session cookie, which is what actually opens the service.
 *
 * @returns {Promise<boolean>} true when the request completed without a
 *   network error. A false means the caller should fall back to navigating
 *   without a session — the daemon answers that with the login page, which is
 *   the same place an unauthenticated click already landed.
 */
export async function redeemToken(tunnelURL, token, redirectPath, fetchImpl) {
  if (!tunnelURL || !token) return false;
  const body = new URLSearchParams();
  body.set("token", token);
  if (redirectPath) body.set("redirect", redirectPath);

  try {
    await (fetchImpl || fetch)(tunnelURL.replace(/\/+$/, "") + "/auth", {
      method: "POST",
      mode: "no-cors",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    return true;
  } catch {
    // A tunnel that just rotated, a captive portal, an offline device: the
    // navigation that follows still works if a session already exists.
    return false;
  }
}

/**
 * Redeem the token, then open the service.
 *
 * open receives the credential-free URL, so no caller can reintroduce the
 * token by accident.
 */
export async function redeemAndOpen(tunnelURL, token, redirectPath, open, fetchImpl) {
  await redeemToken(tunnelURL, token, redirectPath, fetchImpl);
  open(serviceHref(tunnelURL, redirectPath));
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
