/* session_manager.js — In-memory session, auto-lock, brute-force protection */

import {
  encryptVault,
  decryptVault,
  saveVaultToStorage,
  loadVaultFromStorage,
  removeVaultFromStorage,
  hasVault,
} from './crypto_vault.js';
import {
  isBiometricAvailable,
  registerCredential,
  authenticateBiometric,
  hasCredential,
  removeCredential,
} from './webauthn_manager.js';

const DEFAULT_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 min
const STORAGE_KEY_TIMEOUT = "dl_conn_auto_lock_timeout";
const MAX_ATTEMPTS = 10;
const LOCKOUT_THRESHOLD = 3; // exponential delay starts after 3 failures
const BRUTE_FORCE_KEY = "dl_conn_brute_force";

export class SessionManager {
  constructor() {
    /** @private */ this._sk = null;
    /** @private */ this._npub = null;
    /** @private */ this._relays = null;
    /** @private */ this._timer = null;
    /** @private */ this._listeners = [];
    /** @private */ this._locked = true;
    /** @private In-memory only — never persisted. See unlockWithBiometric(). */
    this._bioPin = null;
    /** @private Session is "pending" until first successful backend contact. */
    this._pendingBackend = false;
    /** @private */ this._inactivityTimeoutMs = this._loadTimeout();

    this._resetTimer();
    this._bindVisibility();
  }

  /* ── Timeout configuration ─────────────────────────────────── */

