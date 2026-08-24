/* crypto_vault.js — Web Crypto API: PBKDF2 + AES-256-GCM encrypted vault */

const VAULT_KEY = "dl_conn_vault";
const PBKDF2_ITERATIONS = 300000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

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

/* ── Encrypt / Decrypt ─────────────────────────────────────── */

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

/* ── localStorage persistence ────────────────────────────────── */

export function saveVaultToStorage(envelope) {
  localStorage.setItem(VAULT_KEY, JSON.stringify(envelope));
}

export function loadVaultFromStorage() {
  const raw = localStorage.getItem(VAULT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function removeVaultFromStorage() {
  localStorage.removeItem(VAULT_KEY);
}

export function hasVault() {
  return localStorage.getItem(VAULT_KEY) !== null;
}
