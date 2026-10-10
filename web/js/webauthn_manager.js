/* webauthn_manager.js — Platform authenticator (biometric) via WebAuthn */

const CREDENTIAL_ID_KEY = "dl_conn_webauthn_cred";
const PRF_SALT_KEY = "dl_conn_webauthn_prf_salt";

/**
 * Compute a valid `rp.id` for WebAuthn. WebAuthn rejects IP addresses and
 * ports in `rp.id`; on `localhost` only the literal string is allowed. We
 * omit the field entirely when the hostname is unsuitable (an IP, or empty)
 * and let the browser fall back to the origin's effective domain — which is
 * what we want for trycloudflare subdomains and works on Android Chrome.
 *
 * @returns {string|undefined}
 */
function getRpId() {
  // jsdom and friends don't always expose `location`; the absent-host case
  // is also the safest "do nothing" stance.
  if (typeof location === "undefined" || !location.hostname) return undefined;
  const host = location.hostname;
  // IPv4 (with optional zone) and IPv6 — neither is a valid rp.id.
  if (/^[0-9.]+$/.test(host)) return undefined;
  if (host.includes(":")) return undefined; // bare IPv6 (no brackets in hostname)
  return host;
}

function toBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Checks whether the device supports platform biometrics (fingerprint, face,
 * Windows Hello, Android BiometricPrompt, etc.).
 * @returns {Promise<boolean>}
 */
export async function isBiometricAvailable() {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Probe whether the platform authenticator advertises the PRF extension
 * (WebAuthn Level 3). We try `getClientCapabilities()` first (modern Chrome,
 * recent Safari); if unavailable we optimistically assume PRF may work —
 * `registerCredential` will surface the unsupported case by returning
 * `prfSupported: false` instead of throwing.
 *
 * @returns {Promise<boolean>}
 */
export async function isPrfAvailable() {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
  if (typeof PublicKeyCredential.getClientCapabilities !== "function") return false;
  try {
    const caps = await PublicKeyCredential.getClientCapabilities();
    // WebAuthn client capabilities are a flat map. Extension names use the
    // `extension:` prefix; client support is only a hint because the selected
    // authenticator can still decline the extension.
    return caps && caps["extension:prf"] === true;
  } catch {
    return false;
  }
}

/**
 * Register a platform authenticator credential tied to the user's npub.
 * If `prfSalt` is provided, asks the authenticator for a PRF evaluation so
 * the resulting output can be used to derive a vault key (biometric unlock
 * without PIN). The salt is persisted so the same output can be reproduced
 * on subsequent unlocks.
 *
 * @param {string} npub — user's public key for user.id
 * @param {Uint8Array} [prfSalt] — 32-byte salt for the PRF extension
 * @returns {Promise<{credentialId: string, prfSupported: boolean, prfOutput: Uint8Array|null}>}
 */
export async function registerCredential(npub, prfSalt) {
  if (typeof window === "undefined" || !window.PublicKeyCredential) {
    throw new Error("WebAuthn not supported in this browser");
  }
  if (!navigator.credentials || !navigator.credentials.create) {
    throw new Error("navigator.credentials.create indisponível");
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = new TextEncoder().encode(npub.slice(0, 32));

  const rp = { name: "dl_conn" };
  const rpId = getRpId();
  if (rpId) rp.id = rpId;

  const publicKey = {
    challenge,
    rp,
    user: {
      id: userId,
      name: npub,
      displayName: npub.slice(0, 12) + "..." + npub.slice(-8),
    },
    pubKeyCredParams: [
      { alg: -7, type: "public-key" },   // ES256
      { alg: -257, type: "public-key" },  // RS256
    ],
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      userVerification: "required",
      residentKey: "preferred",
    },
    timeout: 60000,
    attestation: "none",
  };
  if (prfSalt) {
    publicKey.extensions = { prf: { eval: { first: prfSalt } } };
  }

  const credential = await navigator.credentials.create({ publicKey });

  const credentialId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));

  // The PRF output, when the authenticator supports the extension, is the
  // exact same 32 bytes the same (credential, salt) pair will produce on
  // every future assertion — that's what makes it a vault key. Persist only
  // after the whole enrollment is known to be usable; a failed PRF attempt
  // must not replace an existing credential.
  let prfOutput = null;
  let prfSupported = false;
  if (prfSalt) {
    const ext = credential.getClientExtensionResults && credential.getClientExtensionResults();
    if (ext && ext.prf && ext.prf.enabled === true && ext.prf.results && ext.prf.results.first) {
      prfOutput = new Uint8Array(ext.prf.results.first);
      prfSupported = true;
      localStorage.setItem(CREDENTIAL_ID_KEY, credentialId);
      localStorage.setItem(PRF_SALT_KEY, btoa(String.fromCharCode(...prfSalt)));
    }
  } else {
    localStorage.setItem(CREDENTIAL_ID_KEY, credentialId);
    localStorage.removeItem(PRF_SALT_KEY);
  }

  return { credentialId, prfSupported, prfOutput };
}

/**
 * Authenticate via biometric. If a PRF salt was previously registered, asks
 * the authenticator for a PRF evaluation as well, so the caller can derive
 * the vault key without ever holding a PIN in memory.
 *
 * @returns {Promise<{verified: boolean, credentialId?: string, prfOutput: Uint8Array|null, error?: string}>}
 */
export async function authenticateBiometric() {
  const storedId = localStorage.getItem(CREDENTIAL_ID_KEY);
  if (!storedId) return { verified: false };
  const storedPrfSalt = localStorage.getItem(PRF_SALT_KEY);

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const rawId = Uint8Array.from(atob(storedId), (c) => c.charCodeAt(0));
  const prfSalt = storedPrfSalt
    ? Uint8Array.from(atob(storedPrfSalt), (c) => c.charCodeAt(0))
    : null;

  const publicKey = {
    challenge,
    allowCredentials: [{ id: rawId, type: "public-key" }],
    userVerification: "required",
    timeout: 60000,
  };
  if (prfSalt) {
    publicKey.extensions = {
      prf: {
        evalByCredential: {
          [toBase64Url(rawId)]: { first: prfSalt },
        },
      },
    };
  }

  try {
    const assertion = await navigator.credentials.get({ publicKey });
    let prfOutput = null;
    if (prfSalt) {
      const ext = assertion.getClientExtensionResults && assertion.getClientExtensionResults();
      if (ext && ext.prf && ext.prf.results && ext.prf.results.first) {
        prfOutput = new Uint8Array(ext.prf.results.first);
      }
    }
    return { verified: true, credentialId: storedId, prfOutput };
  } catch (err) {
    // User cancelled or error
    return { verified: false, error: err && err.message ? err.message : String(err) };
  }
}

/**
 * Check if a biometric credential is registered locally.
 */
export function hasCredential() {
  return localStorage.getItem(CREDENTIAL_ID_KEY) !== null;
}

/**
 * True when the stored credential is paired with a PRF salt — the only mode
 * in which biometric unlock can survive a page reload without falling back
 * to an in-memory PIN.
 */
export function hasPrfCredential() {
  return hasCredential() && localStorage.getItem(PRF_SALT_KEY) !== null;
}

/**
 * Remove stored biometric credential (both the credential id and the
 * paired PRF salt, so a re-enrollment doesn't inherit a stale one).
 */
export function removeCredential() {
  localStorage.removeItem(CREDENTIAL_ID_KEY);
  localStorage.removeItem(PRF_SALT_KEY);
}
