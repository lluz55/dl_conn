/* crypto_tests.js — Unit tests for CryptoVault round-trip and integrity */

import {
  encryptVault,
  decryptVault,
  saveVaultToStorage,
  loadVaultFromStorage,
  removeVaultFromStorage,
  hasVault,
} from '../js/crypto_vault.js';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log("  ✓ " + msg); }
  else { failed++; console.error("  ✗ FAIL: " + msg); }
}

function assertThrows(fn, expectedMsg) {
  try {
    fn();
    failed++;
    console.error("  ✗ FAIL: expected throw");
  } catch (err) {
    if (expectedMsg && !err.message.includes(expectedMsg)) {
      failed++;
      console.error("  ✗ FAIL: expected '" + expectedMsg + "', got '" + err.message + "'");
    } else {
      passed++;
      console.log("  ✓ threw: " + err.message);
    }
  }
}

// Mock localStorage
const _store = {};
globalThis.localStorage = {
  getItem: (k) => _store[k] || null,
  setItem: (k, v) => { _store[k] = v; },
  removeItem: (k) => { delete _store[k]; },
};

/* ── Tests ─────────────────────────────────────────────────── */

console.log("\n=== CryptoVault Tests ===");

// Test 1: Round-trip encrypt/decrypt
console.log("  [Round-trip]");
const payload = { npub: "npub1abc123xyz", sk: "a".repeat(64), relays: ["wss://relay.test"] };
const pin = "1234";
const envelope = await encryptVault(payload, pin);

assert(typeof envelope.salt === "string", "Envelope has salt (Base64)");
assert(typeof envelope.iv === "string", "Envelope has iv (Base64)");
assert(typeof envelope.ciphertext === "string", "Envelope has ciphertext (Base64)");
assert(typeof envelope.authTag === "string", "Envelope has authTag (Base64)");
assert(typeof envelope.publicHint === "string", "Envelope has publicHint");
assert(envelope.publicHint.includes("..."), "PublicHint truncated with ...");
assert(typeof envelope.createdAt === "string", "Envelope has createdAt ISO string");

// Test 2: Decryption with correct PIN
console.log("  [Decrypt Correct PIN]");
const decrypted = await decryptVault(envelope, pin);
assert(decrypted.npub === payload.npub, "Decrypted npub matches");
assert(decrypted.sk === payload.sk, "Decrypted sk matches");
assert(JSON.stringify(decrypted.relays) === JSON.stringify(payload.relays), "Decrypted relays match");

// Test 3: Wrong PIN fails
console.log("  [Wrong PIN]");
let wrongPinFailed = false;
try {
  await decryptVault(envelope, "9999");
  wrongPinFailed = false;
} catch (err) {
  wrongPinFailed = true;
  assert(err.message.includes("decrypt") || err.name === "OperationError", "Wrong PIN throws OperationError or decrypt error");
}
if (!wrongPinFailed) {
  failed++;
  console.error("  ✗ FAIL: Wrong PIN should throw");
}

// Test 4: Corrupted ciphertext fails
console.log("  [Corrupted Payload]");
const corrupted = { ...envelope, ciphertext: "AAAA" + envelope.ciphertext.slice(4) };
let corruptedFailed = false;
try {
  await decryptVault(corrupted, pin);
} catch {
  corruptedFailed = true;
}
assert(corruptedFailed, "Corrupted ciphertext throws on decrypt");

// Test 5: Different IV each time
console.log("  [Unique IVs]");
const env2 = await encryptVault(payload, pin);
assert(env2.iv !== envelope.iv, "Different encryption produces different IV");
assert(env2.salt !== envelope.salt, "Different encryption produces different salt");

// Test 6: localStorage persistence
console.log("  [Storage Persistence]");
saveVaultToStorage(envelope);
assert(hasVault(), "hasVault returns true after save");
const loaded = loadVaultFromStorage();
assert(loaded !== null, "loadVaultFromStorage returns data");
assert(loaded.ciphertext === envelope.ciphertext, "Loaded ciphertext matches");
removeVaultFromStorage();
assert(!hasVault(), "hasVault returns false after remove");

// Test 7: Large payload
console.log("  [Large Payload]");
const largePayload = {
  npub: "npub1" + "a".repeat(50),
  sk: "b".repeat(64),
  relays: Array.from({ length: 20 }, (_, i) => "wss://relay-" + i + ".test.com"),
};
const largeEnv = await encryptVault(largePayload, pin);
const largeDec = await decryptVault(largeEnv, pin);
assert(largeDec.relays.length === 20, "Large payload round-trips correctly");

console.log("\n=== Results: " + passed + " passed, " + failed + " failed ===");
if (failed > 0) process.exit(1);
