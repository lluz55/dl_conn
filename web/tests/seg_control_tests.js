/* seg_control_tests.js — attribute spelling for the segmented controls
 *
 * The availability toggle (1h/24h/7d) shipped wired to the selector
 * `.seg[data-availWindow]` against markup that spells the attribute
 * `data-avail-window`. That selector matches nothing — the engine lowercases
 * it to `data-availwindow`, a different name rather than another casing of the
 * same one — so every click was dropped and the control was inert.
 *
 * The fix is to derive the `dataset` key from the markup attribute instead of
 * writing it out by hand, which makes the mismatch impossible at the call site.
 * What is asserted here is that derivation.
 */

import { datasetKeyFor, segSelector } from '../js/seg_control.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log("  ✓ " + msg); }
  else { failed++; console.error("  ✗ FAIL: " + msg); }
}

console.log("\n=== dataset key derivation ===");

assert(datasetKeyFor("data-avail-window") === "availWindow",
  "the availability attribute maps to the key dataset actually exposes");
assert(datasetKeyFor("data-window") === "window",
  "a single-word attribute is its own key");
assert(datasetKeyFor("data-metric") === "metric",
  "the metric attribute is its own key");
assert(datasetKeyFor("data-host-tunnel-id") === "hostTunnelId",
  "every hyphen becomes an uppercase letter, as the DOM does it");
assert(datasetKeyFor("data-window") !== "dataWindow",
  "the data- prefix is stripped, not camel-cased into the key");

console.log("\n=== Selector spelling ===");

// The regression itself: this is the selector that shipped and matched nothing.
assert(segSelector("data-avail-window") === ".seg[data-avail-window]",
  "the selector uses the markup spelling, which is the one that exists");
assert(segSelector("data-avail-window") !== ".seg[data-availWindow]",
  "the selector is never built from the camelCase key");
assert(segSelector("data-window") === ".seg[data-window]",
  "the telemetry window group keeps its own selector");
assert(segSelector("data-metric") === ".seg[data-metric]",
  "the metric group keeps its own selector");

// A lowercase-attribute selector would look equivalent but names a different
// attribute, so the guard is that the two spellings are never conflated.
const selector = segSelector("data-avail-window");
const attr = selector.match(/\[([^\]=]+)\]/)[1];
assert(attr === "data-avail-window",
  "the attribute inside the selector is byte-identical to the markup attribute");

console.log("\n=== Selector and key agree ===");

// The invariant the fix relies on: for every attribute used in the markup,
// the key derived from it is the one `btn.dataset` exposes, so reading the
// value after matching by selector cannot come back undefined.
for (const attr of ["data-window", "data-metric", "data-avail-window"]) {
  const key = datasetKeyFor(attr);
  assert(key.length > 0 && key !== attr && !key.includes("-"),
    attr + " -> dataset." + key + " (no hyphens left, not the raw attribute)");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);