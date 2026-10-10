/* crypto_vault.js — Web Crypto API: PBKDF2 + AES-256-GCM encrypted vault,
 * with an alternate mode that derives the AES key from a WebAuthn PRF
 * evaluation. The PRF mode is what lets the SPA unlock the vault on mobile
 * after a page reload, because no PIN has to be kept in memory: the
 * platform authenticator is the only thing that ever produces the key. */

const VAULT_KEY = "dl_conn_vault";
const BIOMETRIC_VAULT_KEY = "dl_conn_biometric_vault";
const PBKDF2_ITERATIONS = 300000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
/** Mode tag for the biometric sidecar encrypted from a PRF evaluation. */
const VAULT_MODE_PRF = "prf";

/* ── Helpers ─────────────────────────────────────────────────── */

function toBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function fromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function generateSalt() {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

function generateIv() {
  return crypto.getRandomValues(new Uint8Array(IV_BYTES));
}

/* ── Key derivation ─────────────────────────────────────────── */

async function deriveKey(pin, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Derive a non-extractable AES-GCM key from a WebAuthn PRF output. We use
 * HKDF-SHA256 so the same PRF output + the same salt produce the same
 * AES key on every unlock — but the raw PRF bytes never have to leave
 * the `crypto.subtle` boundary as an importable key.
 *
 * @param {Uint8Array} prfOutput — 32-byte PRF eval result
 * @param {Uint8Array} salt — 16-byte salt (stored alongside the vault)
 * @returns {Promise<CryptoKey>}
 */
async function derivePrfKey(prfOutput, salt) {
  if (!(prfOutput instanceof Uint8Array) || prfOutput.length < 16) {
    throw new Error("PRF output missing or too short");
  }
  if (!(salt instanceof Uint8Array) || salt.length < 16) {
    throw new Error("PRF key salt missing or too short");
  }
  // Import the PRF output as raw IKM. `extractable: false` keeps the bytes
  // pinned to `crypto.subtle`; we never want a Uint8Array view of the AES
  // key to escape this function.
  const ikm = await crypto.subtle.importKey(
    "raw",
    prfOutput,
    "HKDF",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      // The WebAuthn PRF output is already a uniformly random 32 bytes, but
      // a short, fixed info string is still good hygiene — it ties the
      // derived key to this application's vault and prevents the same PRF
      // output from being repurposed against another origin's crypto.
      info: new TextEncoder().encode("dl_conn/vault-key/v1"),
    },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/* ── Encrypt / Decrypt (PIN) ───────────────────────────────── */

/**
 * Encrypt a JSON-serializable payload with a PIN.
 * Returns serialized vault envelope: { salt, iv, ciphertext, publicHint }
 * All binary fields are Base64-encoded.
 */
export async function encryptVault(payload, pin) {
  const salt = generateSalt();
  const iv = generateIv();
  const key = await deriveKey(pin, salt);

  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(payload));

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext
  );

  // GCM appends the 16-byte auth tag to ciphertext
  const cipherArray = new Uint8Array(ciphertextBuffer);
  const authTag = cipherArray.slice(-16);
  const ciphertext = cipherArray.slice(0, -16);

  const envelope = {
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
    authTag: toBase64(authTag),
    publicHint: payload.npub ? payload.npub.slice(0, 12) + "..." + payload.npub.slice(-8) : null,
    createdAt: new Date().toISOString(),
  };

  return envelope;
}

/**
 * Decrypt a vault envelope with a PIN.
 * Returns the original payload object or throws on wrong PIN / corruption.
 */
export async function decryptVault(envelope, pin) {
  const salt = new Uint8Array(fromBase64(envelope.salt));
  const iv = new Uint8Array(fromBase64(envelope.iv));
  const key = await deriveKey(pin, salt);

  // Reassemble ciphertext + auth tag (AES-GCM expects them combined)
  const ciphertext = fromBase64(envelope.ciphertext);
  const authTag = fromBase64(envelope.authTag);
  const combined = new Uint8Array(ciphertext.byteLength + authTag.byteLength);
  combined.set(new Uint8Array(ciphertext), 0);
  combined.set(new Uint8Array(authTag), ciphertext.byteLength);

  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    combined
  );

  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(plaintextBuffer));
}

