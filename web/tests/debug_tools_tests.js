/* debug_tools_tests.js — the silent "backend vanished" failure on strict
 * browsers (e.g. qutebrowser) gets debug tooling + dead-socket auto-recovery.
 *
 * No real relays/network: these are static assertions over app.js,
 * js/nostr_client.js, index.html and style.css, mirroring the other
 * web/tests/* files (which read the sources as text and grep for the
 * instrumentation they need to exist). */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log("  ✓ " + msg); }
  else { failed++; console.error("  ✗ FAIL: " + msg); }
}

const here = dirname(fileURLToPath(import.meta.url));
const appJs = readFileSync(join(here, '..', 'app.js'), 'utf8');
const clientJs = readFileSync(join(here, '..', 'js', 'nostr_client.js'), 'utf8');
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const css = readFileSync(join(here, '..', 'style.css'), 'utf8');

console.log("\n== NostrClient exposes a debug sink ==");

assert(/setDebugListener\s*\(/.test(clientJs), "NostrClient.setDebugListener exists");
assert(/_debug\s*\(/.test(clientJs), "NostrClient._debug helper exists");
assert(/getRelayDiagnostics\s*\(/.test(clientJs), "NostrClient.getRelayDiagnostics exists");
assert(/isAlive\s*\(/.test(clientJs), "NostrClient.isAlive exists");

console.log("\n== Relay connect surfaces spontaneous closes ==");

// The whole point is to notice when a relay socket dies silently (the
// qutebrowser symptom). connect() must attach onclose/onnotice hooks.
assert(/relay\.onclose\s*=/.test(clientJs), "connect() attaches relay.onclose");
assert(/relay\.onnotice\s*=/.test(clientJs), "connect() attaches relay.onnotice");
assert(/Relay fechou/.test(clientJs), "onclose logs the relay close");
assert(/connectedRelays\.delete\(url\)/.test(clientJs),
  "onclose prunes the dead relay from connectedRelays");
assert(/relayStates\.set\(url/.test(clientJs), "per-relay state is recorded");

console.log("\n== Publish reports per-relay outcome (no silent aggregate) ==");

assert(/targets\.length === 0/.test(clientJs),
  "sendDiscoverRequest warns when no relay is connected to publish");
assert(/publish.*Pedido aceito por/.test(clientJs), "per-relay publish-accepted is logged");
assert(/publish.*Relay rejeitou o pedido/.test(clientJs), "per-relay publish-rejected is logged");

console.log("\n== Subscription lifecycle is observable ==");

assert(/oneose:\s*\(\s*\)\s*=>/.test(clientJs), "subscription oneose (backscroll done) is hooked");
assert(/onclose:\s*\(reasons\)/.test(clientJs), "subscription onclose is hooked");
assert(/DM ignorado/.test(clientJs), "ignored (wrong-author) DM is logged");
assert(/Resposta do host decriptada/.test(clientJs), "successful host reply is logged");
assert(/Falha ao decriptar DM do host/.test(clientJs), "decryption failure is logged");

console.log("\n== Debug console wired into the SPA ==");

assert(/function pushDebug\(/.test(appJs), "pushDebug exists");
assert(/function renderDebug\(/.test(appJs), "renderDebug exists");
assert(/function onToggleDebug\(/.test(appJs), "onToggleDebug exists");
assert(/function onClearDebug\(/.test(appJs), "onClearDebug exists");
assert(/function logIdentity\(/.test(appJs), "logIdentity exists");
assert(/setDebugListener\(pushDebug\)/.test(appJs),
  "startNostr routes client diagnostics through pushDebug");
assert(/function reconnectNostr\(/.test(appJs), "reconnectNostr (hard reconnect) exists");
assert(/function runDiagnostics\(/.test(appJs), "runDiagnostics self-test exists");
assert(/function startNostrWatchdog\(/.test(appJs), "startNostrWatchdog (dead-socket detector) exists");
assert(/Todos os relays desconectados sem aviso/.test(appJs),
  "watchdog logs the all-relays-dead transition");
assert(/reconnectNostr\(\);/.test(appJs), "watchdog triggers an auto-reconnect on death");
assert(/debugWatchdog/.test(appJs), "watchdog timer is tracked");

console.log("\n== UI scaffolding for the console ==");

assert(/id="btn-toggle-debug"/.test(html), "header has a debug toggle button");
assert(/id="debug-section"/.test(html), "debug-section card exists");
assert(/id="debug-log"/.test(html), "debug-log container exists");
assert(/id="btn-run-diagnostics"/.test(html), "run-diagnostics button exists");
assert(/id="btn-clear-debug"/.test(html), "clear-debug button exists");
assert(/el\.btnToggleDebug\.addEventListener\("click",\s*onToggleDebug\)/.test(appJs),
  "toggle button is bound");
assert(/el\.btnRunDiagnostics\.addEventListener\("click",\s*runDiagnostics\)/.test(appJs),
  "diagnostics button is bound");
assert(/el\.btnClearDebug\.addEventListener\("click",\s*onClearDebug\)/.test(appJs),
  "clear button is bound");

console.log("\n== Styling follows the token system (no inline, no gradient) ==");

assert(/debug-log/.test(css), "style.css themes .debug-log");
assert(/debug-row/.test(css), "style.css themes .debug-row");
assert(/debug-error\s+\.debug-msg/.test(css), "error rows are color-coded");
assert(/debug-ok\s+\.debug-msg/.test(css), "ok rows are color-coded");
assert(/debug-warn\s+\.debug-msg/.test(css), "warn rows are color-coded");
assert(!/gradient/.test(css.split(".debug-")[1] || ""),
  "debug styling uses no gradient (token-compliant)");

console.log("\n=== Results: " + passed + " passed, " + failed + " failed ===");
if (failed > 0) process.exit(1);
