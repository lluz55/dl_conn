/* nostr_client.js — Nostr signaling client using nostr-tools + NIP-44 */
import * as nostrTools from '../vendor/nostr-tools-2.9.2.mjs';

/**
 * Normalize a Nostr public/private key to a lowercase hex string (64 chars).
 * Accepts a hex string (as produced by `getPublicKey`) or a bech32 npub/nsec.
 * nostr-tools v2 `nip19.decode` returns a Uint8Array for nsec and a hex string
 * for npub, so both branches are handled here.
 */
function toHexPubKey(value) {
  if (!value) return value;
  if (typeof value === "string" && /^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  const decoded = nostrTools.nip19.decode(value);
  let d = decoded.data;
  if (d instanceof Uint8Array) {
    d = Array.from(d).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return String(d).toLowerCase();
}

/**
 * How far back a subscription still accepts events, absorbing host/client
 * clock disagreement without pulling in genuinely old backscroll.
 */
const CLOCK_SKEW_TOLERANCE_SEC = 300;

export class NostrClient {
  constructor(relays, hostNpub) {
    this.nostrTools = nostrTools;
    this.relays = relays;
    this.hostNpub = hostNpub;
    this.pool = null;
    this.connectedRelays = new Set();
    this.sub = null;
    /** url → relay object, so we can detach our hooks on teardown. */
    this._relayObjects = new Map();
    /** url → { connected, lastCloseReason?, lastConnectError? } for diagnostics. */
    this.relayStates = new Map();
    /** (level, area, message, detail?) sink, wired by the SPA debug console. */
    this.debugListener = null;
    /** Most recent publish() allSettled outcome, for the diagnostics panel. */
    this.lastPublishResult = null;
  }

  /** @param {(level:string, area:string, message:string, detail?:string)=>void} fn */
  setDebugListener(fn) {
    this.debugListener = fn;
  }

  _debug(level, area, message, detail) {
    if (typeof this.debugListener === "function") {
      try { this.debugListener(level, area, message, detail); } catch { /* ignore */ }
    }
    // Last-resort textual trail even when no UI listener is attached.
    if (level === "error") console.warn("[nostr:" + area + "] " + message, detail || "");
  }

  /** Per-relay liveness snapshot for the diagnostics panel. */
  getRelayDiagnostics() {
    return this.relays.map((url) => {
      const st = this.relayStates.get(url) || {};
      return { url, connected: this.connectedRelays.has(url), ...st };
    });
  }

  /** True when at least one relay socket is still usable. */
  isAlive() {
    return this.connectedRelays.size > 0;
  }

  async connect() {
    const { SimplePool } = this.nostrTools;
    // nostr-tools v2: SimplePool is a class — must use `new`.
    this.pool = new SimplePool();

    const connResults = await Promise.allSettled(
      this.relays.map(async (url) => {
        try {
          // ensureRelay(url, opts) connects the relay internally (await it)
          // and honors `connectionTimeout`; do NOT call relay.connect() after.
          const relay = await this.pool.ensureRelay(url, { connectionTimeout: 5000 });
          this._relayObjects.set(url, relay);
          // Surface a relay dropping its socket later. Idle/background-tab
          // throttling (common in strict browsers) kills the WebSocket without
          // the UI noticing, so the subscription silently stops delivering host
          // replies. Catching it here is what turns "backend vanished, no
          // error" into an actionable, visible signal.
          relay.onclose = (reason) => {
            this._debug("warn", "relay", "Relay fechou: " + url, String(reason || "sem motivo"));
            const prev = this.relayStates.get(url) || {};
            this.relayStates.set(url, { ...prev, connected: false, lastCloseReason: String(reason || "close") });
            this.connectedRelays.delete(url);
          };
          relay.onnotice = (msg) => {
            this._debug("info", "relay", "NOTICE de " + url + ": " + msg);
          };
          return { url, relay };
        } catch (err) {
          this._debug("error", "relay", "Falha ao conectar: " + url, err && err.message);
          const prev = this.relayStates.get(url) || {};
          this.relayStates.set(url, { ...prev, connected: false, lastConnectError: err && err.message });
          return null;
        }
      })
    );

    connResults.forEach((result) => {
      if (result.status === "fulfilled" && result.value) {
        const { url } = result.value;
        this.connectedRelays.add(url);
        const prev = this.relayStates.get(url) || {};
        this.relayStates.set(url, { ...prev, connected: true, lastConnectError: undefined });
      }
    });

    this._debug("info", "relay", this.connectedRelays.size + "/" + this.relays.length + " relays conectados");
    return this.connectedRelays.size;
  }

  async sendDiscoverRequest(senderNpub, senderSk) {
    const { nip44 } = this.nostrTools;
    const senderPubHex = toHexPubKey(senderNpub);

    // Build and encrypt the request with NIP-44
    const req = { action: "discover_services" };
    const plaintext = JSON.stringify(req);

    const hostPubHex = toHexPubKey(this.hostNpub);
    const ck = nip44.getConversationKey(senderSk, hostPubHex);
    const encrypted = nip44.encrypt(plaintext, ck);

    // Build an encrypted DM event (kind 4)
    const eventTemplate = {
      kind: 4,
      pubkey: senderPubHex,
      tags: [["p", hostPubHex]],
      content: encrypted,
      created_at: Math.floor(Date.now() / 1000),
    };

    // Sign with sender's key
    const event = await this._signEvent(eventTemplate, senderSk);

    // nostr-tools v2: SimplePool.publish(relays, event) returns an array of
    // Promises (one per relay), each resolving with the OK reason on success
    // and rejecting on failure. There is no `.subscribe()` on the result.
    const targets = Array.from(this.connectedRelays);
    if (targets.length === 0) {
      this._debug("error", "publish", "Nenhum relay conectado para publicar o pedido de descoberta");
    } else {
      this._debug("info", "publish", "Publicando pedido de descoberta em " + targets.length + " relay(s)");
    }
    const pubPromises = this.pool.publish(targets, event);

    return new Promise((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this._debug("warn", "publish", "Timeout publicando o pedido (sem confirmação dos relays em 10s)");
          resolve({ status: "timeout" });
        }
      }, 10000);

      Promise.allSettled(pubPromises).then((results) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        // Emit per-relay outcome so a single dead relay isn't lost in an
        // aggregate "some succeeded" that still leaves the host unreachable.
        results.forEach((r, i) => {
          const url = targets[i];
          if (r.status === "fulfilled") {
            this._debug("ok", "publish", "Pedido aceito por " + url + " (reason: " + String(r.value || "ok") + ")");
          } else {
            this._debug("error", "publish", "Relay rejeitou o pedido: " + url, String(r.reason?.message || r.reason));
          }
        });
        this.lastPublishResult = { targets, results };
        if (results.some((r) => r.status === "fulfilled")) {
          resolve({ status: "ok" });
        } else {
          resolve({
            status: "failed",
            errors: results
              .filter((r) => r.status === "rejected")
              .map((r) => String(r.reason?.message || r.reason)),
          });
        }
      });
    });
  }

  subscribeToResponses(receiverNpub, receiverSk) {
    const responseChannel = new EventTarget();
    const hostPubHex = toHexPubKey(this.hostNpub);
    const ourPubHex = toHexPubKey(receiverNpub);
    // Relays replay stored DMs on subscribe, and every past discovery reply
    // carries the tunnel URL that was current when it was sent. cloudflared
    // mints a new hostname on each restart, so that backscroll is a stream of
    // dead URLs that would land after the fresh answer and overwrite it.
    // The skew allowance keeps a host whose clock runs slightly ahead or
    // behind from having its genuine reply filtered out.
    const since = Math.floor(Date.now() / 1000) - CLOCK_SKEW_TOLERANCE_SEC;

    // nostr-tools v2: use SimplePool.subscribeMany(relays, filters, params).
    // `filters` is an array; each verified, filter-matched event is delivered
    // via `onevent`. v2 subscriptions stay open after EOSE by default (there
    // is no `closeOnEose` option here), which is what we want for incoming
    // DM replies that arrive after the initial backscroll.
    this.sub = this.pool.subscribeMany(
      Array.from(this.connectedRelays),
      [{ kinds: [4, 1059], "#p": [ourPubHex], since }],
      {
        eoseTimeout: 30000,
        oneose: () => {
          this._debug("info", "sub", "EOSE recebido — backscroll inicial completo");
        },
        onclose: (reasons) => {
          this._debug(
            "warn", "sub", "Assinatura fechada pelo(s) relay(s)",
            Array.isArray(reasons) ? reasons.filter(Boolean).join("; ") : String(reasons || "")
          );
        },
        onevent: (incomingEvent) => {
          if (incomingEvent.kind !== 4 && incomingEvent.kind !== 1059) return;
          // A DM reply is authored by the responder (host), with `#p` = our pub.
          if (incomingEvent.pubkey !== hostPubHex) {
            // Almost always a host_npub misconfiguration: the DM is addressed
            // to us but authored by someone other than the host we expect.
            this._debug("warn", "sub", "DM ignorado: autor " + incomingEvent.pubkey + " != host " + hostPubHex);
            console.warn(
              "[nostr] DM ignorado: autor", incomingEvent.pubkey,
              "!= host esperado", hostPubHex
            );
            return;
          }

          // Decrypt with NIP-44
          this._decryptEvent(incomingEvent, receiverSk, receiverNpub)
            .then((plaintext) => {
              try {
                const data = JSON.parse(plaintext);
                // createdAt travels with the payload so the consumer can
                // discard a reply older than one it already applied: relays
                // deliver independently and give no ordering guarantee.
                this._debug("ok", "sub", "Resposta do host decriptada (created_at " + (incomingEvent.created_at || 0) + ")");
                responseChannel.dispatchEvent(
                  new CustomEvent("response", {
                    detail: { data, createdAt: incomingEvent.created_at || 0 },
                  })
                );
              } catch (err) {
                this._debug("error", "sub", "Resposta do host não é JSON válido", String(err && err.message || err));
                console.warn("[nostr] resposta do host não é JSON válido:", err);
              }
            })
            .catch((err) => {
              this._debug("error", "sub", "Falha ao decriptar DM do host (NIP-44)", String(err && err.message || err));
              console.warn("[nostr] falha ao decriptar DM do host (NIP-44):", err);
            });
        },
      }
    );

    return responseChannel;
  }

  async _signEvent(template, sk) {
    // nostr-tools v2 signs via `finalizeEvent(event, privateKey)` (sync), which
    // sets `pubkey`, `id`, and `sig`. The old top-level `signEvent` no longer exists.
    return this.nostrTools.finalizeEvent({ ...template }, sk);
  }

  async _decryptEvent(evt, sk, npub) {
    const { nip44 } = this.nostrTools;
    // evt.pubkey is the message author (hex). NIP-44 CK is symmetric:
    // getConversationKey(ourPriv, theirPub) == getConversationKey(theirPriv, ourPub).
    const ck = nip44.getConversationKey(sk, evt.pubkey);
    return nip44.decrypt(evt.content, ck);
  }

  getConnectedCount() {
    return this.connectedRelays.size;
  }

  disconnect() {
    // Drop our onclose/onnotice hooks so the intentional teardown doesn't read
    // as a spontaneous relay death in the debug log.
    this._relayObjects.forEach((relay) => {
      try { relay.onclose = null; relay.onnotice = null; } catch { /* ignore */ }
    });
    this._relayObjects.clear();
    if (this.pool) {
      // v2: destroy() closes every relay in the pool. close(relays) requires
      // an array of URLs — passing a string (as the old code did) throws.
      this.pool.destroy();
      this.pool = null;
    }
    if (this.sub) {
      this.sub.close();
      this.sub = null;
    }
    this.connectedRelays.clear();
  }
}