/* ── Encrypt / Decrypt (PRF) ───────────────────────────────── */

/**
 * Encrypt a payload with a key derived from a WebAuthn PRF evaluation.
 * The `prfSalt` itself is persisted (it's not a secret — the PRF output is
 * the secret, and that lives in the platform authenticator). The `vaultSalt`
 * is the HKDF salt; it's generated here and persisted in the envelope.
 *
 * @param {{npub: string, sk: string, relays?: string[]}} payload
 * @param {Uint8Array} prfOutput — 32-byte PRF eval result
 * @param {Uint8Array} prfSalt — the 32-byte salt the authenticator was
 *   evaluated with; persisted so the same eval can be replayed at unlock
 * @returns {Promise<object>}
 */
export async function encryptVaultPrf(payload, prfOutput, prfSalt) {
  const vaultSalt = generateSalt();
  const iv = generateIv();
  const key = await derivePrfKey(prfOutput, vaultSalt);

  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(payload));

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext
  );

  const cipherArray = new Uint8Array(ciphertextBuffer);
  const authTag = cipherArray.slice(-16);
  const ciphertext = cipherArray.slice(0, -16);

  return {
    mode: VAULT_MODE_PRF,
    prfSalt: toBase64(prfSalt),
    vaultSalt: toBase64(vaultSalt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
    authTag: toBase64(authTag),
    publicHint: payload.npub ? payload.npub.slice(0, 12) + "..." + payload.npub.slice(-8) : null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Decrypt a PRF-mode vault envelope using a fresh PRF evaluation. Throws
 * if the envelope isn't a PRF envelope or the auth tag doesn't match.
 *
 * @param {object} envelope
 * @param {Uint8Array} prfOutput — 32-byte PRF eval result from unlock
 * @returns {Promise<object>}
 */
export async function decryptVaultPrf(envelope, prfOutput) {
  if (!envelope || envelope.mode !== VAULT_MODE_PRF) {
    throw new Error("Envelope is not a PRF-mode vault");
  }
  const vaultSalt = new Uint8Array(fromBase64(envelope.vaultSalt));
  const iv = new Uint8Array(fromBase64(envelope.iv));
  const key = await derivePrfKey(prfOutput, vaultSalt);

  const ciphertext = fromBase64(envelope.ciphertext);
  const authTag = fromBase64(envelope.authTag);
  const combined = new Uint8Array(ciphertext.byteLength + authTag.byteLength);
  combined.set(new Uint8Array(ciphertext), 0);
  combined.set(new Uint8Array(authTag), ciphertext.byteLength);

  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    combined
  );

  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(plaintextBuffer));
}

/* ── localStorage persistence ────────────────────────────────── */

function loadEnvelope(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveVaultToStorage(envelope) {
  localStorage.setItem(VAULT_KEY, JSON.stringify(envelope));
}

export function loadVaultFromStorage() {
  return loadEnvelope(VAULT_KEY);
}

export function saveBiometricVaultToStorage(envelope) {
  localStorage.setItem(BIOMETRIC_VAULT_KEY, JSON.stringify(envelope));
}

export function loadBiometricVaultFromStorage() {
  return loadEnvelope(BIOMETRIC_VAULT_KEY);
}

export function removeVaultFromStorage() {
  localStorage.removeItem(VAULT_KEY);
  localStorage.removeItem(BIOMETRIC_VAULT_KEY);
}

export function hasVault() {
  return localStorage.getItem(VAULT_KEY) !== null;
}

export function hasBiometricVault() {
  return localStorage.getItem(BIOMETRIC_VAULT_KEY) !== null;
}
