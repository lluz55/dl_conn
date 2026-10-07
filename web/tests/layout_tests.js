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
  "Services render as rows in the Serviços list",
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
  /id="services-section"[\s\S]*?id="btn-toggle-custom-service"[\s\S]*?id="btn-refresh-services"[\s\S]*?id="btn-clear-services"/.test(html) &&
    /id="services-health"/.test(html) &&
    /id="custom-service-form"/.test(html),
  "The services card still owns the add / refresh / clear controls, the health strip and the custom-service form",
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

// ── Collapsible sections (one registry, every card) ─────────────────
console.log("  [Collapsible sections]");

// The registry is the single source of truth. Reading it here — rather than
// hardcoding a list of card ids — is what lets the next section added to
// index.html fail this suite if nobody gave it a collapse button.
const registry = app.match(/const COLLAPSIBLE_SECTIONS = \[([\s\S]*?)\n  \];/);
assert(
  registry !== null,
  "app.js declares the collapsible sections in one registry",
);
const registrySrc = registry ? registry[1] : "";
const declaredSections = [...registrySrc.matchAll(/section: "([^"]+)"/g)].map((m) => m[1]);
const declaredBodies = [...registrySrc.matchAll(/bodies: \[([^\]]*)\]/g)]
  .flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
const declaredButtons = [...registrySrc.matchAll(/buttons: \[([^\]]*)\]/g)]
  .flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
const markupSections = [...html.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);

assert(
  declaredSections.length > 0 && markupSections.length > 0 &&
    markupSections.every((s) => declaredSections.includes(s)),
  "EVERY <section> in index.html has a row in the collapse registry — no card ships without a collapse button",
);
assert(
  declaredSections.every((s) => markupSections.includes(s)),
  "Every registry row points at a real <section>, so a renamed id cannot leave a stale entry behind",
);
assert(
  declaredBodies.every((b) => html.includes(`id="${b}"`)) &&
    declaredButtons.every((b) => html.includes(`id="${b}"`)),
  "Every body and button the registry toggles exists in the markup",
);
assert(
  declaredButtons.every((b) => {
    const btn = html.match(new RegExp(`<button id="${b}"[^>]*>`));
    return btn && /aria-expanded="true"/.test(btn[0]) && /btn-collapse/.test(btn[0]);
  }),
  "Every disclosure button ships expanded and carries the rotating-chevron class",
);
assert(
  declaredButtons.every((b) => {
    const btn = html.match(new RegExp(`<button id="${b}"[^>]*aria-controls="([^"]+)"`));
    return btn && declaredBodies.includes(btn[1]);
  }),
  "Every disclosure button's aria-controls names a body this registry knows how to hide",
);
assert(
  declaredSections.length === declaredBodies.length - 1 &&
    declaredSections.every((s) => {
      // The session card has two mutually exclusive sides sharing one preference.
      const bodies = [...registrySrc.matchAll(new RegExp(`section: "${s}",[\\s\\S]*?bodies: \\[([^\\]]*)\\]`, "g"))]
        .map((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]))[0];
      return bodies.length === 1 || s === "vault-section";
    }),
  "One preference drives each card's bodies, so the session card's two sides cannot diverge",
);

// ── Collapse behaviour (shared controller) ──────────────────────────
assert(
  /function toggleSectionCollapse\(section\)[\s\S]*?nextCollapsed\(body\.classList\.contains\("hidden"\)\)/.test(app),
  "The toggle delegates the inversion to nextCollapsed() — passing the read value through is what made the relay button a no-op",
);
assert(
  /function applySectionCollapse\(section, collapsed\)[\s\S]*?body\.classList\.toggle\("hidden", collapsed\)/.test(app),
  "Collapsing hides the body only, leaving the card and its head visible",
);
assert(
  /function applySectionCollapse\(section, collapsed\)[\s\S]*?aria-expanded", String\(!collapsed\)/.test(app) &&
    /function applySectionCollapse\(section, collapsed\)[\s\S]*?setAttribute\("aria-label", label\)/.test(app),
  "Collapsing updates aria-expanded and the accessible label, not just the CSS",
);
assert(
  /setAttribute\("data-tip", label\)/.test(app),
  "The tooltip label follows the state, because it is drawn from attr(data-tip)",
);
assert(
  /function restoreSectionCollapses\(\)[\s\S]*?localStorage\.getItem\(section\.storageKey\)[\s\S]*?storedCollapsed\(saved\)/.test(app) &&
    /function applySectionCollapse\(section, collapsed\)[\s\S]*?localStorage\.setItem\(section\.storageKey, storedValue\(collapsed\)\)/.test(app),
  "Each section's collapsed state is persisted and restored on the next load",
);
assert(
  /const label = collapseLabel\(collapsed, section\.label\)/.test(app),
  "Both buttons take their label from one helper, so aria-label and data-tip cannot disagree",
);
assert(
  /function bindSectionCollapses\(\)[\s\S]*?for \(const section of COLLAPSIBLE_SECTIONS\)[\s\S]*?addEventListener\("click", \(\) => toggleSectionCollapse\(section\)\)/.test(app),
  "One loop wires every declared button, instead of a hand-written listener per card",
);
assert(
  /renderRelayList\(\);\s*\n\s*restoreSectionCollapses\(\);/.test(app),
  "Saved states are restored during init, after the relay list is first rendered",
);
assert(
  /function applySectionCollapse\(section, collapsed\)[\s\S]*?\}\s*catch \{/.test(app),
  "A storage failure (private mode, quota) leaves the collapse usable for this page view",
);
assert(
  /\.btn-collapse\[aria-expanded="false"\]\s\.icon\s*\{[^}]*rotate\(-90deg\)/s.test(css) &&
    /<symbol id="i-chevron"/.test(html),
  "A single chevron symbol rotates to point right when the body is collapsed",
);
assert(
  /#status-body,[\s\S]*?#debug-body\s*\{[^}]*flex-direction:\s*column[^}]*gap:\s*var\(--gap-md\)/s.test(css),
  "Every collapsible body re-declares the card's gap, which no longer reaches its grandchildren",
);

