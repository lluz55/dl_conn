/* nostr_auth.js — Identity detection: NIP-07 or manual nsec */
import * as nostrTools from '../vendor/nostr-tools-2.9.2.mjs';

export class NostrAuth {
  constructor() {
    this.nostrTools = nostrTools;
    this.npub = null;
    this.sk = null; // hex private key (only in sessionStorage)
  }

  async loginNip07() {
    if (!window.nostr) {
      throw new Error("NIP-07 extension not found. Install Alby, nos2x, or Amber.");
    }
    const pub = await window.nostr.getPublicKey();
    this.npub = pub;
    sessionStorage.setItem("dl_conn_npub", pub);
    return pub;
  }

  loginNsec(nsec) {
    if (!nsec || !nsec.startsWith("nsec")) {
      throw new Error("Formato nsec inválido");
    }
    const decoded = this.nostrTools.nip19.decode(nsec);
    let skHex = decoded.data;
    // nostr-tools@2.9.2 returns `data` as a Uint8Array for nsec, not a hex string.
    if (skHex instanceof Uint8Array) {
      skHex = Array.from(skHex)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
    if (typeof skHex !== "string" || skHex.length !== 64) {
      throw new Error("nsec deve decodificar para 32 bytes");
    }
    this.sk = skHex;
    const pub = this.nostrTools.getPublicKey(skHex);
    this.npub = pub;
    sessionStorage.setItem("dl_conn_npub", pub);
    sessionStorage.setItem("dl_conn_sk", skHex);
    return pub;
  }

  async logout() {
    this.npub = null;
    this.sk = null;
    sessionStorage.removeItem("dl_conn_npub");
    sessionStorage.removeItem("dl_conn_sk");
  }

  getIdentity() {
    const npub = sessionStorage.getItem("dl_conn_npub");
    const sk = sessionStorage.getItem("dl_conn_sk");
    this.npub = npub;
    this.sk = sk;
    return { npub, sk };
  }

  clearKey() {
    this.sk = null;
    sessionStorage.removeItem("dl_conn_sk");
  }
}
