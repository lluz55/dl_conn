/* relay_tests.js — Unit tests for RelayTester and RelayManager */

import { RelayTester } from '../js/relay_tester.js';
import { RelayManager, DEFAULT_RELAYS } from '../js/relay_manager.js';
import { RelayRttHistory, sparklinePoints } from '../js/relay_rtt_history.js';

/* ── Test helpers ──────────────────────────────────────────── */

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log("  ✓ " + msg);
  } else {
    failed++;
    console.error("  ✗ FAIL: " + msg);
  }
}

function assertThrows(fn, expectedMsg) {
  try {
    fn();
    failed++;
    console.error("  ✗ FAIL: expected throw but none occurred");
  } catch (err) {
    if (expectedMsg && !err.message.includes(expectedMsg)) {
      failed++;
      console.error("  ✗ FAIL: expected error containing '" + expectedMsg + "', got '" + err.message + "'");
    } else {
      passed++;
      console.log("  ✓ threw as expected: " + err.message);
    }
  }
}

/* ── RelayTester tests ─────────────────────────────────────── */

console.log("\n=== RelayTester Tests ===");

const tester = new RelayTester({ timeoutMs: 1000, reqTimeoutMs: 1000 });

// Test 1: RTT measurement returns expected shape
console.log("  [RTT Measurement]");
const rttResult = await tester.measureRtt("wss://invalid-relay-does-not-exist.example.com");
assert(typeof rttResult.url === "string", "RTT result has url");
assert(typeof rttResult.ok === "boolean", "RTT result has ok");
assert(typeof rttResult.rttMs === "number", "RTT result has rttMs number");
assert(rttResult.ok === false, "Invalid URL returns ok=false");
assert(typeof rttResult.error === "string", "Invalid URL returns error string");

// Test 2: NIP-11 probe returns expected shape
console.log("  [NIP-11 Probe]");
const nip11Result = await tester.probeNip11("wss://invalid-relay-does-not-exist.example.com");
assert(nip11Result.url === "wss://invalid-relay-does-not-exist.example.com", "NIP-11 result has url");
assert(nip11Result.nip11 === null, "Invalid URL returns null nip11");
assert(typeof nip11Result.error === "string", "Invalid URL returns error");

// Test 3: Subscription probe returns expected shape
console.log("  [Subscription Probe]");
const subResult = await tester.probeSubscription("wss://invalid-relay-does-not-exist.example.com");
assert(typeof subResult.url === "string", "Sub result has url");
assert(typeof subResult.subscriptionOk === "boolean", "Sub result has subscriptionOk");

// Test 4: testRelay returns full result
console.log("  [Full Test]");
const fullResult = await tester.testRelay("wss://invalid-relay-does-not-exist.example.com");
assert(fullResult.url === "wss://invalid-relay-does-not-exist.example.com", "Full test has url");
assert(typeof fullResult.ok === "boolean", "Full test has ok");
assert(typeof fullResult.rttMs === "number", "Full test has rttMs");
assert(typeof fullResult.lastChecked === "string", "Full test has lastChecked ISO string");

// Test 5: testAll returns array
console.log("  [Test All]");
const allResults = await tester.testAll(["wss://invalid-a.example.com", "wss://invalid-b.example.com"]);
assert(Array.isArray(allResults), "testAll returns array");
assert(allResults.length === 2, "testAll returns one result per URL");
assert(allResults[0].ok === false, "All invalid URLs fail");

// Test 6: Stats tracking
console.log("  [Stats]");
const avgRtt = tester.getAverageRtt("wss://invalid-relay-does-not-exist.example.com");
assert(typeof avgRtt === "number", "getAverageRtt returns number");
const successRate = tester.getSuccessRate("wss://invalid-relay-does-not-exist.example.com");
assert(typeof successRate === "number", "getSuccessRate returns number");
assert(successRate === 0, "0% success for invalid URLs");

/* ── RelayManager tests ────────────────────────────────────── */

console.log("\n=== RelayManager Tests ===");

// Mock localStorage for Node.js environment
const _store = {};
globalThis.localStorage = {
  getItem: (k) => _store[k] || null,
  setItem: (k, v) => { _store[k] = v; },
  removeItem: (k) => { delete _store[k]; },
};

const mgr = new RelayManager();

