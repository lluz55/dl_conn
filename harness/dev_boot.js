/* dev/dev_boot.js — boots the real SPA against fake data.
 *
 * Three jobs, in this order:
 *   1. Install the telemetry fixture *before* app.js exists, so the SPA's own
 *      fetch path is what runs.
 *   2. Fill the document body from index.html, so the harness can never drift
 *      from the markup it is meant to be testing.
 *   3. Patch the session and Nostr classes, then import app.js and unlock.
 *
 * The patches replace methods on the real classes rather than swapping the
 * modules, because the page CSP forbids the inline <script type="importmap">
 * an import-map approach needs. No production file is modified, and nothing
 * here is reachable from the daemon unless it was started with --dev-mock-auth.
 */

import { installMockFetch } from './mock_fetch.js';
import { patchSessionManager } from './mock_session.js';
import { patchNostrClient } from './mock_nostr.js';
import { SessionManager } from '../js/session_manager.js';
import { NostrClient } from '../js/nostr_client.js';

const DEV_BANNER_CLASS = "harness-banner";

function fail(message, detail) {
  console.error("[dev harness] " + message, detail || "");
  const box = document.createElement("pre");
  box.className = "harness-error";
  box.textContent = "Harness não iniciou: " + message + (detail ? "\n\n" + detail : "");
  document.body.replaceChildren(box);
}

/** A banner that cannot be mistaken for the real interface. */
function showBanner() {
  const bar = document.createElement("div");
  bar.className = DEV_BANNER_CLASS;
  bar.setAttribute("role", "note");
  bar.append(
    "HARNESS — sessão, host Nostr e telemetria simulados. ",
    "Nenhuma credencial real envolvida; nenhuma rota real liberada."
  );
  document.body.prepend(bar);
}

async function loadIndexMarkup() {
  // Absolute: this module is served from /dev/, so "./index.html" would
  // resolve to /dev/index.html — the harness page itself.
const res = await fetch("/index.html", { credentials: "same-origin" });
  if (!res.ok) throw new Error("GET ./index.html → " + res.status);
  const html = await res.text();
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const body = parsed.body;
  if (!body || !body.querySelector("#app")) {
    throw new Error("index.html não contém #app — a estrutura mudou?");
  }
  // Keep the <html> attributes the page needs (data-palette/data-theme) from
  // index.html, so a palette saved in localStorage is not fought over here.
  for (const attr of ["data-palette", "data-theme", "data-density"]) {
    const v = parsed.documentElement.getAttribute(attr);
    if (v) document.documentElement.setAttribute(attr, v);
  }
  document.body.replaceChildren(...Array.from(body.childNodes));

  // index.html's own <script src="./app.js"> comes along with the body, and
  // from /dev/ it would resolve to /dev/app.js — a 404. Strip it: this module
  // imports app.js itself, below, after the patches are in place. Leaving a
  // second entry point in the page is how you end up with two controllers
  // fighting over the same DOM.
  for (const script of document.querySelectorAll('script[src*="app.js"]')) {
    script.remove();
  }
}

/**
 * app.js boots on DOMContentLoaded. The markup fetch above is async, so by
 * the time we import app.js the event has usually already fired and its
 * listener would never run — re-fire it, once, only when needed.
 */
async function bootApp() {
  // Patch before app.js constructs anything — it is a single IIFE that runs
  // its own init on DOMContentLoaded, so there is no later hook.
  patchSessionManager(SessionManager);
  patchNostrClient(NostrClient);

  const alreadyReady = document.readyState !== "loading";
  await import("../app.js");
  if (alreadyReady) window.dispatchEvent(new Event("DOMContentLoaded"));
}

/** Fill the PIN and press Desbloquear, once the real unlock UI is showing.
 *
 *  Returns false until the click can actually land, and the caller keeps
 *  polling.
 *
 *  The gate is `#unlock-ui` being *visible*, not the existence of
 *  `#pin-input`. Both the input and the button are in the static markup from
 *  the moment the body is injected, so an existence check is true ~50ms in —
 *  long before app.js has bound their handlers. The click then hit a dead
 *  button, and since the check reported success the retry loop stopped, which
 *  left the harness sitting on the PIN screen forever. That was intermittent
 *  and looked like the harness simply not working.
 *
 *  `showUnlockScreen()` runs after `bindEvents()` and is what removes the
 *  `hidden` class, so visibility is the first moment a click is real.
 */
function autoUnlock() {
  const panel = document.getElementById("unlock-ui");
  const input = document.getElementById("pin-input");
  const button = document.getElementById("btn-unlock-pin");
  if (!panel || !input || !button) return false;
  if (panel.classList.contains("hidden")) return false;
  input.value = "0000";
  button.click();
  return true;
}

async function main() {
  installMockFetch();
  await loadIndexMarkup();
  showBanner();
  await bootApp();

  // The unlock panel is unhidden by app.js's own init, which runs after the
  // config fetch and bindEvents(). Poll generously: a slow first load used to
  // exhaust a 3s budget on a cold cache, which looked like a broken harness.
  const UNLOCK_BUDGET_MS = 15000;
  const started = Date.now();
  const timer = setInterval(() => {
    if (autoUnlock()) {
      clearInterval(timer);
      return;
    }
    if (Date.now() - started > UNLOCK_BUDGET_MS) {
      clearInterval(timer);
      // Say so instead of leaving a PIN screen with no explanation — the
      // harness is supposed to be the low-friction path.
      console.error(
        "[dev harness] a tela de desbloqueio não apareceu em " + UNLOCK_BUDGET_MS +
        "ms; o app pode não ter inicializado. Confira o console do navegador."
      );
    }
  }, 50);
}

main().catch((err) => fail(err.message, err.stack));
