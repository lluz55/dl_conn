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

const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 min
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

    this._resetTimer();
    this._bindVisibility();
  }

  /* ── State ─────────────────────────────────────────────────── */

  get isLocked() { return this._locked; }
  get hasVault() { return hasVault(); }
  get npub() { return this._npub; }
  get sk() { return this._sk; }
  get relays() { return this._relays; }

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

  /* ── Vault creation ────────────────────────────────────────── */

  /**
   * Create a new encrypted vault for the given identity.
   * @param {{npub: string, sk: string, relays?: string[]}} identity
   * @param {string} pin
   */
  async createVault(identity, pin) {
    const payload = {
      npub: identity.npub,
      sk: identity.sk,
      relays: identity.relays || [],
    };

    const envelope = await encryptVault(payload, pin);
    saveVaultToStorage(envelope);
    this._sk = identity.sk;
    this._npub = identity.npub;
    this._relays = identity.relays || [];
    this._locked = false;
    this._resetTimer();
    this._emit("unlocked");
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
      this._resetBruteForce();
      this._resetTimer();
      this._emit("unlocked");
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

    // Biometric success → try PIN "biometric" as the stored vault key
    // The PRF extension isn't widely supported, so we use a biometric-gated
    // stored PIN fallback. For full PRF support, add the extension later.
    const storedPin = sessionStorage.getItem("dl_conn_bio_pin");
    if (storedPin) {
      return this.unlockWithPin(storedPin);
    }
    throw new Error("Biometric PIN bridge not configured");
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
    sessionStorage.setItem("dl_conn_bio_pin", pin);
    this._emit("biometric-enabled");
  }

  /* ── Lock / Wipe ───────────────────────────────────────────── */

  lock() {
    this._sk = null;
    this._npub = null;
    this._relays = null;
    this._locked = true;
    this._clearTimer();
    this._emit("locked");
  }

  wipe() {
    this.lock();
    removeVaultFromStorage();
    removeCredential();
    sessionStorage.removeItem("dl_conn_bio_pin");
    this._resetBruteForce();
    this._emit("wiped");
  }

  /* ── Timer / Inactivity ────────────────────────────────────── */

  _resetTimer() {
    this._clearTimer();
    if (this._locked) return;
    this._timer = setTimeout(() => {
      this.lock();
      this._emit("auto-locked");
    }, INACTIVITY_TIMEOUT_MS);
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
