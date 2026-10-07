/* layout_tests.js — structural guards for responsive spacing/layout */

import fs from "node:fs";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log("  ✓ " + message);
  } else {
    failed++;
    console.error("  ✗ FAIL: " + message);
  }
}

const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

console.log("\n=== Layout Tests ===");

assert(
  /#session-setup\s*\{[^}]*padding:\s*var\(--gap-(?:md|lg)\)/s.test(css),
  "The zero-padding session card restores an internal inset on its setup side",
);
assert(
  /#(?:unlock-ui|login-ui)[\s\S]*?display:\s*flex;[\s\S]*?gap:\s*var\(--gap-md\)/.test(css),
  "Session setup states define vertical spacing between their components",
);
assert(
  /@media\s*\(max-width:\s*639px\)[\s\S]*?\.pin-input-group:not\(\.pin-input-group--stack\)[\s\S]*?flex-direction:\s*column/.test(css),
  "PIN controls stack on compact screens",
);
assert(
  /@media\s*\(max-width:\s*639px\)[\s\S]*?\.relay-add-row[\s\S]*?flex-direction:\s*column/.test(css),
  "Relay add controls stack on compact screens",
);
assert(
  /grid-template-columns:\s*10px\s+minmax\(0,\s*1fr\)\s+48px\s+40px\s+40px/.test(css),
  "Compact relay rows reserve space without overflowing, and keep the sparkline when the number is hidden",
);
assert(
  /function serviceIcon\(icon, dotHtml\)/.test(app) && /\.service-icon \.svc-dot \{/.test(css),
  "Service health indicator renders as an icon-corner badge, matching the approved prototype",
);
assert(
  /li\.className = "service-overview-item"/.test(app) && /class="services-overview-list"/.test(html),
  "Services render as rows in the Visão geral list",
);
assert(
  !/service-card|services-grid/.test(app) && !/service-card|services-grid/.test(html),
  "The duplicate grid rendering of the services is gone from app.js and index.html",
);
assert(
  !/\.service-card|\.services-grid/.test(css),
  "The CSS for the removed services grid is gone too",
);
assert(
  /id="services-overview"[\s\S]*?id="btn-toggle-custom-service"[\s\S]*?id="btn-refresh-services"[\s\S]*?id="btn-clear-services"/.test(html) &&
    /id="services-health"/.test(html) &&
    /id="custom-service-form"/.test(html),
  "The services list block still owns the add / refresh / clear controls, the health strip and the custom-service form",
);
assert(
  /DOMContentLoaded",\s*async[\s\S]*?await init\(\)[\s\S]*?showApp\(\)/.test(app),
  "The loading overlay remains until initialization reaches a stable state",
);
assert(
  /\.qr-overlay-inner\s*\{[^}]*max-height:[^}]*overflow-y:\s*auto/s.test(css),
  "The QR dialog remains scrollable in short viewports",
);
assert(
  /\.relay-summary\s*\{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/s.test(css),
  "Long relay summaries wrap on compact screens",
);
assert(
  /relay-url-text/.test(app) && /\.relay-url-text\s*\{[^}]*text-overflow:\s*ellipsis/s.test(css),
  "Relay URL ellipsis no longer clips the NIP-11 tooltip",
);
assert(
  /id="relay-panel" class="card"/.test(html) && /id="btn-toggle-relays"[^>]*aria-expanded="true"/.test(html),
  "Relay configuration is visible by default during setup",
);
assert(
  /id="vault-state-pill" class="pill p-warn"/.test(html),
  "Locked/logged-out session card shows a state pill like the approved prototype",
);
assert(
  /id="session-pending-icon"/.test(html) &&
    /id="session-discovery-note"/.test(html) &&
    /id="session-nip44-pill"/.test(html),
  "Pending session state has a dedicated discovery composition (relay icon, note, NIP-44 pill)",
);
assert(
  /function setSessionPendingVisual\(isPending\)/.test(app) &&
    /setSessionPendingVisual\(true\)/.test(app) &&
    /setSessionPendingVisual\(false\)/.test(app),
  "Pending visual is toggled on both entry (unlocked/pending) and exit (active/locked/wiped)",
);
assert(
  /function setVaultStatePill\(text, variant, dotClass\)/.test(app),
  "Locked/logged-out screens mirror their state onto a KPI-style pill",
);
assert(
  /\.kpi-card\s*\{[^}]*padding-inline-start:\s*calc\(var\(--gap-md\)\s*\+\s*3px\)/s.test(css),
  "KPI card text keeps an even gap from the 3px tone bar instead of sitting closer to it than the other edges",
);
assert(
  /\.kpi-grid\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s.test(css),
  "The overview presents KPI cards as a vertical list instead of a grid",
);
assert(
  /\.kpi-card::before\s*\{[^}]*inset-inline-start:\s*0/s.test(css) &&
    !/^\s*inline-start\s*:/m.test(css),
  "The KPI tone bar is pinned to the card edge with the real property (inset-inline-start), not the non-existent `inline-start`, which leaves it on top of the text",
);
assert(
  /\.kpi-value\s*\{[^}]*white-space:\s*nowrap;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s.test(css),
  "A long KPI value (e.g. the tunnel URL) is clipped to one line instead of widening the overview list",
);
assert(
  /function setTunnelStatus\(text\)/.test(app) &&
    /el\.tunnelStatus\.setAttribute\("title", text\)/.test(app),
  "The full tunnel status text stays reachable via title when the KPI value is clipped",
);
assert(
  /function focusPinInput\(\)/.test(app) &&
    /el\.pinInput\.focus\(\)/.test(app) &&
    /el\.pinInput\.select\(\)/.test(app) &&
    /function showUnlockScreen\(\)[\s\S]*?focusPinInput\(\)/.test(app),
  "The saved-PIN unlock screen focuses and selects the PIN input for immediate typing",
);

// ── Collapsible relay card ──────────────────────────────────────────
console.log("  [Collapsible relay card]");
assert(
  /<button id="btn-collapse-relays"[^>]*aria-expanded="true"[^>]*aria-controls="relay-panel-body"/.test(html),
  "The relay card head carries a disclosure button wired to the body it controls",
);
assert(
  /<div id="relay-panel-body" class="card-body">[\s\S]*?id="relay-list"[\s\S]*?id="btn-reset-relays"[\s\S]*?<\/div>\s*<\/section>/.test(html),
  "Collapsing hides the list and the add/reset controls, but not the card head",
);
assert(
  /id="relay-summary"[\s\S]*?id="btn-collapse-relays"/.test(html),
  "The relay summary pill stays in the head, so it remains readable while collapsed",
);
assert(
  /function applyRelayCollapse\(collapsed\)/.test(app) &&
    /el\.relayPanelBody\.classList\.toggle\("hidden", collapsed\)/.test(app),
  "The collapse toggles the body only, leaving the card itself visible",
);
assert(
  /function applyRelayCollapse\(collapsed\)[\s\S]*?aria-expanded", String\(!collapsed\)/.test(app) &&
    /function applyRelayCollapse\(collapsed\)[\s\S]*?setAttribute\("aria-label", collapsed/.test(app),
  "Collapsing updates aria-expanded and the accessible label, not just the CSS",
);
assert(
  /setAttribute\("data-tip", collapsed/.test(app),
  "The tooltip label follows the state, because it is drawn from attr(data-tip)",
);
assert(
  /localStorage\.setItem\(RELAY_COLLAPSED_KEY, collapsed \? "1" : "0"\)/.test(app) &&
    /function restoreRelayCollapse\(\)/.test(app) &&
    /localStorage\.getItem\(RELAY_COLLAPSED_KEY\)/.test(app),
  "The collapsed state is persisted and restored on the next load",
);
assert(
  /renderRelayList\(\);\s*\n\s*restoreRelayCollapse\(\);/.test(app),
  "The saved state is restored during init, after the relay list is first rendered",
);
assert(
  /\.btn-collapse\[aria-expanded="false"\]\s\.icon\s*\{[^}]*rotate\(-90deg\)/s.test(css) &&
    /<symbol id="i-chevron"/.test(html),
  "A single chevron symbol rotates to point right when the body is collapsed",
);
assert(
  /function applyRelayCollapse\(collapsed\)[\s\S]*?\}\s*catch \{/.test(app),
  "A storage failure (private mode, quota) leaves the collapse usable for this page view",
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
