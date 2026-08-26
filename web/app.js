/* app.js — main SPA controller */
import { NostrAuth } from './js/nostr_auth.js';
import { NostrClient } from './js/nostr_client.js';
import { RelayManager } from './js/relay_manager.js';
import { SessionManager } from './js/session_manager.js';
import { startScan } from './js/qr_scanner.js';

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const el = {
    app: $("app"),
    loading: $("loading"),
    vaultSection: $("vault-section"),
    vaultStatus: $("vault-status"),
    unlockUi: $("unlock-ui"),
    unlockIdentity: $("unlock-identity"),
    btnUnlockBio: $("btn-unlock-bio"),
    pinInput: $("pin-input"),
    btnUnlockPin: $("btn-unlock-pin"),
    btnWipe: $("btn-wipe"),
    loginUi: $("login-ui"),
    loginNip07: $("login-nip07"),
    nsecFallback: $("nsec-fallback"),
    nsecInput: $("nsec-input"),
    btnLoginNsec: $("btn-login-nsec"),
    vaultSavePrompt: $("vault-save-prompt"),
    pinCreate: $("pin-create"),
    pinConfirm: $("pin-confirm"),
    btnSaveVault: $("btn-save-vault"),
    btnSkipVault: $("btn-skip-vault"),
    enableBiometric: $("enable-biometric"),
    hostNpubSection: $("host-npub-section"),
    hostNpubInput: $("host-npub-input"),
    saveHostNpub: $("save-host-npub"),
    relayPanel: $("relay-panel"),
    relaySummary: $("relay-summary"),
    btnTestAllRelays: $("btn-test-all-relays"),
    relayList: $("relay-list"),
    relayAddInput: $("relay-add-input"),
    btnAddRelay: $("btn-add-relay"),
    btnResetRelays: $("btn-reset-relays"),
    servicesSection: $("services-section"),
    servicesList: $("services-list"),
    tunnelStatus: $("tunnel-status"),
    relayStatus: $("relay-status"),
    themeToggle: $("theme-toggle"),
    btnLockSession: $("btn-lock-session"),
    sessionStatus: $("session-status"),
    tunnelExpiry: $("tunnel-expiry"),
    btnRefreshServices: $("btn-refresh-services"),
    btnClearServices: $("btn-clear-services"),
    btnClearAll: $("btn-clear-all"),
    btnScanQr: $("btn-scan-qr"),
    qrOverlay: $("qr-overlay"),
    qrVideo: $("qr-video"),
    qrStatus: $("qr-status"),
    btnQrClose: $("btn-qr-close"),
    autoLockSection: $("auto-lock-section"),
    autoLockTimeout: $("auto-lock-timeout"),
    autoLockStatus: $("auto-lock-status"),
  };

  let expiryTimer = null;
  let discoveryTimer = null;
  /** Set while a discovery request is in flight; cleared by the host reply. */
  let awaitingDiscovery = false;

  /** How long to wait for the host's discovery reply before saying so. */
  const DISCOVERY_TIMEOUT_MS = 30000;

  /**
   * RTT above which a connected relay is called slow. Shared by the summary
   * and by the per-row badge so the two never disagree about the same relay.
   */
  const SLOW_RELAY_MS = 600;

  /** Stop everything the Live zone drives; called whenever it goes away. */
  function clearLiveTimers() {
    if (expiryTimer) { clearInterval(expiryTimer); expiryTimer = null; }
    if (discoveryTimer) { clearTimeout(discoveryTimer); discoveryTimer = null; }
  }

  let state = {
    auth: null,
    session: null,
    relayManager: null,
    nostr: null,
    tunnelURL: null,
    authToken: null,
    services: [],
    pendingIdentity: null,
    config: { relays: [], hostNpub: null },
  };

  async function loadConfig() {
    try {
      const resp = await fetch("./config.json");
      if (resp.ok) {
        const cfg = await resp.json();
        if (cfg.host_npub) {
          // config.json is the deployment source of truth for the host key. A
          // stale dl_conn_host_npub in localStorage (from an earlier/wrong
          // deploy) would otherwise keep encrypting discovery requests to a
          // pubkey the host never reads, and services would never appear.
          state.config.hostNpub = cfg.host_npub;
          localStorage.setItem("dl_conn_host_npub", cfg.host_npub);
        }
        if (cfg.relays) state.config.relays = cfg.relays;
      }
    } catch { /* ignore */ }
  }

  async function init() {
    setupTheme();
    await loadConfig();
    state.auth = new NostrAuth();
    state.session = new SessionManager();
    state.relayManager = new RelayManager();
    // Restore hostNpub from localStorage (set during first login or manual save)
    if (!state.config.hostNpub) {
      const savedHostNpub = localStorage.getItem("dl_conn_host_npub");
      if (savedHostNpub) state.config.hostNpub = savedHostNpub;
    }
    if (state.config.relays.length > 0 && state.relayManager.getAll().length === 0) {
      state.config.relays.forEach((url) => {
        try { state.relayManager.add(url); } catch { /* exists */ }
      });
    }
    renderRelayList();
    state.session.on(onSessionEvent);
    state.relayManager.on(onRelayEvent);
    bindEvents();
    initAutoLockUI();
    checkVaultState();
  }

  function checkVaultState() {
    if (state.session.hasVault) showUnlockScreen();
    else showLoginScreen();
  }

  function showUnlockScreen() {
    el.unlockUi.classList.remove("hidden");
    el.loginUi.classList.add("hidden");
    el.vaultSavePrompt.classList.add("hidden");
    el.hostNpubSection.classList.add("hidden");
    const hint = state.session.getVaultHint();
    el.unlockIdentity.textContent = hint ? "Identidade salva: " + hint : "";
    el.vaultStatus.textContent = "Vault bloqueado. Desbloqueie para continuar.";
    state.session.canUseBiometric().then((ok) => {
      el.btnUnlockBio.classList.toggle("hidden", !ok);
    });
  }

  function showLoginScreen() {
    el.vaultSection.classList.remove("hidden");
    el.unlockUi.classList.add("hidden");
    el.loginUi.classList.remove("hidden");
    el.loginNip07.classList.remove("hidden");
    el.btnScanQr.classList.remove("hidden");
    if (el.nsecFallback) el.nsecFallback.classList.remove("hidden");
    el.vaultSavePrompt.classList.add("hidden");
    el.vaultStatus.textContent = "Nenhuma identidade salva. Faca login abaixo.";
  }

  function showHostNpubPrompt() {
    const saved = localStorage.getItem("dl_conn_host_npub");
    if (saved) {
      state.config.hostNpub = saved;
      startNostr();
    } else {
      el.vaultStatus.textContent = "Digite o npub do host dl_conn abaixo";
      el.hostNpubSection.classList.remove("hidden");
    }
  }

  /* ── Auto-lock timer UI ───────────────────────────────────── */

  function initAutoLockUI() {
    const currentMinutes = state.session.inactivityTimeoutMinutes;
    // Set the select to match the current value (stored in session manager)
    if (el.autoLockTimeout) {
      el.autoLockTimeout.value = String(currentMinutes);
    }
    updateAutoLockStatus(currentMinutes);
  }

  function onAutoLockChange() {
    const minutes = parseInt(el.autoLockTimeout.value, 10);
    state.session.setInactivityTimeout(minutes);
    updateAutoLockStatus(minutes);
  }

  function updateAutoLockStatus(minutes) {
    if (!el.autoLockStatus) return;
    if (minutes === 0) {
      el.autoLockStatus.textContent = "Bloqueio automático desativado";
    } else if (minutes === 60) {
      el.autoLockStatus.textContent = "Bloqueio automático: 1 hora";
    } else {
      el.autoLockStatus.textContent = "Bloqueio automático: " + minutes + " minutos";
    }
  }

  function bindEvents() {
    el.themeToggle.addEventListener("click", toggleTheme);
    el.btnUnlockPin.addEventListener("click", onUnlockPin);
    el.pinInput.addEventListener("keypress", (e) => { if (e.key === "Enter") onUnlockPin(); });
    el.btnUnlockBio.addEventListener("click", onUnlockBiometric);
    el.btnWipe.addEventListener("click", onWipe);
    el.loginNip07.addEventListener("click", onLoginNip07);
    el.btnLoginNsec.addEventListener("click", onLoginNsec);
    el.nsecInput.addEventListener("keypress", (e) => { if (e.key === "Enter") onLoginNsec(); });
    el.btnSaveVault.addEventListener("click", onSaveVault);
    el.btnSkipVault.addEventListener("click", dismissSavePrompt);
    el.saveHostNpub.addEventListener("click", onSaveHostNpub);
    el.hostNpubInput.addEventListener("keypress", (e) => { if (e.key === "Enter") onSaveHostNpub(); });
    el.btnTestAllRelays.addEventListener("click", onTestAllRelays);
    el.btnAddRelay.addEventListener("click", onAddRelay);
    el.relayAddInput.addEventListener("keypress", (e) => { if (e.key === "Enter") onAddRelay(); });
    el.btnResetRelays.addEventListener("click", onResetRelays);
    el.btnLockSession.addEventListener("click", () => state.session.lock());
    el.btnRefreshServices.addEventListener("click", onRefreshServices);
    el.btnClearServices.addEventListener("click", onClearServices);
    el.btnClearAll.addEventListener("click", onClearAll);
    el.btnScanQr.addEventListener("click", onScanQr);
    el.btnQrClose.addEventListener("click", stopQrScan);
    el.autoLockTimeout.addEventListener("change", onAutoLockChange);
  }

  function setSessionStatus(text, tone) {
    if (!el.sessionStatus) return;
    el.sessionStatus.textContent = text;
    el.sessionStatus.className = "status-value" + (tone ? " status-" + tone : "");
  }

  function onSessionEvent(event) {
    if (event === "unlocked") {
      // Keep the card up while an identity is still waiting to be saved —
      // hiding it would take the PIN fields with it (see showSavePrompt).
      if (!state.pendingIdentity) el.vaultSection.classList.add("hidden");
      el.btnLockSession.classList.remove("hidden");
      setSessionStatus("Em espera", "dim");
      // Reveal the Live column on authentication so the user sees connection
      // feedback (status rail) while the tunnel is discovered, instead of a
      // blank screen. Services populate when the host responds.
      el.app.setAttribute("data-phase", "live");
      startNostr();
    } else if (event === "pending") {
      setSessionStatus("Em espera", "dim");
    } else if (event === "active") {
      setSessionStatus("Ativa", "ok");
    } else if (event === "locked") {
      state.pendingIdentity = null;
      el.app.setAttribute("data-phase", "setup");
      el.btnLockSession.classList.add("hidden");
      el.servicesSection.classList.add("hidden");
      if (state.nostr) state.nostr.disconnect();
      state.nostr = null;
      clearLiveTimers();
      el.tunnelStatus.textContent = "Aguardando túnel…";
      setSessionStatus("Bloqueada", "dim");
      // Return to home (login screen) when session is locked
      showLoginScreen();
    } else if (event === "wiped") {
      el.app.setAttribute("data-phase", "setup");
      el.btnLockSession.classList.add("hidden");
      el.servicesSection.classList.add("hidden");
      clearLiveTimers();
      setSessionStatus("Bloqueada", "dim");
      showLoginScreen();
    } else if (event === "auto-locked") {
      el.vaultStatus.textContent = "Sessão bloqueada por inatividade.";
    }
  }

  async function onUnlockPin() {
    const pin = el.pinInput.value.trim();
    if (!pin) { el.vaultStatus.textContent = "Digite o PIN"; return; }
    try {
      el.vaultStatus.textContent = "Desbloqueando...";
      await state.session.unlockWithPin(pin);
      el.pinInput.value = "";
    } catch (err) {
      el.vaultStatus.textContent = err.message;
      el.pinInput.value = "";
    }
  }

  async function onUnlockBiometric() {
    try {
      el.vaultStatus.textContent = "Aguardando biometria...";
      await state.session.unlockWithBiometric();
    } catch (err) {
      el.vaultStatus.textContent = err.message;
    }
  }

  function onWipe() {
    if (confirm("Tem certeza? Isso apaga a identidade salva neste dispositivo.")) {
      state.session.wipe();
    }
  }

  function onClearAll() {
    if (
      !confirm(
        "Apagar TODOS os dados deste frontend?\n\nIsso remove: identidade salva (vault), " +
          "nsec/sk, npub do host, relays salvos, e a sessão atual. O tema claro/escuro " +
          "é preservado. A ação não pode ser desfeita."
      )
    )
      return;
    if (state.nostr) state.nostr.disconnect();
    state.session.wipe(); // vault + WebAuthn + brute-force + bio-pin (emite "wiped")
    // remove todo dl_conn_* que o wipe() não cobre (host_npub, npub, sk, ...)
    // EXCETO dl_conn_theme: o tema claro/escuro deve sobreviver ao reset.
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("dl_conn_") && k !== "dl_conn_theme") localStorage.removeItem(k);
    }
    for (const k of Object.keys(sessionStorage)) if (k.startsWith("dl_conn_")) sessionStorage.removeItem(k);
    // reinicia estado em memória
    state.services = [];
    state.tunnelURL = null;
    state.authToken = null;
    state.config.hostNpub = null;
    state.pendingIdentity = null;
    clearLiveTimers();
    el.servicesSection.classList.add("hidden");
    el.tunnelStatus.textContent = "Aguardando túnel…";
    setSessionStatus("Bloqueada", "dim");
    window.location.reload();
  }

  async function onLoginNip07() {
    try {
      el.vaultStatus.textContent = "Solicitando permissão NIP-07...";
      const npub = await state.auth.loginNip07();
      state.auth.clearKey();
      state.config.hostNpub = state.config.hostNpub || localStorage.getItem("dl_conn_host_npub");
      el.vaultStatus.textContent = "Conectado: " + truncateNpub(npub);
      // NIP-07 proves identity but never exposes the private key the client
      // needs to decrypt the host's NIP-44 response, so startNostr() would
      // bail silently (no `state.session.sk`). If a vault/session key is
      // already available, proceed; otherwise seed the pending identity and
      // reveal the nsec entry so the user can complete the secure (vault)
      // flow that actually shows services.
      if (state.session.sk) {
        startNostr();
      } else {
        // Deliberately no pendingIdentity here: without the private key there
        // is nothing to put in a vault, and a half-filled entry would break
        // the save prompt. The nsec entry below is the way forward.
        el.vaultStatus.textContent =
          "Conectado: " + truncateNpub(npub) + ". Para acessar os serviços, salve sua chave (nsec) abaixo.";
        if (el.nsecFallback) el.nsecFallback.open = true;
      }
    } catch (err) {
      if (String(err.message).includes("NIP-07 extension not found")) {
        el.vaultStatus.textContent = "Extensão NIP-07 não detectada. Insira seu nsec abaixo.";
        if (el.nsecFallback) el.nsecFallback.open = true;
      } else {
        el.vaultStatus.textContent = "Erro: " + err.message;
      }
    }
  }

  async function onLoginNsec() {
    const nsec = el.nsecInput.value.trim();
    try {
      const npub = state.auth.loginNsec(nsec);
      state.pendingIdentity = { npub, sk: state.auth.sk };
      el.nsecInput.value = "";
      // Open the session immediately: discovery hangs off the "unlocked"
      // event, so waiting for the (optional) vault step here left the user
      // looking at a "Conectado" message and nothing else.
      state.session.startSession(state.pendingIdentity);
      el.vaultStatus.textContent =
        "Conectado: " + truncateNpub(npub) + ". Salve a identidade para não digitar o nsec de novo.";
      showSavePrompt();
    } catch (err) {
      el.vaultStatus.textContent = "Erro: " + err.message;
    }
  }

  /**
   * Offer the vault as a follow-up step to an already-open session: the login
   * controls are done with, but #vault-section has to stay on screen for the
   * PIN fields to be reachable.
   */
  function showSavePrompt() {
    el.vaultSection.classList.remove("hidden");
    el.unlockUi.classList.add("hidden");
    el.loginUi.classList.remove("hidden");
    el.loginNip07.classList.add("hidden");
    el.btnScanQr.classList.add("hidden");
    if (el.nsecFallback) el.nsecFallback.classList.add("hidden");
    el.vaultSavePrompt.classList.remove("hidden");
  }

  /** Dismiss the vault offer and hand the whole column over to the Live zone. */
  function dismissSavePrompt() {
    state.pendingIdentity = null;
    el.vaultSavePrompt.classList.add("hidden");
    el.loginNip07.classList.remove("hidden");
    el.btnScanQr.classList.remove("hidden");
    if (el.nsecFallback) el.nsecFallback.classList.remove("hidden");
    el.vaultSection.classList.add("hidden");
  }

  let _qrStop = null;

  function stopQrScan() {
    if (_qrStop) { _qrStop(); _qrStop = null; }
    el.qrOverlay.classList.add("hidden");
    el.qrStatus.textContent = "";
  }

  async function onScanQr() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      el.vaultStatus.textContent = "Câmera indisponível neste navegador.";
      return;
    }
    el.qrOverlay.classList.remove("hidden");
    el.qrStatus.textContent = "Aponte a câmera para o QR do nsec…";
    try {
      _qrStop = await startScan({
        video: el.qrVideo,
        onStatus: (msg) => { el.qrStatus.textContent = msg; },
        onResult: (nsec) => {
          stopQrScan();
          el.nsecInput.value = nsec;
          el.vaultStatus.textContent = "nsec lido do QR. Entrando…";
          onLoginNsec();
        },
      });
    } catch (err) {
      el.qrStatus.textContent = "Não foi possível abrir a câmera: " + err.message;
    }
  }

  async function onSaveVault() {
    const pin = el.pinCreate.value.trim();
    const confirmPin = el.pinConfirm.value.trim();
    if (pin.length < 4 || pin.length > 8) {
      el.vaultStatus.textContent = "PIN deve ter 4 a 8 digitos";
      return;
    }
    if (pin !== confirmPin) {
      el.vaultStatus.textContent = "PINs nao conferem";
      return;
    }
    try {
      el.vaultStatus.textContent = "Criptografando e salvando...";
      const identity = state.pendingIdentity;
      if (!identity) throw new Error("Nenhuma identidade pendente");
      identity.relays = state.relayManager.getActiveUrls();
      await state.session.createVault(identity, pin);
      if (el.enableBiometric.checked) {
        try {
          await state.session.enableBiometric(pin);
          el.vaultStatus.textContent = "Identidade salva com biometria!";
        } catch (bioErr) {
          el.vaultStatus.textContent = "Identidade salva (biometria: " + bioErr.message + ")";
        }
      } else {
        el.vaultStatus.textContent = "Identidade salva com seguranca!";
      }
      el.pinCreate.value = "";
      el.pinConfirm.value = "";
      dismissSavePrompt();
    } catch (err) {
      el.vaultStatus.textContent = "Erro: " + err.message;
    }
  }

  function onSaveHostNpub() {
    const npub = el.hostNpubInput.value.trim();
    if (!npub || !npub.startsWith("npub")) {
      el.vaultStatus.textContent = "Erro: cole um npub valido";
      return;
    }
    state.config.hostNpub = npub;
    localStorage.setItem("dl_conn_host_npub", npub);
    el.hostNpubSection.classList.add("hidden");
    el.vaultStatus.textContent = "Host npub salvo. Conectando...";
    startNostr();
  }

  async function startNostr() {
    if (!state.session.sk) {
      el.relayStatus.textContent = "Chave não disponível. Faça login novamente.";
      return;
    }
    if (!state.config.hostNpub) {
      const saved = localStorage.getItem("dl_conn_host_npub");
      if (saved) {
        state.config.hostNpub = saved;
      } else {
        el.relayStatus.textContent = "Host npub não configurado.";
        showHostNpubPrompt();
        return;
      }
    }
    const relayUrls = state.relayManager.getActiveUrls();
    if (relayUrls.length === 0) {
      el.relayStatus.textContent = "Nenhum relay ativo. Abra o painel de relays.";
      return;
    }
    el.relayStatus.textContent = "Conectando a relays...";
    // Disconnect previous session if any
    if (state.nostr) state.nostr.disconnect();
    state.nostr = new NostrClient(relayUrls, state.config.hostNpub);
    try {
      const connected = await state.nostr.connect();
      if (connected === 0) {
        el.relayStatus.textContent = "Nenhum relay conectado. Verifique sua conexão.";
        return;
      }
      el.relayStatus.textContent = connected + "/" + relayUrls.length + " relays conectados";
      const responseChannel = state.nostr.subscribeToResponses(
        state.session.npub, state.session.sk
      );
      responseChannel.addEventListener("response", (e) => handleNostrResponse(e.detail));
      el.tunnelStatus.textContent = "Solicitando descoberta de serviços...";
      const result = await state.nostr.sendDiscoverRequest(
        state.session.npub, state.session.sk
      );
      // The publish result used to be discarded, which made a rejected or
      // timed-out request indistinguishable from a host that simply had not
      // answered yet.
      if (result && result.status === "timeout") {
        el.tunnelStatus.textContent = "Sem confirmação dos relays ao publicar o pedido.";
        return;
      }
      if (result && result.status === "failed") {
        el.tunnelStatus.textContent =
          "Falha ao publicar o pedido: " + (result.errors || []).join("; ");
        return;
      }
      el.tunnelStatus.textContent = "Pedido enviado. Aguardando o host…";
      startDiscoveryTimeout();
    } catch (err) {
      el.relayStatus.textContent = "Erro: " + err.message;
    }
  }

  /**
   * The host answers nothing at all when it drops a request (offline, or the
   * sender's npub missing from its `authorizedNpubs` whitelist). Without this
   * the UI would sit on "Aguardando o host…" forever with no explanation.
   */
  function startDiscoveryTimeout() {
    awaitingDiscovery = true;
    if (discoveryTimer) { clearTimeout(discoveryTimer); }
    discoveryTimer = setTimeout(() => {
      discoveryTimer = null;
      // Keyed on the in-flight request, not on `state.tunnelURL`: after the
      // first discovery the URL is always set, which silently suppressed this
      // warning for every later refresh — the button appeared to do nothing.
      if (!awaitingDiscovery) return; // response already arrived
      awaitingDiscovery = false;
      el.tunnelStatus.textContent =
        "O host não respondeu. Verifique se o daemon está rodando e se seu npub " +
        "está em authorizedNpubs.";
    }, DISCOVERY_TIMEOUT_MS);
  }

  function handleNostrResponse(data) {
    awaitingDiscovery = false;
    if (discoveryTimer) { clearTimeout(discoveryTimer); discoveryTimer = null; }
    // Stamp the time: two consecutive refreshes with identical statuses are
    // otherwise indistinguishable from a refresh that never landed.
    const hora = new Date().toLocaleTimeString();
    el.tunnelStatus.textContent =
      "Túnel: " + (data.tunnel_url || "conectado") + " · atualizado às " + hora;
    state.tunnelURL = data.tunnel_url;
    state.authToken = data.auth_token;
    state.services = data.services || [];
    startExpiryCountdown(data.expires_in_seconds || 0);
    renderServices();
    el.servicesSection.classList.remove("hidden");
    el.app.setAttribute("data-phase", "live");
    // Transition session from "pending" to "active" on first successful
    // backend contact.
    state.session.setBackendActive();
  }

  function startExpiryCountdown(seconds) {
    if (expiryTimer) { clearInterval(expiryTimer); expiryTimer = null; }
    if (!seconds || seconds <= 0) {
      if (el.tunnelExpiry) el.tunnelExpiry.textContent = "—";
      return;
    }
    if (el.tunnelExpiry) el.tunnelExpiry.textContent = formatDuration(seconds);
    expiryTimer = setInterval(() => {
      seconds -= 1;
      if (seconds <= 0) {
        if (el.tunnelExpiry) el.tunnelExpiry.textContent = "Expirado";
        clearInterval(expiryTimer);
        expiryTimer = null;
        return;
      }
      if (el.tunnelExpiry) el.tunnelExpiry.textContent = formatDuration(seconds);
    }, 1000);
  }

  function formatDuration(total) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return m + ":" + pad(s);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Create an element with attributes and text content. Attribute values and
   * text go through the DOM rather than string concatenation, so untrusted
   * input cannot break out of its position in the markup.
   */
  function elem(tag, attrs, text) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined) continue;
      node.setAttribute(k, String(v));
    }
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  const SVG_NS = "http://www.w3.org/2000/svg";

  function trashIcon() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "icon icon-sm");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", "#i-trash");
    svg.appendChild(use);
    return svg;
  }

  /**
   * Build the NIP-11 tooltip. Every field here comes from a JSON document
   * served by the relay being probed, so a hostile relay controls all of it.
   */
  function buildNip11Tooltip(n) {
    const tip = elem("div", { class: "tooltip" });
    tip.appendChild(elem("strong", null, n.name || "unknown"));
    tip.appendChild(document.createElement("br"));

    if (n.description) {
      tip.appendChild(document.createTextNode(String(n.description)));
      tip.appendChild(document.createElement("br"));
    }

    const software = [n.software || "?", n.version || ""].join(" ").trim();
    tip.appendChild(document.createTextNode("Software: " + software));
    tip.appendChild(document.createElement("br"));

    const nips = Array.isArray(n.nips) ? n.nips.map(String).join(", ") : "n/a";
    tip.appendChild(document.createTextNode("NIPs: " + nips));
    return tip;
  }

  function onClearServices() {
    if (!confirm("Apagar todos os serviços da visualização?")) return;
    state.services = [];
    renderServices();
  }

  /**
   * Re-send the discover request to the host so the service list and
   * health statuses are refreshed without reloading the whole page.
   */
  async function onRefreshServices() {
    if (!state.nostr || !state.session.sk) return;
    el.btnRefreshServices.disabled = true;
    el.btnRefreshServices.setAttribute("aria-busy", "true");
    el.tunnelStatus.textContent = "Atualizando status…";
    try {
      const result = await state.nostr.sendDiscoverRequest(
        state.session.npub, state.session.sk
      );
      if (result && result.status === "timeout") {
        el.tunnelStatus.textContent = "Sem resposta do host ao atualizar.";
        return;
      }
      if (result && result.status === "failed") {
        el.tunnelStatus.textContent =
          "Falha ao atualizar: " + (result.errors || []).join("; ");
        return;
      }
      el.tunnelStatus.textContent = "Pedido enviado. Aguardando o host…";
      startDiscoveryTimeout();
    } finally {
      el.btnRefreshServices.disabled = false;
      el.btnRefreshServices.removeAttribute("aria-busy");
    }
  }

  /**
   * The service dot reflects health confirmed by the host, never mere
   * configuration: green only for "up". A service the daemon has not probed
   * yet ("unknown") or that failed its probe ("down") is shown accordingly, so
   * the dashboard never claims something is live before it answered.
   */
  function statusDot(svc) {
    const status = svc.status === "up" || svc.status === "down"
      ? svc.status
      : "unknown";
    const meta = {
      up: { cls: "dot-good", title: "Ativo" },
      down: { cls: "dot-bad", title: "Inativo" },
      unknown: { cls: "dot-unknown", title: "Aguardando confirmação do host" },
    }[status];
    return '<span class="dot ' + meta.cls + '" title="' + escapeHtml(meta.title) +
      '" data-status="' + status + '"></span>';
  }

  function renderServices() {
    el.servicesList.innerHTML = "";
    if (!state.tunnelURL) return;
    if (state.services.length === 0) {
      el.servicesList.innerHTML =
        '<p class="services-empty" role="status">Nenhum serviço na visualização.</p>';
      return;
    }
    state.services.forEach((svc) => {
      const card = document.createElement("div");
      card.className = "service-card";
      // Percent-encode both values: they land inside an href attribute, and
      // the prefix arrives over the wire from the host's DM.
      const href = state.tunnelURL + "/auth?token=" +
        encodeURIComponent(state.authToken || "") +
        "&redirect=" + encodeURIComponent(svc.prefix || "/");
      card.innerHTML =
        (svc.icon
          ? '<span class="service-icon" aria-hidden="true">' + escapeHtml(svc.icon) + "</span>"
          : '<span class="service-icon" aria-hidden="true"><svg class="icon"><use href="#i-package"></use></svg></span>') +
        statusDot(svc) +
        '<div class="service-meta">' +
        '<div class="service-name">' + escapeHtml(svc.name || svc.id || "serviço") + "</div>" +
        (svc.description ? '<div class="service-desc">' + escapeHtml(svc.description) + "</div>" : "") +
        "</div>" +
        '<a href="' + href + '" class="service-link" target="_blank" rel="noopener noreferrer">' +
        '<svg class="icon icon-sm" aria-hidden="true"><use href="#i-launch"></use></svg>Abrir</a>';
      el.servicesList.appendChild(card);
    });
  }

  async function onTestAllRelays() {
    el.btnTestAllRelays.disabled = true;
    el.btnTestAllRelays.textContent = "Testando...";
    el.relaySummary.innerHTML = '<span class="spinner"></span> Testando relays...';
    try {
      const results = await state.relayManager.testAll();
      updateRelaySummary(results);
      renderRelayList();
    } catch (err) {
      el.relaySummary.textContent = "Erro: " + err.message;
    }
    el.btnTestAllRelays.disabled = false;
    el.btnTestAllRelays.textContent = "Testar Todos";
  }

  /**
   * The count in the summary is "connected", so it must be exactly that:
   * `result.ok` — the WebSocket handshake completed. Latency is reported
   * beside it, never folded into the count: a relay that answers in 800ms is
   * online, and counting it as missing made the summary disagree with the
   * list below it (which shows the same relay green-ish with its RTT).
   */
  function updateRelaySummary(results) {
    const total = results.length;
    const okResults = results.filter((r) => r.ok);
    const connected = okResults.length;
    const slow = okResults.filter((r) => r.rttMs >= SLOW_RELAY_MS).length;
    const avg = connected > 0
      ? Math.round(okResults.reduce((s, r) => s + r.rttMs, 0) / connected)
      : 0;

    let level, text;
    if (connected === 0) {
      level = "bad";
      text = "Nenhum relay conectado";
    } else {
      level = connected === total ? (slow === 0 ? "good" : "warn") : "warn";
      text = connected + "/" + total + " relays conectados • Média: " + avg + "ms";
      if (slow > 0) {
        text += " • " + slow + (slow === 1 ? " lento" : " lentos") +
          " (>" + SLOW_RELAY_MS + "ms)";
      }
    }
    el.relaySummary.innerHTML = '<span class="dot dot-' + level + '" aria-hidden="true"></span> ' + text;
  }

  function renderRelayList() {
    el.relayList.innerHTML = "";
    const relays = state.relayManager.getAll();
    relays.forEach((relay) => {
      const result = state.relayManager.getResult(relay.url);
      const row = document.createElement("div");
      row.className = "relay-row";
      const badgeClass = getBadgeClass(result);
      const rttText = result ? (result.ok ? result.rttMs + 'ms' : 'OFFLINE') : '\u2014';
      // This row is built with DOM APIs rather than innerHTML on purpose: both
      // the relay URL (user input) and the NIP-11 document (fetched from the
      // relay itself) are untrusted, and a single missed escape here would run
      // attacker JS on the origin that holds the user's key material.
      row.appendChild(elem("span", { class: "relay-badge " + badgeClass }));

      const urlCell = elem("span", {
        class: "relay-url relay-nip11-tooltip",
        title: relay.url,
      }, relay.url);
      if (result && result.nip11) {
        urlCell.appendChild(buildNip11Tooltip(result.nip11));
      }
      row.appendChild(urlCell);

      row.appendChild(elem("span", { class: "relay-rtt " + badgeClass }, rttText));
      row.appendChild(elem("button", {
        class: "relay-toggle" + (relay.enabled ? " on" : ""),
        "data-url": relay.url,
        "aria-label": "Toggle",
        "data-tip": "Alternar ativação",
      }));

      const removeBtn = elem("button", {
        class: "relay-remove",
        "data-url": relay.url,
        "aria-label": "Remover",
        "data-tip": "Remover relay",
      });
      removeBtn.appendChild(trashIcon());
      row.appendChild(removeBtn);

      el.relayList.appendChild(row);
    });
    el.relayList.querySelectorAll(".relay-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.relayManager.toggle(btn.dataset.url);
        renderRelayList();
      });
    });
    el.relayList.querySelectorAll(".relay-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.relayManager.remove(btn.dataset.url);
        renderRelayList();
      });
    });
  }

  function getBadgeClass(result) {
    if (!result) return 'unknown';
    if (!result.ok) return 'offline';
    if (result.rttMs < 200) return 'excellent';
    if (result.rttMs < SLOW_RELAY_MS) return 'good';
    if (result.rttMs < 2000) return 'moderate';
    return 'slow';
  }

  function onAddRelay() {
    const url = el.relayAddInput.value.trim();
    if (!url) return;
    try {
      state.relayManager.add(url);
      el.relayAddInput.value = "";
      state.relayManager.testRelay(url).then(() => renderRelayList());
      renderRelayList();
    } catch (err) {
      el.relaySummary.textContent = "Erro: " + err.message;
    }
  }

  function onResetRelays() {
    if (confirm("Restaurar relays padrao? Suas customizacoes serao perdidas.")) {
      state.relayManager.reset();
      renderRelayList();
    }
  }

  function onRelayEvent(event) {
    if (event === "test-all") renderRelayList();
  }

  function themeIcon(isDark) {
    const id = isDark ? "i-sun" : "i-moon";
    return '<svg class="icon" aria-hidden="true"><use href="#' + id + '"></use></svg>';
  }

  function setupTheme() {
    const saved = localStorage.getItem("dl_conn_theme") || "system";
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = saved === "dark" || (saved === "system" && prefersDark);
    document.body.setAttribute("data-theme", isDark ? "dark" : "light");
    el.themeToggle.innerHTML = themeIcon(isDark);
  }

  function toggleTheme() {
    const current = document.body.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.body.setAttribute("data-theme", next);
    localStorage.setItem("dl_conn_theme", next);
    el.themeToggle.innerHTML = themeIcon(next === "dark");
  }

  function truncateNpub(npub) {
    if (!npub) return "";
    return npub.slice(0, 8) + "..." + npub.slice(-8);
  }

  function showApp() {
    el.loading.classList.add("hidden");
    el.app.classList.remove("hidden");
  }

  window.addEventListener("DOMContentLoaded", () => {
    showApp();
    init();
  });
})();
