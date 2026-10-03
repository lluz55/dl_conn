/* dev/mock_fetch.js — fetch interceptor for the local UI harness.
 *
 * Installed by dev.html *before* app.js runs, so the SPA's own
 * fetchTelemetry() / fetchHistory() code is the code that executes — only the
 * bytes on the wire are synthetic.
 *
 * It answers two routes:
 *   /api/host/telemetry             → one snapshot (the live poll)
 *   /api/host/telemetry?from=&to=   → an array (the history range), bucketed
 *                                       down to ?points= the way the daemon does
 *
 * That mirrors the daemon's real contract exactly, including the shape the
 * frontend branches on: no query params means an object, query params mean an
 * array. Anything else is passed through untouched, so a route the harness
 * does not know about still hits the real daemon and fails honestly rather
 * than silently returning something plausible.
 */

import { mockHistory, mockSnapshot } from './mock_data.js';

const TELEMETRY_PATH = "/api/host/telemetry";

/** A Response-alike is enough: the SPA only calls .ok, .status and .json(). */
function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

export function installMockFetch() {
  const real = window.fetch.bind(window);
  let calls = 0;

  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (!url.startsWith(TELEMETRY_PATH)) return real(input, init);

    calls++;
    const query = url.slice(TELEMETRY_PATH.length);
    const params = new URLSearchParams(query.replace(/^\?/, ""));
    const from = params.get("from");
    const to = params.get("to");

    // No bounds: the live poll contract — a single snapshot object.
    if (from == null && to == null) {
      return Promise.resolve(jsonResponse(mockSnapshot()));
    }

    // A malformed bound must 400, the way the daemon does, so the frontend's
    // error branch is reachable in the harness instead of being untested.
    const fromTs = from == null ? null : Number(from);
    const toTs = to == null ? null : Number(to);
    if ((from != null && !Number.isFinite(fromTs)) || (to != null && !Number.isFinite(toTs))) {
      return Promise.resolve(jsonResponse({ error: "invalid timestamp" }, 400));
    }
    const points = params.get("points");

    const span = (toTs ?? Date.now() / 1000) - (fromTs ?? Date.now() / 1000 - 3600);
    // The daemon buckets a window down to the requested number of points
    // (capped server-side); the harness honours ?points= so the frontend is
    // exercised against the same bounded shape it gets in production.
    const wanted = points == null ? Infinity : Number(points);
    if (points != null && !Number.isFinite(wanted)) {
      return Promise.resolve(jsonResponse({ error: "invalid points" }, 400));
    }
    const count = Math.max(2, Math.min(400, Math.round(span / 60), wanted));
    return Promise.resolve(jsonResponse(mockHistory(count, span)));
  };

  // Surfaced in the page title so a harness tab is unmistakable when a dev
  // has several open — and so a screenshot pasted into an issue says so.
  document.title = "dl_conn · HARNESS (dados simulados)";
  console.info(
    "%c[dev harness]%c telemetria simulada em " + TELEMETRY_PATH +
    " · sessão e host Nostr falsos · nenhuma credencial real envolvida",
    "background:#d2691e;color:#fff;border-radius:3px;padding:1px 4px",
    "color:inherit"
  );
  return () => {
    window.fetch = real;
    document.title = "DL-CONN";
  };
}