// Test 7: Default relays loaded
console.log("  [Default Relays]");
const defaults = mgr.getAll();
assert(defaults.length >= 4, "At least 4 default relays");
assert(defaults.every((r) => r.url.startsWith("wss://")), "All default relays are wss://");
assert(defaults.every((r) => r.enabled === true), "All default relays are enabled");

// Test 8: getActiveUrls
console.log("  [Active URLs]");
const active = mgr.getActiveUrls();
assert(active.length >= 4, "At least 4 active URLs");
assert(active.every((u) => u.startsWith("wss://")), "All active URLs are wss://");

// Test 9: Add relay
console.log("  [Add Relay]");
mgr.add("wss://test-relay.example.com");
const afterAdd = mgr.getAll();
assert(afterAdd.some((r) => r.url === "wss://test-relay.example.com"), "Added relay appears in list");

// Test 10: Duplicate relay rejected
console.log("  [Duplicate Rejection]");
assertThrows(() => mgr.add("wss://test-relay.example.com"), "already exists");

// Test 11: Invalid URL rejected
console.log("  [Invalid URL Rejection]");
assertThrows(() => mgr.add("http://not-wss.com"), "Invalid relay URL");
assertThrows(() => mgr.add("not-a-url"), "Invalid relay URL");

// Test 12: Toggle relay
console.log("  [Toggle]");
const toggledOff = mgr.toggle("wss://test-relay.example.com");
assert(toggledOff === false, "Toggle returns false (disabled)");
assert(!mgr.getActiveUrls().includes("wss://test-relay.example.com"), "Disabled relay not in active list");
const toggledOn = mgr.toggle("wss://test-relay.example.com");
assert(toggledOn === true, "Toggle back returns true (enabled)");

// Test 13: Remove relay
console.log("  [Remove]");
mgr.remove("wss://test-relay.example.com");
assert(!mgr.getAll().some((r) => r.url === "wss://test-relay.example.com"), "Removed relay gone from list");
assertThrows(() => mgr.remove("wss://test-relay.example.com"), "not found");

// Test 14: Reset to defaults
console.log("  [Reset]");
mgr.add("wss://custom.example.com");
mgr.reset();
const afterReset = mgr.getAll();
assert(afterReset.length === DEFAULT_RELAYS.length, "Reset restores every default relay");
assert(!afterReset.some((r) => r.url === "wss://custom.example.com"), "Custom relay gone after reset");

// Test 15: getRankedUrls returns array of strings
console.log("  [Ranked URLs]");
const ranked = mgr.getRankedUrls();
assert(Array.isArray(ranked), "getRankedUrls returns array");
assert(ranked.every((u) => typeof u === "string"), "All ranked items are strings");
assert(ranked.length === DEFAULT_RELAYS.length, "Ranked has one entry per default relay");

// Test 16: Event listener
console.log("  [Events]");
let eventFired = false;
const unsub = mgr.on((event) => { eventFired = true; });
mgr.add("wss://event-test.example.com");
assert(eventFired, "Event fired on add");
mgr.remove("wss://event-test.example.com");
unsub();

/* ── RTT history ─────────────────────────────────────────────── */

console.log("\n  [RTT History]");
// A fake localStorage so the tests never touch the real one.
function fakeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

{
  const storage = fakeStorage();
  globalThis.localStorage = storage;
  const h = new RelayRttHistory({ storageKey: "t1" });
  h.record("wss://a.example.com", 120);
  h.record("wss://a.example.com", 480);
  h.record("wss://a.example.com", 90);
  assert(h.get("wss://a.example.com").join(",") === "120,480,90",
    "samples are kept oldest first: " + h.get("wss://a.example.com").join(","));
  assert(h.measured("wss://a.example.com").join(",") === "120,480,90",
    "measured() returns only the samples that carry a number");

  // A fresh instance must recover the series from storage.
  const reloaded = new RelayRttHistory({ storageKey: "t1" });
  assert(reloaded.get("wss://a.example.com").join(",") === "120,480,90",
    "the window survives a reload");
}

// A failure is recorded as a gap, never as a number: a fabricated latency
// would read as "it answered, slowly".
{
  globalThis.localStorage = fakeStorage();
  const h = new RelayRttHistory({ storageKey: "t2" });
  h.record("wss://a.example.com", 120);
  h.record("wss://a.example.com", null);
  assert(h.get("wss://a.example.com").join(",") === "120,",
    "a failed probe becomes a gap: " + JSON.stringify(h.get("wss://a.example.com")));
  assert(h.measured("wss://a.example.com").join(",") === "120",
    "a gap is not averaged in as a zero");
}

