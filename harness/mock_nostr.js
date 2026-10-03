/* dev/mock_nostr.js — points a real NostrClient at a fixture instead of relays.
 *
 * Same approach as mock_session.js: the genuine class and constructor are kept
 * and only the network-touching methods are replaced. The real client opens
 * WebSockets to public relays, signs a NIP-44 discovery request and waits for a
 * host to answer; none of that is available offline, and none of it is what
 * changes when a card is restyled.
 *
 * What this does not do: verify a signature or decrypt a payload, because there
 * is no event to verify — it is a fixture, not a client. The real client is
 * untouched and still checks every signature and every NIP-44 payload it
 * receives; see internal/nostr and the CheckSignature call sites.
 */

import { MOCK_HOST_NPUB, MOCK_SERVICES, MOCK_TUNNEL_URL, MOCK_TTL_SECONDS } from './mock_data.js';

export function patchNostrClient(NostrClient) {
  const proto = NostrClient.prototype;

  proto.connect = async function () {
    this.connectedRelays = new Set(this.relays || []);
    return this.connectedRelays.size;
  };

  proto.isAlive = function () { return this.connectedRelays.size > 0; };
  proto.getConnectedCount = function () { return this.connectedRelays.size; };

  proto.getRelayDiagnostics = function () {
    return (this.relays || []).map((url, i) => ({
      url,
      status: "open",
      latency: 40 + i * 25,
    }));
  };

  proto.subscribeToResponses = function () {
    // A real subscription returns an EventTarget; the SPA adds a "response"
    // listener to it and expects a CustomEvent carrying the host's payload.
    const channel = new EventTarget();
    this._mockChannel = channel;
    return channel;
  };

  /* Answer on the next tick, the way a host would over a relay — the SPA's own
   * discovery timeout is left in place, so the timeout path stays reachable.
   *
   * The event shape matters: the real subscription emits "response" with the
   * *decrypted* payload, and onDiscoveryResponse() destructures
   * `const { data, createdAt } = detail`. Handing it the payload directly
   * yields `data === undefined` and the response is dropped without an error,
   * which looks exactly like a host that never answered.
   */
  proto.sendDiscoverRequest = async function () {
    const channel = this._mockChannel;
    if (channel) {
      setTimeout(() => {
        channel.dispatchEvent(new CustomEvent("response", {
          detail: {
            createdAt: Date.now(),
            data: {
              tunnel_url: MOCK_TUNNEL_URL,
              auth_token: "dev-harness-token",
              expires_in_seconds: MOCK_TTL_SECONDS,
              services: MOCK_SERVICES,
              host_npub: MOCK_HOST_NPUB,
              host_telemetry: null,
            },
          },
        }));
      }, 350);
    }
    return { status: "ok", ok: this.connectedRelays.size, failed: 0, errors: [] };
  };

  proto.disconnect = function () {
    this.connectedRelays = new Set();
    this._mockChannel = null;
  };
}
