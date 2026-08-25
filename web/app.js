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
    enableBiometric: $("enable-biometric"),
    hostNpubSection: $("host-npub-section"),
    hostNpubInput: $("host-npub-input"),
    saveHostNpub: $("save-host-npub"),
    btnTestRelays: $("btn-test-relays"),
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
    btnClearServices: $("btn-clear-services"),
    btnClearAll: $("btn-clear-all"),
    btnScanQr: $("btn-scan-qr"),
    qrOverlay: $("qr-overlay"),
    qrVideo: $("qr-video"),
    qrStatus: $("qr-status"),
    btnQrClose: $("btn-qr-close"),
  };

  let expiryTimer = null;

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
        state.config.hostNpub = cfg.host_npub || state.config.hostNpub;
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
    if (state.config.relays.length > 0 && state.relayManager.getAll().length === 0) {
      state.config.relays.forEach((url) => {
        try { state.relayManager.add(url); } catch { /* exists */ }
      });
    }
    state.session.on(onSessionEvent);
    state.relayManager.on(onRelayEvent);
    bindEvents();
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
    el.unlockUi.classList.add("hidden");
    el.loginUi.classList.remove("hidden");
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
    el.saveHostNpub.addEventListener("click", onSaveHostNpub);
    el.hostNpubInput.addEventListener("keypress", (e) => { if (e.key === "Enter") onSaveHostNpub(); });
    el.btnTestRelays.addEventListener("click", toggleRelayPanel);
    el.btnTestAllRelays.addEventListener("click", onTestAllRelays);
    el.btnAddRelay.addEventListener("click", onAddRelay);
    el.relayAddInput.addEventListener("keypress", (e) => { if (e.key === "Enter") onAddRelay(); });
    el.btnResetRelays.addEventListener("click", onResetRelays);
    el.btnLockSession.addEventListener("click", () => state.session.lock());
    el.btnClearServices.addEventListener("click", onClearServices);
    el.btnClearAll.addEventListener("click", onClearAll);
    el.btnScanQr.addEventListener("click", onScanQr);
    el.btnQrClose.addEventListener("click", stopQrScan);
  }

  function setSessionStatus(text, tone) {
    if (!el.sessionStatus) return;
    el.sessionStatus.textContent = text;
    el.sessionStatus.className = "status-value" + (tone ? " status-" + tone : "");
  }

  function onSessionEvent(event) {
    if (event === "unlocked") {
      el.vaultSection.classList.add("hidden");
      el.btnLockSession.classList.remove("hidden");
      setSessionStatus("Ativa", "ok");
      startNostr();
    } else if (event === "locked") {
      el.btnLockSession.classList.add("hidden");
      el.servicesSection.classList.add("hidden");
      if (state.nostr) state.nostr.disconnect();
      state.nostr = null;
      if (expiryTimer) { clearInterval(expiryTimer); expiryTimer = null; }
      el.tunnelStatus.textContent = "Aguardando túnel…";
      setSessionStatus("Bloqueada", "dim");
      showUnlockScreen();
    } else if (event === "wiped") {
      el.btnLockSession.classList.add("hidden");
      el.servicesSection.classList.add("hidden");
      if (expiryTimer) { clearInterval(expiryTimer); expiryTimer = null; }
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
          "nsec/sk, npub do host, tema e relays salvos, e a sessão atual. " +
          "A ação não pode ser desfeita."
      )
    )
      return;
    if (state.nostr) state.nostr.disconnect();
    state.session.wipe(); // vault + WebAuthn + brute-force + bio-pin (emite "wiped")
    // remove todo dl_conn_* que o wipe() não cobre (host_npub, theme, npub, sk, ...)
    for (const k of Object.keys(localStorage)) if (k.startsWith("dl_conn_")) localStorage.removeItem(k);
    for (const k of Object.keys(sessionStorage)) if (k.startsWith("dl_conn_")) sessionStorage.removeItem(k);
    // reinicia estado em memória
    state.services = [];
    state.tunnelURL = null;
    state.authToken = null;
    state.config.hostNpub = null;
    state.pendingIdentity = null;
    if (expiryTimer) { clearInterval(expiryTimer); expiryTimer = null; }
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
      startNostr();
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
      el.vaultStatus.textContent = "Conectado: " + truncateNpub(npub);
      el.vaultSavePrompt.classList.remove("hidden");
      el.nsecInput.value = "";
    } catch (err) {
      el.vaultStatus.textContent = "Erro: " + err.message;
    }
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
      state.pendingIdentity = null;
      el.pinCreate.value = "";
      el.pinConfirm.value = "";
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
    if (!state.session.sk) return;
    if (!state.config.hostNpub) {
      const saved = localStorage.getItem("dl_conn_host_npub");
      if (saved) { state.config.hostNpub = saved; }
      else { showHostNpubPrompt(); return; }
    }
    const relayUrls = state.relayManager.getActiveUrls();
    if (relayUrls.length === 0) {
      el.relayStatus.textContent = "Nenhum relay ativo. Abra o painel de relays.";
      return;
    }
    el.relayStatus.textContent = "Conectando a relays...";
    state.nostr = new NostrClient(relayUrls, state.config.hostNpub);
    try {
      const connected = await state.nostr.connect();
      el.relayStatus.textContent = connected + "/" + relayUrls.length + " relays conectados";
      const responseChannel = state.nostr.subscribeToResponses(
        state.session.npub, state.session.sk
      );
      responseChannel.addEventListener("response", (e) => handleNostrResponse(e.detail));
      el.tunnelStatus.textContent = "Solicitando descoberta de servicos...";
      await state.nostr.sendDiscoverRequest(state.session.npub, state.session.sk);
    } catch (err) {
      el.relayStatus.textContent = "Erro: " + err.message;
    }
  }

  function handleNostrResponse(data) {
    el.tunnelStatus.textContent = "Túnel: " + (data.tunnel_url || "conectado");
    state.tunnelURL = data.tunnel_url;
    state.authToken = data.auth_token;
    state.services = data.services || [];
    startExpiryCountdown(data.expires_in_seconds || 0);
    renderServices();
    el.servicesSection.classList.remove("hidden");
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
        (svc.websocket ? '<span class="dot dot-good" title="Live"></span>' : "") +
        '<div class="service-meta">' +
        '<div class="service-name">' + escapeHtml(svc.name || svc.id || "serviço") + "</div>" +
        (svc.description ? '<div class="service-desc">' + escapeHtml(svc.description) + "</div>" : "") +
        "</div>" +
        '<a href="' + href + '" class="service-link" target="_blank" rel="noopener noreferrer">' +
        '<svg class="icon icon-sm" aria-hidden="true"><use href="#i-launch"></use></svg>Abrir</a>';
      el.servicesList.appendChild(card);
    });
  }

  function toggleRelayPanel() {
    const hidden = el.relayPanel.classList.toggle("hidden");
    if (!hidden) renderRelayList();
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

  function updateRelaySummary(results) {
    const healthy = results.filter((r) => r.ok && r.rttMs < 600).length;
    const total = results.length;
    const okResults = results.filter((r) => r.ok);
    const avg = okResults.length > 0 ? Math.round(okResults.reduce((s, r) => s + r.rttMs, 0) / okResults.length) : 0;
    let level, text;
    if (healthy === total) { level = "good"; text = healthy + "/" + total + " relays saudáveis • Média: " + avg + "ms"; }
    else if (healthy > 0) { level = "warn"; text = healthy + "/" + total + " relays conectados • Média: " + avg + "ms"; }
    else { level = "bad"; text = "Nenhum relay conectado"; }
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
    if (result.rttMs < 600) return 'good';
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