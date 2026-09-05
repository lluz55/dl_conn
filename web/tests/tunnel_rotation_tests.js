/* tunnel_rotation_tests.js — a rotated tunnel URL must reach the UI intact */

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

console.log("\n== Subscription rejects stored backscroll ==");

// cloudflared mints a new hostname on every restart. Relays replay old DMs on
// subscribe, and each one carries the tunnel URL that was live when it was
// sent — a stream of dead URLs. Without `since`, those land after the fresh
// reply and overwrite it.
assert(/since:?\s*[,}]|since\b/.test(clientJs), "subscription filter carries a `since` bound");
assert(/kinds:\s*\[4,\s*1059\][\s\S]{0,60}?since\s*\}/.test(clientJs),
  "`since` is on the DM filter itself, not merely computed");
assert(/Date\.now\(\)\s*\/\s*1000\s*\)\s*-\s*CLOCK_SKEW_TOLERANCE_SEC/.test(clientJs),
  "`since` allows for clock skew so a genuine reply is not filtered out");

console.log("\n== Replies carry their timestamp ==");

// Relays deliver independently and give no ordering guarantee, so recency has
// to be decided from the event's own created_at.
assert(/detail:\s*\{\s*data,\s*createdAt:/.test(clientJs),
  "dispatched detail carries both the payload and createdAt");
assert(/createdAt:\s*incomingEvent\.created_at/.test(clientJs),
  "createdAt comes from the signed event, not from local time");

console.log("\n== Out-of-order replies are discarded ==");

assert(/addEventListener\("response",\s*\(e\)\s*=>\s*onDiscoveryResponse\(e\.detail\)\)/.test(appJs),
  "the response listener routes through the recency guard");
assert(/createdAt\s*<\s*lastResponseAt\)\s*return;/.test(appJs),
  "a reply older than the one already applied is dropped");
assert(/lastResponseAt\s*=\s*createdAt/.test(appJs),
  "applying a reply advances the recency watermark");

// The guard must sit before the state write, or the stale URL is already in
// place by the time it is rejected.
const guardIdx = appJs.indexOf("createdAt < lastResponseAt");
const assignIdx = appJs.indexOf("state.tunnelURL = data.tunnel_url");
assert(guardIdx !== -1 && assignIdx !== -1 && guardIdx < assignIdx,
  "the guard runs before state.tunnelURL is overwritten");

// The service links are rebuilt from the current URL on every reply, so a
// rotation actually repoints them.
assert(/state\.tunnelURL = data\.tunnel_url[\s\S]{0,400}renderServices\(\)/.test(appJs),
  "a new URL triggers a re-render of the service links");

console.log("\n=== Results: " + passed + " passed, " + failed + " failed ===");
if (failed > 0) process.exit(1);
