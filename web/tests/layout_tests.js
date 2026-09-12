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
  /grid-template-columns:\s*10px\s+minmax\(0,\s*1fr\)\s+44px\s+44px/.test(css),
  "Compact relay rows reserve space without overflowing",
);
assert(
  /'<div class="service-top">'\s*\+\s*serviceIcon\(svc\.icon\)/.test(app),
  "Generated service content uses the styled service-top wrapper",
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
