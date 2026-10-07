/* relay_manager.js — CRUD, persistence, smart relay selection */

import { RelayTester } from './relay_tester.js';
import { RelayRttHistory } from './relay_rtt_history.js';

const STORAGE_KEY = "dl_conn_relays";

export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://relay.primal.net",
  "wss://nostr.mom",
  "wss://relay.snort.social",
  "wss://nostr.oxtr.dev",
];

/**
 * Relay entry stored in localStorage:
 * { url: string, enabled: boolean, addedAt: string }
 */

export class RelayManager {
  constructor() {
    /** @type {Array<{url:string,enabled:boolean,addedAt:string}>} */
    this._relays = [];
    /** @type {Map<string,{ok:boolean,rttMs:number,nip11:object|null,subscriptionOk:boolean,lastChecked:string,error?:string}>} */
    this._results = new Map();
    this.tester = new RelayTester();
    /**
     * Rolling RTT window per relay, so a drifting relay can be told apart
     * from a steady one. Opt-in by injection: tests that construct a manager
     * without one keep exactly the behaviour they had.
     */
    this.history = null;
    this._listeners = [];
    this._load();
  }

  /** Attach an RTT history. Called by the app; absent in bare unit tests. */
  withHistory(history) {
    this.history = history;
    return this;
  }

  /* ── Persistence ─────────────────────────────────────────────── */

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this._relays = JSON.parse(raw);
      } else {
        this._relays = DEFAULT_RELAYS.map((url) => ({
          url,
          enabled: true,
          addedAt: new Date().toISOString(),
        }));
        this._save();
      }
    } catch {
      this._relays = DEFAULT_RELAYS.map((url) => ({
        url,
        enabled: true,
        addedAt: new Date().toISOString(),
      }));
    }
  }

  _save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this._relays));
    this._emit("change");
  }

  /* ── CRUD ────────────────────────────────────────────────────── */

  /** @returns {Array<{url:string,enabled:boolean,addedAt:string}>} */
  getAll() {
    return [...this._relays];
  }

  /** @returns {string[]} enabled relay URLs only */
  getActiveUrls() {
    return this._relays.filter((r) => r.enabled).map((r) => r.url);
  }

  add(url) {
    url = this._validateUrl(url);
    if (this._relays.some((r) => r.url === url)) throw new Error("Relay already exists");
    this._relays.push({ url, enabled: true, addedAt: new Date().toISOString() });
    this._save();
    return true;
  }

  remove(url) {
    const idx = this._relays.findIndex((r) => r.url === url);
    if (idx === -1) throw new Error("Relay not found");
    this._relays.splice(idx, 1);
    this._results.delete(url);
    // Drop the RTT series too, or a removed relay's history lingers in
    // storage for a relay the user no longer has — and would come back if the
    // same URL were ever added again, showing a trend that never happened.
    if (this.history) this.history.forget(url);
    this._save();
  }

  toggle(url) {
    const relay = this._relays.find((r) => r.url === url);
    if (!relay) throw new Error("Relay not found");
    relay.enabled = !relay.enabled;
    this._save();
    return relay.enabled;
  }

  reset() {
    this._relays = DEFAULT_RELAYS.map((url) => ({
      url,
      enabled: true,
      addedAt: new Date().toISOString(),
    }));
    this._results.clear();
    this._save();
  }

  /* ── Testing & Smart Selection ───────────────────────────────── */

  /** @param {string} url */
  async testRelay(url) {
    const result = await this.tester.testRelay(url);
    this._results.set(url, result);
    this._recordRtt(url, result);
    this._emit("test", result);
    return result;
  }

  /** Test all enabled relays concurrently. Returns results map. */
  async testAll() {
    const urls = this.getActiveUrls();
    const results = await this.tester.testAll(urls);
    results.forEach((r) => {
      this._results.set(r.url, r);
      this._recordRtt(r.url, r);
    });
    this._emit("test-all", results);
    return results;
  }

  /**
   * Feed one result into the RTT history. A failed probe is recorded as a gap
   * (null) rather than skipped, so a relay that keeps failing leaves a visible
   * trail rather than freezing its last good reading on screen.
   */
  _recordRtt(url, result) {
    if (!this.history || !result) return;
    this.history.record(url, result.ok ? result.rttMs : null);
  }

  /** @returns {string[]} sorted by best RTT + success rate */
  getRankedUrls() {
    const enabled = this._relays.filter((r) => r.enabled);
    return enabled
      .map((r) => {
        const res = this._results.get(r.url);
        return {
          url: r.url,
          score: res ? (res.ok ? res.rttMs : 99999) : 50000,
        };
      })
      .sort((a, b) => a.score - b.score)
      .map((r) => r.url);
  }

  /** Get test result for a single relay */
  getResult(url) {
    return this._results.get(url) || null;
  }

  /* ── Validation ──────────────────────────────────────────────── */

  _validateUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "wss:" && parsed.protocol !== "ws:") {
        throw new Error("Must be wss:// or ws://");
      }
      // Strip trailing slash added by URL constructor
      let href = parsed.href;
      if (href.endsWith("/")) href = href.slice(0, -1);
      return href;
    } catch {
      throw new Error("Invalid relay URL: " + url);
    }
  }

  /* ── Event system ────────────────────────────────────────────── */

  on(fn) {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== fn);
    };
  }

  _emit(event, data) {
    this._listeners.forEach((fn) => fn(event, data));
  }
}
