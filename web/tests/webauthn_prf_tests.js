/* webauthn_prf_tests.js — PRF extension integration for the vault
 *
 * Mocks the platform WebAuthn API so the test runs under plain Node (no
 * browser, no authenticator). The two flows under test are:
 *
 *   1. PRF-available path: enrolling captures a deterministic PRF output,
 *      the vault is encrypted with that output, and a later unlock with
 *      the same credential reproduces the output and decrypts the vault
 *      without ever asking for a PIN.
 *
 *   2. PRF-unavailable path: the same code degrades to the legacy PIN
 *      bridge — registering a credential still works, but unlock requires
 *      a fresh PIN because the in-memory `_bioPin` is gone after a reload.
 *
 * The mocks are kept minimal: only the surface `webauthn_manager.js` and
 * `session_manager.js` actually call into.
 */

import { SessionManager } from '../js/session_manager.js';
import {
  encryptVault,
  decryptVault,
  encryptVaultPrf,
  decryptVaultPrf,
  saveVaultToStorage,
  loadVaultFromStorage,
  loadBiometricVaultFromStorage,
  removeVaultFromStorage,
  hasVault,
  hasBiometricVault,
} from '../js/crypto_vault.js';
import {
  isBiometricAvailable,
  isPrfAvailable,
  registerCredential,
  authenticateBiometric,
  hasCredential,
  hasPrfCredential,
  removeCredential,
} from '../js/webauthn_manager.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log("  ✓ " + msg); }
  else { failed++; console.error("  ✗ FAIL: " + msg); }
}

// ── localStorage / document / crypto shims ────────────────────
const _store = {};
globalThis.localStorage = {
  getItem: (k) => (k in _store ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; },
};
globalThis.document = {
  addEventListener: () => {},
  hidden: false,
};
// `location` is what webauthn_manager.js inspects for the rp.id. jsdom
// isn't loaded here, so a minimal stand-in is enough.
globalThis.location = { hostname: "dl-conn.test" };

// Node 18+ exposes webcrypto on globalThis.crypto; older runs need the
// experimental import. The test runner is Node 24 in this repo, so this
// is just a guard.
if (typeof globalThis.crypto === "undefined" || !globalThis.crypto.subtle) {
  const { webcrypto } = await import("node:crypto");
  globalThis.crypto = webcrypto;
}

// ── WebAuthn mocks ─────────────────────────────────────────────
// The "authenticator" is a tiny in-memory store keyed by credential id.
// It records whether each credential advertises the PRF extension and,
// for the PRF-capable one, returns a deterministic 32-byte output for any
// (credential, salt) pair. That output is what the vault key is derived
// from in production code.
const authenticator = (() => {
  // Map key is the Base64 form of the credential id — the same string
  // webauthn_manager.js writes to localStorage and reads back, so
  // round-trip lookups don't depend on Uint8Array reference identity.
  const creds = new Map(); // b64 id -> { idBytes, prf: bool }
  let nextId = 1;
  let _bio = true;   // isUserVerifyingPlatformAuthenticatorAvailable()
  let _prf = true;   // getClientCapabilities()["extension:prf"]
  const toB64 = (u8) => Buffer.from(u8).toString("base64");
  return {
    setBiometric(on) { _bio = !!on; },
    setPrf(on) { _prf = !!on; },
    reset() { creds.clear(); nextId = 1; _bio = true; _prf = true; },
    isBiometric() { return _bio; },
    isPrf() { return _prf; },
    has(idBytes) { return creds.has(toB64(idBytes)); },
    credIsPrf(idBytes) { const c = creds.get(toB64(idBytes)); return !!(c && c.prf); },
    register(prf) {
      const id = new Uint8Array(32);
      // Stable id: derived from a counter so tests can compare values
      // across runs. Production ids are random — the mock just needs a
      // distinct, fixed-length byte string.
      const n = nextId++;
      for (let i = 0; i < 4; i++) id[i] = (n >>> (i * 8)) & 0xff;
      creds.set(toB64(id), { idBytes: id, prf });
      return id;
    },
    /**
     * Compute the PRF output for (id, salt) — deterministic in the mock
     * so the same input always yields the same key, matching WebAuthn's
     * contract. SHA-256(id || salt) is a stand-in for the real
     * HMAC-based PRF the authenticator would produce.
     */
    async prf(idBytes, salt) {
      const c = creds.get(toB64(idBytes));
      if (!c || !c.prf) return null;
      const data = new Uint8Array(idBytes.length + salt.length);
      data.set(idBytes, 0); data.set(salt, idBytes.length);
      const hash = await crypto.subtle.digest("SHA-256", data);
      return new Uint8Array(hash);
    },
  };
})();

