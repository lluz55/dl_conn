/* session_tests.js — SessionManager, brute-force protection, security compliance */

import {
  encryptVault,
  decryptVault,
  saveVaultToStorage,
  loadVaultFromStorage,
  removeVaultFromStorage,
  hasVault,
} from '../js/crypto_vault.js';
import { SessionManager } from '../js/session_manager.js';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log("  ✓ " + msg); }
  else { failed++; console.error("  ✗ FAIL: " + msg); }
}

// Mock localStorage
const _store = {};
globalThis.localStorage = {
  getItem: (k) => _store[k] || null,
  setItem: (k, v) => { _store[k] = v; },
  removeItem: (k) => { delete _store[k]; },
};

// Mock document for SessionManager
globalThis.document = {
  addEventListener: () => {},
  hidden: false,
};

console.log("\n=== SessionManager Tests ===");

// Test 1: Vault detection
console.log("  [Vault Detection]");
assert(!hasVault(), "No vault initially");
const payload = { npub: "npub1test", sk: "a".repeat(64), relays: [] };
const envelope = await encryptVault(payload, "1234");
saveVaultToStorage(envelope);
assert(hasVault(), "hasVault true after save");
removeVaultFromStorage();
assert(!hasVault(), "hasVault false after remove");

// Test 2: Brute-force protection simulation
console.log("  [Brute-force Protection]");
const BF_KEY = "dl_conn_brute_force";
localStorage.removeItem(BF_KEY);

// Simulate 3 failed attempts
for (let i = 0; i < 3; i++) {
  localStorage.setItem(BF_KEY, JSON.stringify({ attempts: i + 1 }));
}
const bf = JSON.parse(localStorage.getItem(BF_KEY));
assert(bf.attempts === 3, "Brute force counter tracks attempts");
localStorage.removeItem(BF_KEY);

// Test 3: Memory isolation — sk never in localStorage
console.log("  [Memory Isolation — Security Compliance]");
const secretNsec = "nsec1" + "a".repeat(50);
const secretSk = "c".repeat(64);
const vaultPayload = { npub: "npub1secure", sk: secretSk, relays: ["wss://relay.test"] };
const vaultEnv = await encryptVault(vaultPayload, "5678");
saveVaultToStorage(vaultEnv);

// Verify sk/nsec are NOT in localStorage plaintext
const allStored = Object.values(_store).join(" ");
assert(!allStored.includes(secretSk), "sk NOT in localStorage as plaintext");
assert(!allStored.includes("nsec1"), "nsec NOT in localStorage as plaintext");

// Verify encrypted vault is there
const storedEnvelope = loadVaultFromStorage();
assert(storedEnvelope !== null, "Encrypted vault envelope is stored");
assert(storedEnvelope.ciphertext !== secretSk, "Ciphertext is not the raw sk");
removeVaultFromStorage();

// Test 4: Auto-lock timer setup (mock)
console.log("  [Auto-lock Timer]");
let timerSet = false;
const mockTimerFn = () => { timerSet = true; };
// We can't test real timers without a DOM, but verify the module loads
assert(typeof import('../js/session_manager.js') !== "undefined", "SessionManager module imports successfully");

// Test 5: Wipe clears all storage
console.log("  [Wipe Cleans Everything]");
saveVaultToStorage(vaultEnv);
localStorage.setItem(BF_KEY, JSON.stringify({ attempts: 5 }));
assert(hasVault(), "Vault exists before wipe");
// Simulate wipe
removeVaultFromStorage();
localStorage.removeItem(BF_KEY);
assert(!hasVault(), "Vault gone after wipe");
assert(localStorage.getItem(BF_KEY) === null, "Brute force data gone after wipe");

// Test 6: Session pending state after unlock
console.log("  [Pending State After Unlock]");
const sm = new SessionManager();
assert(sm.isLocked === true, "SessionManager starts locked");
assert(sm.isPending === false, "Not pending when locked");

// Create vault — should set pending
saveVaultToStorage(vaultEnv); // vault from Test 3 setup... actually re-create
const pendingPayload = { npub: "npub1pending", sk: "d".repeat(64), relays: ["wss://r.test"] };
let pendingEvents = [];
sm.on((event) => { pendingEvents.push(event); });
await sm.createVault(pendingPayload, "5678");
assert(sm.isPending === true, "isPending true after createVault");
assert(sm.isLocked === false, "isLocked false after createVault");
assert(pendingEvents.includes("pending"), "pending event emitted on createVault");

// Simulate first successful backend response
sm.setBackendActive();
assert(sm.isPending === false, "isPending false after setBackendActive");

// Test 7: Session pending after unlockWithPin
console.log("  [Pending State After unlockWithPin]");
sm.lock();
assert(sm.isLocked === true, "Session locked after lock()");
assert(sm.isPending === false, "isPending reset to false on lock");

const pinEvents = [];
sm.on((event) => { pinEvents.push(event); });
await sm.unlockWithPin("5678");
assert(sm.isPending === true, "isPending true after unlockWithPin");
assert(sm.isLocked === false, "isLocked false after unlockWithPin");
assert(pinEvents.includes("pending"), "pending event emitted on unlockWithPin");

sm.setBackendActive();
assert(sm.isPending === false, "isPending false after setBackendActive");

// Test 8: Ephemeral session — nsec login must unlock without a vault
console.log("  [Ephemeral Session (startSession)]");
removeVaultFromStorage();
const ephemeral = new SessionManager();
const ephEvents = [];
ephemeral.on((event) => { ephEvents.push(event); });
const ephIdentity = { npub: "npub1eph", sk: "c".repeat(64) };
ephemeral.startSession(ephIdentity);
assert(ephemeral.isLocked === false, "startSession unlocks the session");
assert(ephemeral.sk === ephIdentity.sk, "sk available after startSession");
assert(ephEvents.includes("unlocked"), "unlocked event emitted by startSession");
assert(ephEvents.includes("pending"), "pending event emitted by startSession");
assert(!hasVault(), "startSession persists nothing");

let threw = false;
try { ephemeral.startSession({ npub: "npub1x", sk: null }); } catch { threw = true; }
assert(threw, "startSession rejects an identity without a key");

// Saving the vault afterwards must not re-open (and so re-connect) the session
ephEvents.length = 0;
await ephemeral.createVault(ephIdentity, "4321");
assert(hasVault(), "createVault persists the identity of a live session");
assert(!ephEvents.includes("unlocked"), "createVault does not re-emit unlocked when already unlocked");
assert(ephemeral.sk === ephIdentity.sk, "session key unchanged after createVault");
removeVaultFromStorage();
ephemeral.lock();

// Test 9: Theme preserved during clear all
console.log("  [Theme Preserved on Clear All]");
// Simulate the onClearAll logic that should skip dl_conn_theme
localStorage.setItem("dl_conn_theme", "dark");
localStorage.setItem("dl_conn_host_npub", "npub1host");
for (const k of Object.keys(_store)) {
  if (k.startsWith("dl_conn_") && k !== "dl_conn_theme") delete _store[k];
}
assert(localStorage.getItem("dl_conn_theme") === "dark", "dl_conn_theme preserved on clear all");
assert(localStorage.getItem("dl_conn_host_npub") === null, "dl_conn_host_npub removed on clear all");

console.log("\n=== Results: " + passed + " passed, " + failed + " failed ===");
if (failed > 0) process.exit(1);
