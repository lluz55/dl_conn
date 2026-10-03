/* dev/mock_session.js — puts a real SessionManager into a faked state.
 *
 * The first version of this harness swapped the module out with an import map
 * in dev.html. That does not work here and the reason is worth keeping: an
 * import map has to live in an inline <script type="importmap">, and the page
 * CSP is `script-src 'self'` with no 'unsafe-inline' — the one inline script
 * the SPA is not allowed to have. Loosening script-src for a dev page would
 * mean the harness stops proving anything, since it would no longer run under
 * the policy the real app runs under.
 *
 * So this patches the prototype of the *real* SessionManager instead. The
 * genuine class, constructor and private state are used; only the handful of
 * methods the SPA actually calls are replaced. That also means the harness
 * cannot drift away from the real session code the way a hand-written stand-in
 * would.
 *
 * What it does not do: grant a daemon session. Every real route still requires
 * a real cookie, and the identity below is a fixed all-zero placeholder that is
 * worth nothing, is never written to storage, and must never be replaced with a
 * real key.
 */

import { getPublicKey } from '../vendor/nostr-tools-2.9.2.mjs';
import { MOCK_DEV_NPUB, MOCK_DEV_SK } from './mock_data.js';

export function patchSessionManager(SessionManager) {
  const proto = SessionManager.prototype;

  /* A getter, so it has to be redefined as one. Reporting true is what sends
   * the SPA down the unlock path — the same sequence a real returning user
   * takes, rather than a route invented only for the harness. */
  Object.defineProperty(proto, "hasVault", {
    configurable: true,
    get() { return true; },
  });

  proto.getVaultHint = function () {
    return "identidade de teste (" + MOCK_DEV_NPUB.slice(0, 12) + "…)";
  };

  /* No WebAuthn in the harness: keep that button out of the way rather than
   * pretending a biometric prompt happened. */
  proto.canUseBiometric = function () { return Promise.resolve(false); };
  proto.canEnableBiometric = function () { return Promise.resolve(false); };

  /* Any PIN unlocks. The PIN itself is not what the harness is testing, and
   * the real brute-force path stays intact for whoever wants to test it. */
  proto.unlockWithPin = async function () {
    this._sk = MOCK_DEV_SK;
    this._npub = MOCK_DEV_NPUB;
    this._relays = [];
    this._locked = false;
    // Required, and easy to miss: setBackendActive() only fires "active" when
    // this flag is already true, and "active" is what starts telemetry
    // polling. Leaving it false here means the harness unlocks but never
    // reaches the live dashboard — no error, just an app that looks idle.
    this._pendingBackend = true;
    this._resetTimer();
    this._emit("unlocked");
    this._emit("pending");
    return true;
  };

  proto.unlockWithBiometric = function () {
    return Promise.reject(new Error("biometria indisponível no harness"));
  };

  /* Nothing to encrypt: the harness has no identity worth persisting. */
  proto.createVault = async function () { return true; };
  proto.startSession = function () { /* the harness never renders the login UI */ };

  /* Deliberately not patched: lock(), wipe() and setBackendActive() behave
   * exactly as they do in production, so locking the session from the harness
   * exercises the real teardown. */
}