authenticator.reset();

// isUserVerifyingPlatformAuthenticatorAvailable
class PublicKeyCredential {
  static async isUserVerifyingPlatformAuthenticatorAvailable() {
    return authenticator.isBiometric();
  }
  static async getClientCapabilities() {
    return { "extension:prf": authenticator.isPrf() };
  }
}
Object.defineProperty(globalThis, "PublicKeyCredential", {
  configurable: true,
  value: PublicKeyCredential,
});
globalThis.window = { PublicKeyCredential };

// navigator.credentials
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    credentials: {
      async create({ publicKey }) {
        if (!publicKey) throw new Error("missing publicKey");
        const wantsPrf = !!(publicKey.extensions && publicKey.extensions.prf);
        const id = authenticator.register(wantsPrf && authenticator.isPrf());
        const prfSalt = wantsPrf && publicKey.extensions.prf.eval.first;
        const extResults = {};
        if (wantsPrf && authenticator.isPrf() && prfSalt) {
          const out = await authenticator.prf(id, new Uint8Array(prfSalt));
          extResults.prf = { enabled: true, results: { first: out } };
        } else if (wantsPrf) {
          extResults.prf = { enabled: false };
        }
        return {
          rawId: id.buffer,
          getClientExtensionResults: () => extResults,
          response: { clientDataJSON: new ArrayBuffer(0), attestationObject: new ArrayBuffer(0) },
        };
      },
      async get({ publicKey }) {
        const allow = publicKey.allowCredentials && publicKey.allowCredentials[0];
        if (!allow) throw new Error("no allowCredentials");
        const id = new Uint8Array(allow.id);
        if (!authenticator.has(id)) throw new Error("Unknown credential");
        const wantsPrf = !!(publicKey.extensions && publicKey.extensions.prf);
        const extResults = {};
        if (wantsPrf && authenticator.credIsPrf(id)) {
          const evals = publicKey.extensions.prf.evalByCredential;
          const prfSalt = Object.values(evals)[0].first;
          const out = await authenticator.prf(id, new Uint8Array(prfSalt));
          if (out) extResults.prf = { results: { first: out } };
        }
        return {
          rawId: id.buffer,
          getClientExtensionResults: () => extResults,
          response: { clientDataJSON: new ArrayBuffer(0), authenticatorData: new ArrayBuffer(0), signature: new ArrayBuffer(0) },
        };
      },
    },
  },
});

// ── Helpers ────────────────────────────────────────────────────
const _identity = () => ({
  npub: "npub1prf" + "x".repeat(50),
  sk: "1".repeat(64),
  relays: ["wss://relay.example"],
});

function clearAll() {
  removeVaultFromStorage();
  removeCredential();
  authenticator.reset();
  for (const k of Object.keys(_store)) delete _store[k];
  authenticator.setBiometric(true);
  authenticator.setPrf(true);
}

console.log("\n=== WebAuthn PRF Tests ===");

// ── 1. Capability detection ───────────────────────────────────
console.log("  [Capability detection]");

{
  clearAll();
  authenticator.setBiometric(true); authenticator.setPrf(true);
  assert(await isBiometricAvailable() === true, "platform authenticator available");
  assert(await isPrfAvailable() === true, "PRF advertised as available");
}

