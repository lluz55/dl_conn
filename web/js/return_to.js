/* return_to.js — where the browser was headed when the tunnel bounced it here.
 *
 * An expired session or a spent one-time token used to answer a clicked
 * service link with a raw 403/401. The daemon now answers a *navigation*
 * with a redirect to this SPA carrying `?next=<path>` (see
 * internal/auth/login_redirect.go); this module is the SPA's half of that
 * handshake: remember the destination across the login/unlock flow, and turn
 * it back into a fresh /auth link once discovery hands over a new token.
 */

/** Query parameter the daemon sets; must match auth.NextParam in Go. */
export const NEXT_PARAM = "next";

/**
 * Survives a reload (onClearAll reloads the page, and an unlock flow may
 * bounce through one) but not a new tab, which is the right lifetime: the
 * destination belongs to this tab's trip, not to the device.
 */
const STORAGE_KEY = "dl_conn_return_to";

/**
 * Reduce a destination to a same-origin path, or null.
 *
 * This mirrors auth.SafeRedirect in Go and exists for the same reason: the
 * value ends up in an `href` the user clicks, and `?next=` is attacker-
 * reachable (anyone can send a link to the tunnel with any `next`). The
 * dangerous shapes are the ones a browser resolves against a *different*
 * origin while still looking path-like — "//evil.com", "/\evil.com" — plus
 * absolute URLs and scheme-only values like "javascript:".
 *
 * The daemon already sanitizes what it puts in `next`, but the SPA is also
 * served from GitHub Pages where nothing upstream has vetted the query
 * string, so it has to hold on its own.
 */
export function sanitizeNext(next) {
  if (typeof next !== "string" || next === "" || !next.startsWith("/")) return null;
  // Browsers normalize backslashes to "/", so "/\evil.com" is
  // protocol-relative in practice. Reject before parsing rather than
  // enumerating spellings.
  if (next.includes("\\")) return null;
  let url;
  try {
    // A base is required for relative input; a value carrying its own
    // origin keeps it and is caught by the origin check below.
    url = new URL(next, "https://dl-conn.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://dl-conn.invalid") return null;
  if (!url.pathname.startsWith("/")) return null;
  const path = url.pathname + url.search + url.hash;
  // "/" is the SPA itself: a valid path, but nothing to return *to*.
  return path === "/" ? null : path;
}

/**
 * Read `?next=` from a URL (defaults to the current location) and remember
 * it, then return it. Called once at startup, before the login flow can
 * navigate anywhere.
 */
export function captureReturnTo(href, storage) {
  const store = storage || safeSessionStorage();
  let params;
  try {
    params = new URL(href || globalThis.location.href).searchParams;
  } catch {
    return readReturnTo(store);
  }
  const next = sanitizeNext(params.get(NEXT_PARAM));
  if (next && store) {
    try { store.setItem(STORAGE_KEY, next); } catch { /* private mode */ }
  }
  return next || readReturnTo(store);
}

/** The remembered destination, or null. */
export function readReturnTo(storage) {
  const store = storage || safeSessionStorage();
  if (!store) return null;
  try {
    return sanitizeNext(store.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Forget the destination — once the trip is resumed, it must not repeat. */
export function clearReturnTo(storage) {
  const store = storage || safeSessionStorage();
  if (!store) return;
  try { store.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/**
 * Build the link that finishes the trip: a fresh one-time token plus the
 * remembered destination, which is exactly the shape of a service card's
 * link. Returns null when any piece is missing, so callers can't produce a
 * half-formed URL that would fail at the daemon.
 *
 * Deprecated for new code: this puts the token in a URL, which is the thing
 * the POST redemption in api_client.js exists to avoid. It is kept because the
 * daemon still accepts the GET form (with a Sunset header) and because it is
 * the fallback for a click the SPA could not intercept — a middle-click, or a
 * browser with the module's script blocked. New call sites should redeem with
 * redeemToken() and navigate to resumeTarget() instead.
 */
export function buildResumeURL(tunnelURL, authToken, next) {
  const target = sanitizeNext(next);
  if (!tunnelURL || !authToken || !target) return null;
  return (
    tunnelURL.replace(/\/+$/, "") +
    "/auth?token=" + encodeURIComponent(authToken) +
    "&redirect=" + encodeURIComponent(target)
  );
}

/**
 * The destination of a resumed trip, with no credential in it.
 *
 * This is what a caller navigates to *after* redeeming the token, and what a
 * banner link can safely expose. Returns null for a destination sanitizeNext
 * rejects, so a crafted `next` cannot turn the resume flow into a navigation
 * off-origin.
 */
export function resumeTarget(next) {
  return sanitizeNext(next);
}

/**
 * A human-readable name for the destination, for the "returning to X"
 * message. Matches against the discovered services by prefix so the user
 * reads "Frigate" rather than "/frigate/".
 */
export function describeTarget(next, services) {
  const target = sanitizeNext(next);
  if (!target) return null;
  const list = Array.isArray(services) ? services : [];
  let best = null;
  for (const svc of list) {
    const prefix = svc && svc.prefix;
    if (!prefix || !target.startsWith(prefix)) continue;
    // Longest prefix wins: "/frigate" and "/frigate/api" could both match.
    if (!best || prefix.length > best.prefix.length) best = { prefix, svc };
  }
  if (best) return best.svc.name || best.svc.id || target;
  return target;
}

function safeSessionStorage() {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    // Storage access can throw outright under strict privacy settings.
    return null;
  }
}
