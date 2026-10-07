/* section_collapse_tests.js — state rules for the collapsible cards
 *
 * These exist because both bugs this replaced were *silent*: the relay
 * collapse button animated and updated its own tooltip while the body never
 * moved, and the availability toggle's selector matched no element at all.
 * Neither failure is visible in a screenshot of the markup, so the rules they
 * broke are asserted here directly.
 */

import {
  nextCollapsed,
  collapseLabel,
  collapseLabels,
  storedCollapsed,
  storedValue,
} from '../js/section_collapse.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log("  ✓ " + msg); }
  else { failed++; console.error("  ✗ FAIL: " + msg); }
}

console.log("\n=== Toggling between states ===");

// The regression: the relay card read its body's state and passed it straight
// through, so `hidden` was re-applied as-is and the button never changed
// anything. Two presses have to return to where they started.
assert(nextCollapsed(false) === true,
  "an expanded body collapses on press");
assert(nextCollapsed(true) === false,
  "a collapsed body expands on press");
assert(nextCollapsed(nextCollapsed(false)) === false,
  "two presses are a round trip, not two collapses");
assert(nextCollapsed(nextCollapsed(true)) === true,
  "two presses from collapsed come back to collapsed");
for (const start of [true, false]) {
  let state = start;
  for (let i = 0; i < 7; i++) state = nextCollapsed(state);
  assert(state === !start,
    "an odd number of presses flips the state from " + (start ? "collapsed" : "expanded"));
}

console.log("\n=== Labels ===");

assert(collapseLabel(false, "relays") === "Recolher relays",
  "an expanded section offers to collapse");
assert(collapseLabel(true, "relays") === "Expandir relays",
  "a collapsed section offers to expand");
assert(collapseLabel(true, "visão geral") === "Expandir visão geral",
  "the label carries the section's own name, so the two cards are distinguishable");
const labels = collapseLabels(true, "serviços");
assert(labels.expand === "Expandir serviços" && labels.collapse === "Recolher serviços",
  "both labels are available for either state without recomputing the other");
assert(collapseLabel(true, "sessão") !== collapseLabel(true, "relays"),
  "two collapsed sections never share a tooltip");

console.log("\n=== Persisted preference ===");

assert(storedCollapsed("1") === true, 'the stored "1" means collapsed');
assert(storedCollapsed("0") === false, 'the stored "0" means expanded');
// An absent preference must land on "expanded". Reading "" as truthy would
// collapse every section on the operator's first ever visit.
assert(storedCollapsed(null) === false, "no stored preference starts expanded");
assert(storedCollapsed(undefined) === false, "an undefined preference starts expanded");
assert(storedCollapsed("") === false, "an empty string is not a preference");
assert(storedCollapsed("true") === false, 'only the exact "1" counts, not any truthy string');

assert(storedValue(true) === "1" && storedValue(false) === "0",
  "the stored round-trip preserves the state");
assert(storedCollapsed(storedValue(true)) === true && storedCollapsed(storedValue(false)) === false,
  "what is written is what is read back");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);