{
  clearAll();
  authenticator.setBiometric(false); authenticator.setPrf(false);
  assert(await isBiometricAvailable() === false, "no biometric → isBiometricAvailable false");
  assert(await isPrfAvailable() === false, "no biometric → isPrfAvailable false");
}

{
  clearAll();
  authenticator.setBiometric(true); authenticator.setPrf(false);
  assert(await isBiometricAvailable() === true, "biometric yes, PRF no: base check true");
  assert(await isPrfAvailable() === false, "biometric yes, PRF no: PRF check false");
}

// ── 2. PRF enrollment + unlock round-trip ─────────────────────
console.log("  [PRF enrollment + unlock]");

{
  clearAll();
  authenticator.reset();
  authenticator.setBiometric(true); authenticator.setPrf(true);

  const sm = new SessionManager();
  // Drive enrollment through the public API: create a PIN vault first,
  // then turn on biometric. The session is unlocked by `createVault`.
  await sm.createVault(_identity(), "1234");
  assert(loadVaultFromStorage().mode === undefined, "PIN recovery vault is created first");
  await sm.enableBiometric("1234");
  const env = loadBiometricVaultFromStorage();
  assert(env.mode === "prf", "biometric sidecar is created after enableBiometric");
  assert(loadVaultFromStorage().mode === undefined, "PIN recovery vault is preserved");
  assert(hasPrfCredential(), "WebAuthn credential is paired with a PRF salt");

  // Simulate a page reload: drop the in-memory session and re-construct
  // the manager. The vault envelope and the PRF salt survive, the
  // in-memory `_bioPin` does not.
  sm.lock();
  const sm2 = new SessionManager();
  assert(sm2.isLocked === true, "session re-locks after construction");
  assert(await sm2.canUseBiometric() === true, "biometric is offered after reload");

  // Unlock through biometrics alone — no PIN input.
  await sm2.unlockWithBiometric();
  assert(sm2.isLocked === false, "PRF unlock opens the session");
  assert(sm2.npub === _identity().npub, "decrypted npub matches the original");
  assert(sm2.sk === _identity().sk, "decrypted sk matches the original");
  assert(JSON.stringify(sm2.relays) === JSON.stringify(_identity().relays),
    "decrypted relays match the original");
}

// ── 3. Legacy PIN-bridge fallback when PRF is absent ──────────
console.log("  [Legacy PIN-bridge fallback]");

{
  clearAll();
  authenticator.reset();
  // Biometric on, PRF off — the legacy path. The session manager
  // should fall back to the in-memory PIN bridge.
  authenticator.setBiometric(true); authenticator.setPrf(false);

  const sm = new SessionManager();
  await sm.createVault(_identity(), "5678");
  await sm.enableBiometric("5678");
  assert(loadVaultFromStorage().mode === undefined,
    "PIN recovery vault stays unchanged when authenticator lacks PRF");
  assert(hasCredential() && !hasPrfCredential(),
    "credential is registered but no PRF salt is paired");

  // Same-page unlock works because the PIN bridge is in memory.
  sm.lock();
  const sm2 = new SessionManager(); // fresh JS heap — `_bioPin` is gone
  assert(sm2.isLocked === true, "session re-locks");
  // `canUseBiometric` returns true because the credential is registered
  // and the platform still supports user verification.
  assert(await sm2.canUseBiometric() === true,
    "biometric button is still offered without PRF");
  let threw = false;
  try { await sm2.unlockWithBiometric(); } catch { threw = true; }
  assert(threw,
    "biometric without in-memory PIN throws (the documented legacy limitation)");
  // PIN still works as a fallback — the user re-types it and is in.
  await sm2.unlockWithPin("5678");
  assert(sm2.isLocked === false, "PIN fallback opens the session");
}

// ── 4. enroll without a session is refused ───────────────────
console.log("  [Enrollment guard]");

