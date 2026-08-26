/* relay_tests.js — Unit tests for RelayTester and RelayManager */

import { RelayTester } from '../js/relay_tester.js';
import { RelayManager, DEFAULT_RELAYS } from '../js/relay_manager.js';

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

// Summary
console.log("\n=== Results: " + passed + " passed, " + failed + " failed ===");
if (failed > 0) process.exit(1);