// ── Per-card collapse contract ──────────────────────────────────────
assert(
  /id="relay-summary"[\s\S]*?id="btn-collapse-relays"/.test(html),
  "The relay summary pill stays in the head, so it remains readable while collapsed",
);
assert(
  /id="vault-state-pill"[\s\S]*?id="btn-collapse-session-setup"/.test(html) &&
    /id="session-state-pill"[\s\S]*?id="btn-collapse-session-live"/.test(html),
  "The session state pills stay in each head, so session state remains readable while collapsed",
);
assert(
  /id="services-overview-count"[\s\S]*?id="btn-collapse-services"/.test(html),
  "The service count pill stays in the Services head, so it remains readable while collapsed",
);
assert(
  /id="tel-uptime"[\s\S]*?id="btn-collapse-host"/.test(html),
  "Uptime and the live badge stay in the host head, so 'is it reporting?' survives the collapse",
);
assert(
  /id="session-setup-body"[\s\S]*?id="unlock-ui"[\s\S]*?id="login-ui"[\s\S]*?id="btn-clear-all"/.test(html) &&
    /id="btn-collapse-session-live"[\s\S]*?id="session-live-body"[\s\S]*?id="auto-lock-section"[\s\S]*?id="biometric-enroll"/.test(html),
  "Collapsing hides the login/unlock controls and the auto-lock/biometric bands, but not the heads",
);
assert(
  /#session-setup-body,\s*\n#session-live-body\s*\{[^}]*flex-direction:\s*column[^}]*gap:\s*var\(--gap-md\)/s.test(css),
  "The wrapped setup body keeps the vertical rhythm its parent used to provide",
);
assert(
  /\.session-main \.btn-collapse\s*\{[^}]*flex-shrink:\s*0/s.test(css),
  "The live head's disclosure button is not squeezed by a long npub chip",
);
assert(
  !/applyRelayCollapse|applySessionCollapse|onToggleSessionCollapse|RELAY_COLLAPSED_KEY|SESSION_COLLAPSED_KEY/.test(app),
  "The per-card collapse copies are gone, so no sibling can drift out of sync with the shared controller",
);

// ── Overview / Services split ───────────────────────────────────────
console.log("  [Overview and Services split]");
assert(
  /<section id="status-section" class="card">[\s\S]*?id="status-body"[\s\S]*?<\/section>/.test(html),
  "Visão geral is its own card with a collapsible body",
);
assert(
  /id="avail-window-group"[\s\S]*?data-avail-window="3600"[\s\S]*?data-avail-window="86400"[\s\S]*?data-avail-window="604800"/.test(html) &&
    /wireSegGroup\(el\.availWindowGroup, "data-avail-window"/.test(app),
  "The availability window toggle reads the attribute the buttons actually carry",
);
assert(
  !/data-availWindow|data-availwindow/.test(app) && !/data-availWindow/.test(html),
  "No camelCase spelling of the availability attribute survives — it would select nothing",
);
assert(
  /id="status-body"[\s\S]*?status-grid[\s\S]*?tunnel-timeline-block[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/.test(html),
  "Visão geral keeps only the KPI grid and the tunnel timeline — it is the quick read",
);
assert(
  /<section id="services-section" class="card">[\s\S]*?id="services-body"[\s\S]*?<\/section>/.test(html),
  "Serviços is a card of its own, no longer a block nested inside Visão geral",
);
assert(
  /id="status-body"[\s\S]*?<section id="services-section"/.test(html),
  "The services section follows the overview rather than sitting inside it",
);
assert(
  /el\.servicesSection/.test(app) && !/el\.servicesOverview\b/.test(app),
  "app.js gates the Live phase on the services card, not on the removed nested container",
);
assert(
  /id="services-section"[\s\S]*?id="services-health"[\s\S]*?id="custom-service-form"[\s\S]*?id="services-overview-list"[\s\S]*?id="services-availability"/.test(html),
  "The services card still owns the health strip, the custom-service form, the list and the availability chart",
);
assert(
  /id="services-overview-count"[\s\S]*?id="btn-toggle-custom-service"[\s\S]*?id="btn-refresh-services"[\s\S]*?id="btn-clear-services"/.test(html),
  "The add / refresh / clear controls moved up into the services card head",
);
assert(
  /\.services-body\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/s.test(css),
  "The services body keeps the list rhythm it had as a nested block",
);
assert(
  !/\.services-overview\s*\{|\.services-overview-head/.test(css),
  "The CSS for the removed nested services block is gone, not left orphaned",
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