{
  clearAll();
  authenticator.reset();
  authenticator.setBiometric(true); authenticator.setPrf(true);
  const sm = new SessionManager();
  let threw = false;
  try { await sm.enableBiometric("1234"); } catch (err) {
    threw = err.message.includes("Desbloqueie");
  }
  assert(threw, "enableBiometric refuses to enroll without an unlocked session");
}

// ── 5. PIN recovery remains valid after PRF enrollment ────────
console.log("  [PIN recovery after PRF enrollment]");

{
  clearAll();
  authenticator.reset();
  authenticator.setBiometric(true); authenticator.setPrf(true);

  const sm = new SessionManager();
  await sm.createVault(_identity(), "1234");
  await sm.enableBiometric("1234");
  assert(hasBiometricVault(), "biometric sidecar exists");

  sm.lock();
  await sm.unlockWithPin("1234");
  assert(sm.isLocked === false, "PIN recovery still opens the primary vault");
}

// ── 6. Wipe clears the credential, the salt, and the envelope ─
console.log("  [Wipe]");

{
  clearAll();
  authenticator.reset();
  authenticator.setBiometric(true); authenticator.setPrf(true);

  const sm = new SessionManager();
  await sm.createVault(_identity(), "1234");
  await sm.enableBiometric("1234");
  assert(hasVault() && hasBiometricVault() && hasPrfCredential(),
    "enrollment populated PIN vault, biometric sidecar and credential metadata");

  sm.wipe();
  assert(!hasVault(), "PIN vault removed on wipe");
  assert(!hasBiometricVault(), "biometric sidecar removed on wipe");
  assert(!hasPrfCredential(), "PRF credential + salt removed on wipe");
  assert(!hasCredential(), "credential id alone also removed");
}

// ── 7. PRF crypto round-trip via the public vault API ─────────
console.log("  [PRF crypto round-trip]");

{
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const fakePrf = crypto.getRandomValues(new Uint8Array(32));
  const env = await encryptVaultPrf({ npub: "npub1x", sk: "a".repeat(64) }, fakePrf, salt);
  assert(env.mode === "prf", "envelope carries mode: prf");
  assert(typeof env.vaultSalt === "string", "envelope has its own HKDF salt");

  // Wrong PRF output should fail the auth tag check.
  let wrongFailed = false;
  try {
    await decryptVaultPrf(env, crypto.getRandomValues(new Uint8Array(32)));
  } catch { wrongFailed = true; }
  assert(wrongFailed, "wrong PRF output fails to decrypt");

  const dec = await decryptVaultPrf(env, fakePrf);
  assert(dec.npub === "npub1x" && dec.sk === "a".repeat(64), "right PRF output decrypts");
}

// ── 8. Re-enrollment re-encrypts under a new PRF key ──────────
console.log("  [Re-enrollment]");

{
  clearAll();
  authenticator.reset();
  authenticator.setBiometric(true); authenticator.setPrf(true);

  const sm = new SessionManager();
  await sm.createVault(_identity(), "1234");
  await sm.enableBiometric("1234");
  const firstEnv = loadBiometricVaultFromStorage();
  const firstCiphertext = firstEnv.ciphertext;

  // Unlock, then re-enroll: the new PRF salt must produce a different
  // ciphertext (proves the encryption is actually tied to the new key).
  sm.lock();
  // Re-unlock the first time to populate memory.
  const sm2 = new SessionManager();
  await sm2.unlockWithBiometric();
  await sm2.enableBiometric("1234");
  const secondEnv = loadBiometricVaultFromStorage();
  assert(secondEnv.mode === "prf", "biometric sidecar remains PRF after re-enroll");
  assert(secondEnv.ciphertext !== firstCiphertext,
    "re-enrollment rotates the ciphertext");
  assert(secondEnv.prfSalt !== firstEnv.prfSalt,
    "re-enrollment rotates the PRF salt");
}

console.log("\n=== Results: " + passed + " passed, " + failed + " failed ===");
// SessionManager instances arm real inactivity timers; terminate explicitly
// instead of keeping the Node test process alive for 15 minutes.
process.exit(failed > 0 ? 1 : 0);
