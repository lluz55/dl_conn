/* host_history_tests.js — Tests for the host-history shaping helpers */

import {
  availabilityStrip,
  availabilitySummary,
  incarnationSpan,
  incarnationSeconds,
  SEG_UP,
  SEG_DOWN,
  SEG_UNKNOWN,
} from '../js/host_history.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log("  ✓ " + msg); }
  else { failed++; console.error("  ✗ FAIL: " + msg); }
}

const FROM = 1_700_000_000;
const TO = FROM + 3600; // a one-hour window
const SLOTS = 10;

console.log("\n=== Availability strip ===");

assert(availabilityStrip([], FROM, TO, SLOTS).length === SLOTS,
  "an empty series still yields the full strip width");
assert(availabilityStrip([], FROM, TO, SLOTS).every((s) => s === SEG_UNKNOWN),
  "an empty series is all unknown, never all green");
assert(availabilityStrip(null, FROM, TO, SLOTS).every((s) => s === SEG_UNKNOWN),
  "a null series degrades to unknown");

// Points are placed by timestamp, not by index. This is the assertion that
// matters: a host that was off for an hour returns one point, and indexing it
// evenly would paint the whole window green.
{
  const strip = availabilityStrip([{ ts: FROM, status: SEG_UP }], FROM, TO, SLOTS);
  assert(strip[0] === SEG_UP, "the single point lands in its own slot");
  assert(strip.slice(1).every((s) => s === SEG_UNKNOWN),
    "the rest of the window is unknown, not stretched green: " + strip.join(","));
}

// First and last instants land in the first and last cell, not one past.
{
  const strip = availabilityStrip(
    [{ ts: FROM, status: SEG_UP }, { ts: TO, status: SEG_UP }],
    FROM, TO, SLOTS
  );
  assert(strip[0] === SEG_UP, "the window's first instant lands in the first cell");
  assert(strip[SLOTS - 1] === SEG_UP, "the window's last instant lands in the last cell");
}

// Worst-wins within a cell.
{
  const strip = availabilityStrip(
    [{ ts: FROM + 10, status: SEG_UP }, { ts: FROM + 20, status: SEG_DOWN }],
    FROM, TO, 4
  );
  assert(strip[0] === SEG_DOWN,
    "an outage sharing a cell with healthy samples is still drawn as an outage: " + strip.join(","));
}
{
  const strip = availabilityStrip(
    [{ ts: FROM, status: SEG_DOWN }, { ts: FROM + 60, status: SEG_UNKNOWN }],
    FROM, TO, 4
  );
  assert(strip[0] === SEG_DOWN, "down outranks unknown in the same cell");
}

// Points outside the window are ignored rather than clamped onto its edge.
{
  const strip = availabilityStrip(
    [{ ts: FROM - 3600, status: SEG_DOWN }, { ts: TO + 3600, status: SEG_DOWN }],
    FROM, TO, SLOTS
  );
  assert(strip.every((s) => s === SEG_UNKNOWN),
    "points outside the window are not clamped onto its edges");
}

// A zero-width window cannot be divided into cells.
assert(availabilityStrip([{ ts: FROM, status: SEG_UP }], FROM, FROM, SLOTS).every((s) => s === SEG_UNKNOWN),
  "a zero-width window yields no cells, not a division by zero");

console.log("\n=== Availability summary ===");
{
  const s = availabilitySummary([SEG_UP, SEG_UP, SEG_DOWN, SEG_UNKNOWN]);
  assert(s.up === 2 && s.down === 1 && s.unknown === 1 && s.known === 3, "counts each state");
  assert(s.percent === (2 / 3) * 100,
    "the percentage is over *known* cells: " + s.percent);
}
{
  const s = availabilitySummary([SEG_UNKNOWN, SEG_UNKNOWN]);
  assert(s.percent === null,
    "a window with no readings reports no percentage — 100% would be a confident lie");
}
{
  const s = availabilitySummary([]);
  assert(s.percent === null && s.known === 0, "an empty strip has nothing to report");
}
{
  const s = availabilitySummary(null);
  assert(s.percent === null, "a null strip degrades safely");
}
{
  const s = availabilitySummary([SEG_UP, SEG_UP]);
  assert(s.percent === 100, "a fully healthy window reports 100%");
}

console.log("\n=== Tunnel incarnation span ===");
{
  const span = incarnationSpan({ started_at: FROM, ended_at: null }, FROM, TO);
  assert(span.start === 0 && span.end === 1 && span.current === true,
    "an incarnation covering the window runs edge to edge and reads as current");
}
// Clipping the start is the whole point: pinning an older incarnation's left
// edge to the window boundary would invent a rotation that never happened.
{
  const span = incarnationSpan({ started_at: FROM - 7200, ended_at: FROM + 1800 }, FROM, TO);
  assert(span.start === 0, "an incarnation that began earlier is clipped at the window edge");
  assert(Math.abs(span.end - 0.5) < 1e-9, "its real end is kept: " + span.end);
  assert(span.current === false, "a closed incarnation is not current");
}
{
  const span = incarnationSpan({ started_at: FROM + 3600, ended_at: null }, FROM, TO);
  assert(span.start === 1 && span.end === 1, "one that starts at the very end still overlaps");
}
assert(incarnationSpan({ started_at: FROM + 7200, ended_at: FROM + 10800 }, FROM, TO) === null,
  "one entirely after the window does not overlap it");
assert(incarnationSpan({ started_at: FROM - 10800, ended_at: FROM - 7200 }, FROM, TO) === null,
  "one entirely before the window does not overlap it");
assert(incarnationSpan(null, FROM, TO) === null, "a null incarnation is skipped");
assert(incarnationSpan({}, FROM, TO) === null, "an incarnation with no start is skipped");

console.log("\n=== Incarnation duration ===");
assert(incarnationSeconds({ started_at: FROM, ended_at: FROM + 90 }, 0) === 90,
  "a closed incarnation measures its own lifetime");
assert(incarnationSeconds({ started_at: FROM, ended_at: null }, FROM + 45) === 45,
  "the current one measures up to now");
assert(incarnationSeconds({ started_at: FROM, ended_at: FROM - 10 }, 0) === 0,
  "an end before the start clamps to zero rather than going negative");
assert(incarnationSeconds(null) === 0, "a null incarnation has no duration");

console.log("\n=== Results: " + passed + " passed, " + failed + " failed ===");
if (failed > 0) process.exit(1);