/* qr_scanner_tests.js — unit tests for parseQrResult (pure, no camera) */

import { parseQrResult } from '../js/qr_scanner.js';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log("  ✓ " + msg); }
  else { failed++; console.error("  ✗ FAIL: " + msg); }
}

function assertThrows(fn, expectedSubstr) {
  try {
    fn();
    failed++;
    console.error("  ✗ FAIL: expected throw containing '" + expectedSubstr + "'");
  } catch (err) {
    if (expectedSubstr && !err.message.includes(expectedSubstr)) {
      failed++;
      console.error("  ✗ FAIL: expected '" + expectedSubstr + "', got '" + err.message + "'");
    } else {
      passed++;
      console.log("  ✓ threw: " + err.message);
    }
  }
}

// Real-format nsec (go-nostr example vector) — matches the bech32 charset.
const VALID_NSEC = "nsec1gccfk4suf25m4aarcgrl6uwf902whqkcuy85hdtdy264khr2rlnsrfn7kv";

console.log("parseQrResult:");

// Accepts
assert(parseQrResult(VALID_NSEC) === VALID_NSEC, "accepts a valid nsec");
assert(
  parseQrResult("  " + VALID_NSEC + "  ") === VALID_NSEC,
  "trims surrounding whitespace before accepting"
);

// Rejects
assertThrows(() => parseQrResult(""), "QR vazio");
assertThrows(() => parseQrResult(null), "QR vazio");
assertThrows(() => parseQrResult("hello world"), "nsec1");
assertThrows(() => parseQrResult("npub1qg9l7..."), "nsec1");
assertThrows(
  () => parseQrResult("nsec1AAAA BBBB"),
  "formato inválido"
);

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
