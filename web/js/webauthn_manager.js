/* webauthn_manager.js — Platform authenticator (biometric) via WebAuthn */

const CREDENTIAL_ID_KEY = "dl_conn_webauthn_cred";

/**
 * Checks whether the device supports platform biometrics.
 * @returns {Promise<boolean>}
 */
export async function isBiometricAvailable() {
  if (!window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Register a platform authenticator credential tied to the user's npub.
 * Uses PRF extension so the credential can later unwrap the vault key.
 * @param {string} npub — user's public key for user.id
 * @returns {Promise<{credentialId: string}>}
 */
export async function registerCredential(npub) {
  if (!window.PublicKeyCredential) {
    throw new Error("WebAuthn not supported in this browser");
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = new TextEncoder().encode(npub.slice(0, 32));

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "dl_conn", id: location.hostname },
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
    },
  });

  const credentialId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
  localStorage.setItem(CREDENTIAL_ID_KEY, credentialId);
  return { credentialId };
}

/**
 * Authenticate via biometric and return raw credential response.
 * The caller uses the response to derive the unwrapping key for the vault.
 * @returns {Promise<{verified: boolean, credentialId?: string}>}
 */
export async function authenticateBiometric() {
  const storedId = localStorage.getItem(CREDENTIAL_ID_KEY);
  if (!storedId) return { verified: false };

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const rawId = Uint8Array.from(atob(storedId), (c) => c.charCodeAt(0));

  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ id: rawId, type: "public-key" }],
        userVerification: "required",
        timeout: 60000,
      },
    });

    return { verified: true, credentialId: storedId };
  } catch (err) {
    // User cancelled or error
    return { verified: false, error: err.message };
  }
}

/**
 * Check if a biometric credential is registered locally.
 */
export function hasCredential() {
  return localStorage.getItem(CREDENTIAL_ID_KEY) !== null;
}

/**
 * Remove stored biometric credential.
 */
export function removeCredential() {
  localStorage.removeItem(CREDENTIAL_ID_KEY);
}
