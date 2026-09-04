/* discovery_race_tests.js — the host reply can beat its own publish ack */

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

console.log("\n== Discovery generation guard ==");

// Both senders await the relay publish acknowledgement before arming the
// "host didn't answer" timeout. A host that replies during that await used to
// have its answer overwritten by the resolving send, and then be reported as
// silent. Every awaited send must therefore be followed by the guard before
// it touches the status line again.
const sends = [...appJs.matchAll(/await state\.nostr\.sendDiscoverRequest\([^)]*\);/gs)];
assert(sends.length === 2, "both discovery senders found (got " + sends.length + ")");

for (const send of sends) {
  const after = appJs.slice(send.index + send[0].length, send.index + send[0].length + 400);
  const guard = after.indexOf("answeredGeneration >= generation");
  const status = after.indexOf("el.tunnelStatus.textContent");
  assert(guard !== -1, "guard present after the awaited send");
  assert(guard !== -1 && (status === -1 || guard < status),
    "guard runs before the status line is overwritten");
}

// The guard is only meaningful if the reply handler stamps the generation.
assert(/function handleNostrResponse[\s\S]{0,200}answeredGeneration = discoveryGeneration/.test(appJs),
  "handleNostrResponse records the generation it answered");

// Each request must take a fresh generation, or a stale stamp would suppress
// the timeout for a later request the host really did ignore.
const bumps = [...appJs.matchAll(/\+\+discoveryGeneration/g)];
assert(bumps.length === 2, "each sender takes a fresh generation (got " + bumps.length + ")");

console.log("\n=== Results: " + passed + " passed, " + failed + " failed ===");
if (failed > 0) process.exit(1);