  /** Load timeout from localStorage (in minutes), return ms */
  _loadTimeout() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_TIMEOUT);
      if (saved !== null) {
        const minutes = parseInt(saved, 10);
        if (minutes === 0) return 0; // disabled
        if (minutes > 0) return minutes * 60 * 1000;
      }
    } catch { /* ignore */ }
    return DEFAULT_INACTIVITY_TIMEOUT_MS;
  }

  /** Get current timeout in minutes (0 = disabled) */
  get inactivityTimeoutMinutes() {
    return this._inactivityTimeoutMs / (60 * 1000);
  }

  /** Set timeout in minutes (0 = disabled) */
  setInactivityTimeout(minutes) {
    if (minutes === 0) {
      this._inactivityTimeoutMs = 0;
    } else if (minutes > 0) {
      this._inactivityTimeoutMs = minutes * 60 * 1000;
    }
    localStorage.setItem(STORAGE_KEY_TIMEOUT, String(minutes));
    this._resetTimer();
  }

  /* ── State ─────────────────────────────────────────────────── */

  get isLocked() { return this._locked; }
  get hasVault() { return hasVault(); }
  get npub() { return this._npub; }
  get sk() { return this._sk; }
  get relays() { return this._relays; }
  /** True when the session is unlocked but has not yet completed its first
   *  successful round-trip to the backend (Nostr discovery response). */
  get isPending() { return this._pendingBackend; }

  /** Get public hint from vault (npub preview) without unlocking */
  getVaultHint() {
    const envelope = loadVaultFromStorage();
    return envelope ? envelope.publicHint : null;
  }

  /** Biometric capability */
  async canUseBiometric() {
    if (!hasCredential()) return false;
    return isBiometricAvailable();
  }

  /**
   * True when biometric unlock could be turned on but isn't yet — the
   * platform supports it and the user hasn't already enrolled a credential.
   * Drives the "enable biometric" offer shown after a plain PIN unlock/login
   * for someone who declined it (or wasn't offered it) during vault setup.
   */
  async canEnableBiometric() {
    if (hasCredential()) return false;
    return isBiometricAvailable();
  }

  /* ── Vault creation ────────────────────────────────────────── */

  /**
   * Create a new encrypted vault for the given identity.
   * @param {{npub: string, sk: string, relays?: string[]}} identity
   * @param {string} pin
   */
  async createVault(identity, pin) {
    await this.saveVault(identity, pin);
    // A session opened by startSession() is already unlocked with this very
    // key; re-emitting "unlocked" would tear down and redo the live Nostr
    // connection for nothing.
    if (this._locked) this.startSession(identity);
  }

  /**
   * Encrypt an identity under `pin` and persist it, without touching the
   * in-memory session state. Splitting this out lets an already-open session
   * be saved after the fact.
   * @param {{npub: string, sk: string, relays?: string[]}} identity
   * @param {string} pin
   */
  async saveVault(identity, pin) {
    const payload = {
      npub: identity.npub,
      sk: identity.sk,
      relays: identity.relays || [],
    };

    const envelope = await encryptVault(payload, pin);
    saveVaultToStorage(envelope);
  }

  /* ── Ephemeral session (no vault) ──────────────────────────── */

  /**
   * Open an unlocked session for an identity without persisting anything.
   * The key lives in memory only and is gone on reload — creating a vault
   * (see createVault) is the separate, optional step that makes it survive.
   *
   * This exists so that entering an nsec is enough to reach the services:
   * discovery is driven by the "unlocked" event, so a login that only stashed
   * the identity aside left the app silently idle.
   *
   * @param {{npub: string, sk: string, relays?: string[]}} identity
   */
  startSession(identity) {
    if (!identity || !identity.sk || !identity.npub) {
      throw new Error("Identidade incompleta");
    }
    this._sk = identity.sk;
    this._npub = identity.npub;
    this._relays = identity.relays || [];
    this._locked = false;
    this._pendingBackend = true; // await first successful backend contact
    this._resetTimer();
    this._emit("unlocked");
    this._emit("pending");
  }

  /* ── Unlock with PIN ───────────────────────────────────────── */

  async unlockWithPin(pin) {
    const envelope = loadVaultFromStorage();
    if (!envelope) throw new Error("No vault found");

    const { attempts, lockoutUntil } = this._getBruteForce();
    if (lockoutUntil && Date.now() < lockoutUntil) {
      const secs = Math.ceil((lockoutUntil - Date.now()) / 1000);
      throw new Error("Locked. Try again in " + secs + "s");
    }

    try {
      const payload = await decryptVault(envelope, pin);
      this._sk = payload.sk;
      this._npub = payload.npub;
      this._relays = payload.relays || [];
      this._locked = false;
      this._pendingBackend = true; // await first successful backend contact
      this._resetBruteForce();
      this._resetTimer();
      this._emit("unlocked");
      this._emit("pending");
      return true;
    } catch (err) {
      this._recordFailedAttempt();
      throw new Error("Wrong PIN");
    }
  }

  /* ── Unlock with biometrics ────────────────────────────────── */

  async unlockWithBiometric() {
    const result = await authenticateBiometric();
    if (!result.verified) throw new Error(result.error || "Biometric auth failed");

    // Biometric success → replay the PIN captured during enableBiometric().
    // The PRF extension isn't widely supported, so this bridges the gap. The
    // PIN lives in memory only (see _bioPin): persisting it would hand any
    // script on this origin the key that decrypts the vault, which defeats the
    // point of encrypting the vault at all. The cost is that biometric unlock
    // only works within a page session; after a reload the user enters the PIN
    // once more, which re-arms the bridge.
    if (this._bioPin) {
      return this.unlockWithPin(this._bioPin);
    }
    throw new Error("Desbloqueio biométrico requer o PIN uma vez após recarregar a página");
  }

  /**
   * Store a biometric-bridged PIN so biometrics can unlock the vault.
   * Called during vault setup when user enables biometric.
   */
  async enableBiometric(pin) {
    const available = await isBiometricAvailable();
    if (!available) throw new Error("Platform authenticator not available");

    const identity = this._npub || this._getVaultNpub();
    if (!identity) throw new Error("No identity to bind biometric to");

    await registerCredential(identity);
    this._bioPin = pin;
    this._emit("biometric-enabled");
  }

  /**
   * Called by the app when the session has completed its first successful
   * round-trip to the backend (e.g. a Nostr discovery response was received).
   * Transitions the session from the "pending" state to "active".
   */
  setBackendActive() {
    if (this._pendingBackend) {
      this._pendingBackend = false;
      this._emit("active");
    }
  }

  /* ── Lock / Wipe ───────────────────────────────────────────── */

  lock() {
    this._sk = null;
    this._npub = null;
    this._relays = null;
    this._locked = true;
    this._pendingBackend = false;
    this._clearTimer();
    this._emit("locked");
  }

  wipe() {
    this.lock();
    removeVaultFromStorage();
    removeCredential();
    this._bioPin = null;
    this._resetBruteForce();
    this._emit("wiped");
  }

  /* ── Timer / Inactivity ────────────────────────────────────── */

  _resetTimer() {
    this._clearTimer();
    if (this._locked) return;
    // If timeout is 0, auto-lock is disabled
    if (this._inactivityTimeoutMs === 0) return;
    this._timer = setTimeout(() => {
      this.lock();
      this._emit("auto-locked");
    }, this._inactivityTimeoutMs);
  }

  _clearTimer() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  _onActivity = () => {
    if (!this._locked) this._resetTimer();
  };

  _bindVisibility() {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && !this._locked) this._resetTimer();
    });
    ["pointerdown", "keydown", "touchstart"].forEach((evt) => {
      document.addEventListener(evt, this._onActivity, { passive: true });
    });
  }

  /* ── Brute-force protection ────────────────────────────────── */

  _getBruteForce() {
    try {
      return JSON.parse(localStorage.getItem(BRUTE_FORCE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  _recordFailedAttempt() {
    const bf = this._getBruteForce();
    const attempts = (bf.attempts || 0) + 1;

    if (attempts >= MAX_ATTEMPTS) {
      // Full wipe
      this.wipe();
      localStorage.removeItem(BRUTE_FORCE_KEY);
      throw new Error("Too many failures. Vault wiped for security.");
    }

    let lockoutUntil = null;
    if (attempts >= LOCKOUT_THRESHOLD) {
      const delay = Math.pow(2, attempts - LOCKOUT_THRESHOLD) * 1000; // 1s, 2s, 4s, 8s...
      lockoutUntil = Date.now() + Math.min(delay, 30000); // cap at 30s
    }

    localStorage.setItem(BRUTE_FORCE_KEY, JSON.stringify({ attempts, lockoutUntil }));
  }

  _resetBruteForce() {
    localStorage.removeItem(BRUTE_FORCE_KEY);
  }

  _getVaultNpub() {
    const envelope = loadVaultFromStorage();
    return envelope ? envelope.publicHint : null;
  }

  /* ── Event system ───────────────────────────────────────────── */

  on(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter((l) => l !== fn); };
  }

  _emit(event, data) {
    this._listeners.forEach((fn) => fn(event, data));
  }
}