// The window is bounded: this is written on every probe of every relay.
{
  globalThis.localStorage = fakeStorage();
  const h = new RelayRttHistory({ storageKey: "t3", points: 5 });
  for (let i = 0; i < 12; i++) h.record("wss://a.example.com", i);
  const got = h.get("wss://a.example.com");
  assert(got.length === 5, "the window is capped at points, got " + got.length);
  assert(got.join(",") === "7,8,9,10,11",
    "trimming keeps the newest samples: " + got.join(","));
}

{
  globalThis.localStorage = fakeStorage();
  const h = new RelayRttHistory({ storageKey: "t4" });
  h.record("wss://a.example.com", 100);
  h.forget("wss://a.example.com");
  assert(h.get("wss://a.example.com").length === 0,
    "forget() drops the series of a removed relay");
}

// Corrupt or hostile storage must not break the page.
{
  globalThis.localStorage = fakeStorage({ t5: "{not json" });
  const h = new RelayRttHistory({ storageKey: "t5" });
  assert(h.get("wss://a.example.com").length === 0, "corrupt storage starts empty");
  h.record("wss://a.example.com", 50);
  assert(h.get("wss://a.example.com").length === 1, "and still records afterwards");
}
{
  globalThis.localStorage = fakeStorage({ t6: JSON.stringify(["not", "an", "object"]) });
  const h = new RelayRttHistory({ storageKey: "t6" });
  assert(h.get("wss://a.example.com").length === 0, "an array payload is ignored");
}
// Storage that throws (private mode / quota) must not break a background probe.
{
  globalThis.localStorage = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("quota"); },
  };
  const h = new RelayRttHistory({ storageKey: "t7" });
  h.record("wss://a.example.com", 70);
  assert(h.get("wss://a.example.com").join(",") === "70",
    "with storage denied the series still works for this page view");
}

console.log("\n  [Sparkline]");
assert(sparklinePoints([], 100) === "", "no samples draw nothing");
assert(sparklinePoints([null, null], 100) === "", "all gaps draw nothing");
// A gap must break the path, not be interpolated across.
assert(sparklinePoints([100, null, 100], 200) === "0.00,20.00 100.00,20.00",
  "a missing sample breaks the line: " + sparklinePoints([100, null, 100], 200));
assert(sparklinePoints([100, 200], 200) === "0.00,20.00 100.00,2.00",
  "two samples span the full width");
// Vertical: the ceiling maps to the top of the box, so a value above it is
// clamped to the top edge instead of drawing outside the viewBox.
assert(sparklinePoints([1000], 1000) === "100.00,2.00", "the ceiling sits at the top: " + sparklinePoints([1000], 1000));
assert(sparklinePoints([5000], 1000) === "100.00,2.00",
  "a value above the ceiling is clamped to the top edge: " + sparklinePoints([5000], 1000));
assert(sparklinePoints([0], 1000) === "100.00,38.00", "zero sits at the bottom");
assert(sparklinePoints([-5], 1000) === "100.00,38.00", "a negative value is clamped to the bottom");

// The manager records a probe result into the history.
{
  globalThis.localStorage = fakeStorage();
  const history = new RelayRttHistory({ storageKey: "t8" });
  const m2 = new RelayManager().withHistory(history);
  const url = m2.getAll()[0].url;
  m2._results.set(url, { url, ok: true, rttMs: 250 });
  m2._recordRtt(url, m2._results.get(url));
  assert(history.get(url).join(",") === "250", "a successful probe is recorded");
  m2._results.set(url, { url, ok: false, rttMs: 0, error: "timeout" });
  m2._recordRtt(url, m2._results.get(url));
  assert(history.get(url).join(",") === "250,",
    "a failed probe is recorded as a gap, not skipped");
  m2.remove(url);
  assert(history.get(url).length === 0,
    "removing a relay forgets its series instead of leaving it in storage");
}

// A manager with no history attached keeps its old behaviour.
{
  globalThis.localStorage = fakeStorage();
  const m3 = new RelayManager();
  assert(m3.history === null, "history is opt-in");
  m3._recordRtt("wss://x.example.com", { ok: true, rttMs: 10 });
}

// Summary
console.log("\n=== Results: " + passed + " passed, " + failed + " failed ===");
if (failed > 0) process.exit(1);
