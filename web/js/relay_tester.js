/* relay_tester.js — RTT measurement, NIP-11 probing, subscription probing */

export class RelayTester {
  /**
   * @param {object} opts
   * @param {number} [opts.timeoutMs=3500] - WebSocket connection timeout
   * @param {number} [opts.reqTimeoutMs=3000] - REQ subscription probe timeout
   */
  constructor({ timeoutMs = 3500, reqTimeoutMs = 3000 } = {}) {
    this.timeoutMs = timeoutMs;
    this.reqTimeoutMs = reqTimeoutMs;
    /** @type {Map<string,{count:number,lastMs:number}>} stats */
    this._stats = new Map();
  }

  /* ── WSS RTT ─────────────────────────────────────────────────── */

  /**
   * Measure WebSocket handshake RTT for a single URL.
   * Returns { url, ok, rttMs, error? }
   */
  async measureRtt(url) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      let settled = false;
      const done = (ok, error) => {
        if (settled) return;
        settled = true;
        const rttMs = Math.round(performance.now() - t0);
        resolve({ url, ok, rttMs, error });
        try { ws.close(); } catch { /* already closed */ }
      };

      let ws;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        done(false, err.message);
        return;
      }

      const timer = setTimeout(() => done(false, "timeout"), this.timeoutMs);
      ws.onopen = () => { clearTimeout(timer); done(true); };
      ws.onerror = () => { clearTimeout(timer); done(false, "connection error"); };
      ws.onclose = () => { clearTimeout(timer); if (!settled) done(false, "closed before open"); };
    });
  }

  /* ── NIP-11 metadata ────────────────────────────────────────── */

  /**
   * Probe relay NIP-11 info via HTTPS.
   * Returns { url, nip11: {name,description,software,version,nips[]} | null, error? }
   */
  async probeNip11(url) {
    const httpsUrl = url.replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const resp = await fetch(httpsUrl, {
        headers: { Accept: "application/nostr+json" },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) return { url, nip11: null, error: "HTTP " + resp.status };
      const nip11 = await resp.json();
      return { url, nip11 };
    } catch (err) {
      return { url, nip11: null, error: err.name === "AbortError" ? "timeout" : err.message };
    }
  }

  /* ── Subscription probe (NIP-01 REQ) ────────────────────────── */

  /**
   * Send a lightweight REQ to test if the relay accepts subscriptions.
   * Returns { url, subscriptionOk: boolean, error? }
   */
  async probeSubscription(url) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok, error) => {
        if (settled) return;
        settled = true;
        resolve({ url, subscriptionOk: ok, error });
        try { ws.close(); } catch { /* */ }
      };

      let ws;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        done(false, err.message);
        return;
      }

      const timer = setTimeout(() => done(false, "timeout"), this.timeoutMs);

      ws.onopen = () => {
        // Send an ephemeral REQ with 0-limit filter (just checks relay accepts it)
        const req = JSON.stringify(["REQ", "ping-test", { limit: 0 }]);
        ws.send(req);
      };

      ws.onmessage = (evt) => {
        clearTimeout(timer);
        const msg = JSON.parse(evt.data);
        // Relay responded with EOSE or anything — means subscription works
        if (msg[0] === "EOSE" || msg[0] === "EVENT") {
          done(true);
        }
      };

      ws.onerror = () => { clearTimeout(timer); done(false, "connection error"); };
      ws.onclose = () => { clearTimeout(timer); if (!settled) done(false, "closed"); };

      // Safety: close after req timeout regardless
      setTimeout(() => {
        if (!settled) done(false, "no response to REQ");
        try { ws.close(); } catch { /* */ }
      }, this.reqTimeoutMs + 500);
    });
  }

  /* ── Full test battery ───────────────────────────────────────── */

  /**
   * Run all probes concurrently for a single relay.
   * Returns { url, ok, rttMs, nip11, subscriptionOk, error? }
   */
  async testRelay(url) {
    const [rtt, nip11, subProbe] = await Promise.all([
      this.measureRtt(url),
      this.probeNip11(url),
      this.probeSubscription(url),
    ]);

    // Update stats
    const stats = this._stats.get(url) || { count: 0, totalMs: 0, successCount: 0 };
    stats.count++;
    stats.totalMs = (stats.totalMs || 0) + rtt.rttMs;
    if (rtt.ok) stats.successCount = (stats.successCount || 0) + 1;
    stats.lastMs = rtt.rttMs;
    this._stats.set(url, stats);

    return {
      url,
      ok: rtt.ok,
      rttMs: rtt.rttMs,
      nip11: nip11.nip11,
      nip11Error: nip11.error,
      subscriptionOk: subProbe.subscriptionOk,
      subscriptionError: subProbe.error,
      error: rtt.ok ? undefined : rtt.error,
      lastChecked: new Date().toISOString(),
    };
  }

  /**
   * Test multiple relays concurrently with allSettled semantics.
   * @param {string[]} urls
   * @returns {Promise<Array<{url,ok,rttMs,...}>>}
   */
  async testAll(urls) {
    return Promise.allSettled(urls.map((u) => this.testRelay(u))).then((results) =>
      results.map((r) =>
        r.status === "fulfilled"
          ? r.value
          : { url: "unknown", ok: false, rttMs: Infinity, error: r.reason?.message || "unknown", lastChecked: new Date().toISOString() }
      )
    );
  }

  /* ── Stats helpers ───────────────────────────────────────────── */

  getStats(url) {
    return this._stats.get(url) || null;
  }

  getAverageRtt(url) {
    const s = this._stats.get(url);
    if (!s || s.count === 0) return null;
    return Math.round(s.totalMs / s.count);
  }

  getSuccessRate(url) {
    const s = this._stats.get(url);
    if (!s || s.count === 0) return null;
    return Math.round((s.successCount / s.count) * 100);
  }
}
