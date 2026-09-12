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
    btnToggleRelays: $("btn-toggle-relays"),
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
    biometricEnroll: $("biometric-enroll"),
    biometricPin: $("biometric-pin"),
    btnEnableBiometricLater: $("btn-enable-biometric-later"),
    hostTelemetrySection: $("host-telemetry-section"),
    telCpu: $("tel-cpu"),
    telRam: $("tel-ram"),
    telDisk: $("tel-disk"),
    telGpu: $("tel-gpu"),
    telBatt: $("tel-batt"),
    telUptime: $("tel-uptime"),
    telLive: $("tel-live"),
    telUpdated: $("tel-updated"),
    btnToggleDebug: $("btn-toggle-debug"),
    debugSection: $("debug-section"),
    debugLog: $("debug-log"),
    btnRunDiagnostics: $("btn-run-diagnostics"),
    btnClearDebug: $("btn-clear-debug"),
    chartCpuValue: $("chart-cpu-value"),
    chartCpuLine: $("chart-cpu-line"),
    chartCpuFill: $("chart-cpu-fill"),
    chartRamValue: $("chart-ram-value"),
    chartRamLine: $("chart-ram-line"),
    chartRamFill: $("chart-ram-fill"),
    chartDiskValue: $("chart-disk-value"),
    chartDiskLine: $("chart-disk-line"),
    chartDiskFill: $("chart-disk-fill"),
    servicesHealth: $("services-health"),
    healthSegUp: $("health-seg-up"),
    healthSegDown: $("health-seg-down"),
    healthSegUnknown: $("health-seg-unknown"),
    healthCountUp: $("health-count-up"),
    healthCountDown: $("health-count-down"),
    healthCountUnknown: $("health-count-unknown"),
  };

  let expiryTimer = null;
  let discoveryTimer = null;
  let telemetryTimer = null;
  let liveTicker = null;
  let lastTelemetryAt = 0;
  let visibilityListenerAdded = false;
  /** Debug console: capped ring buffer of structured log entries. */
  const debugLog = [];
  const DEBUG_MAX = 250;
  let debugWatchdog = null;
  let lastWatchdogAlive = true;
  /** Set while a discovery request is in flight; cleared by the host reply. */
  let awaitingDiscovery = false;

  /**
   * Discovery requests are numbered so a reply that beats its own publish
   * confirmation can be recognised as already answered. The host often
   * replies within a second, while sendDiscoverRequest only resolves once
   * the relays acknowledge the publish — which a flapping relay can drag out
   * for far longer. Without this, the late-resolving send overwrote the
   * "Túnel: ..." line and armed a timeout that then reported the host as
   * silent, for a request it had already answered.
   */
  let discoveryGeneration = 0;
  let answeredGeneration = -1;

  /**
   * `created_at` of the newest discovery reply already applied. Relays deliver
   * the same conversation independently and out of order, so a reply from an
   * earlier tunnel incarnation can arrive after the current one. Applying it
   * would point every service link at a hostname cloudflared has already
   * retired, which is indistinguishable from the host being down.
   */
  let lastResponseAt = 0;

  /** How long to wait for the host's discovery reply before saying so. */
  const DISCOVERY_TIMEOUT_MS = 30000;

  /**
   * RTT above which a connected relay is called slow. Shared by the summary
   * and by the per-row badge so the two never disagree about the same relay.
   */
  const SLOW_RELAY_MS = 600;

  /**
   * Client-side ring buffers backing the telemetry sparklines. There is no
   * backend history endpoint (only `Latest()` in `internal/store`), so the
   * charts only ever show what this tab has observed since it loaded — they
   * reset on reload. Capped short so a stale tab doesn't render a chart
   * spanning many silent hours as if it were continuous.
   */
  const CHART_HISTORY_MAX = 30;
  const cpuLoadHistory = [];
  const ramPctHistory = [];
  const diskPctHistory = [];

  /** Stop everything the Live zone drives; called whenever it goes away. */
  function clearLiveTimers() {
    if (expiryTimer) { clearInterval(expiryTimer); expiryTimer = null; }
    if (discoveryTimer) { clearTimeout(discoveryTimer); discoveryTimer = null; }
    if (telemetryTimer) { clearInterval(telemetryTimer); telemetryTimer = null; }
    if (liveTicker) { clearInterval(liveTicker); liveTicker = null; }
    if (debugWatchdog) { clearInterval(debugWatchdog); debugWatchdog = null; }
  }

  function formatUptime(total) {
    if (total == null || isNaN(total)) return "—";
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    if (h > 0) return h + "h " + m + "m";
    return m + "m";
  }

  /**
   * Render a capacity given in mebibytes (the unit the Go daemon emits) using
   * the most readable binary unit (base 1024): MB -> GB -> TB -> PB.
   * Input is always an integer count of 1 MiB blocks, so 1024 MiB = 1 GiB and
   * we label it "GB" to match the user-facing expectation. Invalid input
   * (null/NaN/negative) yields an em dash.
   */
  function formatCapacity(mb) {
    if (mb == null || isNaN(mb) || mb < 0) return "—";
    const units = ["MB", "GB", "TB", "PB"];
    let v = mb;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    const s = (Math.round(v * 10) / 10).toString();
    return s.replace(/\.0$/, "") + " " + units[i];
  }


  function renderTelemetry(snap) {
    if (!snap) return;
    if (el.hostTelemetrySection) el.hostTelemetrySection.classList.remove("hidden");
    if (el.telCpu) {
      const parts = [];
      const tempC = snap.cpu ? snap.cpu.temp_c : snap.cpu_temp_c;
      const load1 = snap.cpu ? snap.cpu.load1 : snap.cpu_load1;
      const freqMHz = snap.cpu ? snap.cpu.freq_mhz : snap.cpu_freq_mhz;
      if (tempC != null) parts.push(tempC.toFixed(1) + "°C");
      if (load1 != null) parts.push("load " + load1.toFixed(2));
      if (freqMHz != null) parts.push(freqMHz.toFixed(0) + " MHz");
      el.telCpu.textContent = parts.length ? parts.join(" · ") : "—";
      // Guarded via typeof: telemetry_tests.js evaluates this function body
      // in isolation (extractFunction + `new Function`) with only
      // formatUptime/formatCapacity inlined, so pushChartSample/renderCharts
      // are undeclared there. `typeof x === "function"` never throws on an
      // undeclared identifier, unlike calling it directly would.
      if (load1 != null && typeof pushChartSample === "function") pushChartSample(cpuLoadHistory, load1);
    }
    let ramPct = null;
    if (el.telRam) {
      if (snap.memory) {
        ramPct = snap.memory.used_pct;
        el.telRam.textContent = ramPct.toFixed(1) + "% (" + formatCapacity(snap.memory.used_mb) + " / " + formatCapacity(snap.memory.total_mb) + ")";
      } else if (snap.ram_used_pct != null) {
        ramPct = snap.ram_used_pct;
        el.telRam.textContent = ramPct.toFixed(1) + "% (" + formatCapacity(snap.ram_used_mb || 0) + " / " + formatCapacity(snap.ram_total_mb || 0) + ")";
      } else el.telRam.textContent = "—";
      if (ramPct != null && typeof pushChartSample === "function") pushChartSample(ramPctHistory, ramPct);
    }
    let diskPct = null;
    if (el.telDisk) {
      if (snap.disks && snap.disks.length) {
        // Show every mountpoint, each with its capacity in the most readable
        // unit (MB/GB/TB). Joined with a middot so the single status-value
        // span reads as a compact list.
        el.telDisk.textContent = snap.disks.map(function (d) {
          return d.used_pct.toFixed(1) + "% (" + formatCapacity(d.used_mb) + " / " + formatCapacity(d.total_mb) + ") " + d.mountpoint;
        }).join(" · ");
        // The sparkline tracks a single series: the busiest mountpoint, so a
        // filling disk is the one that shows up regardless of how many
        // others stay flat.
        diskPct = snap.disks.reduce((max, d) => Math.max(max, d.used_pct), 0);
      } else if (snap.disk_used_pct != null) {
        diskPct = snap.disk_used_pct;
        el.telDisk.textContent = diskPct.toFixed(1) + "% (" + formatCapacity(snap.disk_used_mb || 0) + " / " + formatCapacity(snap.disk_total_mb || 0) + ") " + (snap.mountpoint || "");
      } else el.telDisk.textContent = "—";
      if (diskPct != null && typeof pushChartSample === "function") pushChartSample(diskPctHistory, diskPct);
    }
    if (el.telGpu) {
      if (snap.gpu && (snap.gpu.temp_c != null || snap.gpu.util_pct != null)) {
        const g = [];
        if (snap.gpu.temp_c != null) g.push(snap.gpu.temp_c.toFixed(1) + "°C");
        if (snap.gpu.util_pct != null) g.push(snap.gpu.util_pct.toFixed(0) + "%");
        el.telGpu.textContent = g.join(" · ");
      } else if (snap.gpu_temp_c != null || snap.gpu_util_pct != null) {
        const g = [];
        if (snap.gpu_temp_c != null) g.push(snap.gpu_temp_c.toFixed(1) + "°C");
        if (snap.gpu_util_pct != null) g.push(snap.gpu_util_pct.toFixed(0) + "%");
        el.telGpu.textContent = g.join(" · ") || "—";
      } else el.telGpu.textContent = "—";
    }
    if (el.telBatt) {
      if (snap.battery && snap.battery.available) el.telBatt.textContent = snap.battery.capacity_pct + "% " + (snap.battery.status || "");
      else if (snap.batt_capacity_pct != null) el.telBatt.textContent = snap.batt_capacity_pct + "% " + (snap.batt_status || "");
      else el.telBatt.textContent = "—";
    }
    if (el.telUptime) el.telUptime.textContent = formatUptime(snap.uptime_s);
    if (typeof renderCharts === "function") renderCharts();
  }

  /** Append a sample to a ring buffer, dropping the oldest once it overflows. */
  function pushChartSample(buffer, value) {
    buffer.push(value);
    if (buffer.length > CHART_HISTORY_MAX) buffer.shift();
  }

  /**
   * Draw one sparkline: a filled area + line polyline scaled into the SVG's
   * `viewBox="0 0 100 36"` box. Points are plain numbers set via
   * `setAttribute`, never inline `style` (CSP: style-src has no
   * 'unsafe-inline'). A single sample still draws a flat line so the chart
   * never looks broken right after the first telemetry fetch.
   */
  function drawSparkline(lineEl, fillEl, values, opts) {
    if (!lineEl || !values.length) return;
    const max = opts && opts.max != null ? opts.max : Math.max(...values, 1);
    const min = opts && opts.min != null ? opts.min : 0;
    const span = Math.max(max - min, 0.0001);
    const w = 100;
    const h = 36;
    const step = values.length > 1 ? w / (values.length - 1) : 0;
    const coords = values.map((v, i) => {
      const x = values.length > 1 ? i * step : w;
      const clamped = Math.min(Math.max(v, min), max);
      const y = h - ((clamped - min) / span) * h;
      return x.toFixed(2) + "," + y.toFixed(2);
    });
    lineEl.setAttribute("points", coords.join(" "));
    if (fillEl) {
      const fillCoords = [coords[0].split(",")[0] + "," + h]
        .concat(coords)
        .concat([coords[coords.length - 1].split(",")[0] + "," + h]);
      fillEl.setAttribute("points", fillCoords.join(" "));
    }
  }

  /** Redraw every telemetry sparkline from its current ring buffer. */
  function renderCharts() {
    drawSparkline(el.chartCpuLine, el.chartCpuFill, cpuLoadHistory);
    if (el.chartCpuValue) {
      el.chartCpuValue.textContent = cpuLoadHistory.length
        ? cpuLoadHistory[cpuLoadHistory.length - 1].toFixed(2)
        : "—";
    }
    drawSparkline(el.chartRamLine, el.chartRamFill, ramPctHistory, { min: 0, max: 100 });
    if (el.chartRamValue) {
      el.chartRamValue.textContent = ramPctHistory.length
        ? ramPctHistory[ramPctHistory.length - 1].toFixed(1) + "%"
        : "—";
    }
    drawSparkline(el.chartDiskLine, el.chartDiskFill, diskPctHistory, { min: 0, max: 100 });
    if (el.chartDiskValue) {
      el.chartDiskValue.textContent = diskPctHistory.length
        ? diskPctHistory[diskPctHistory.length - 1].toFixed(1) + "%"
        : "—";
    }
  }

  /**
   * Update the "ao vivo / ha Xs" badge. 'ok' reflects whether the last fetch
   * succeeded; on failure we keep the last good snapshot on screen but flag
   * the badge as stale so the user sees telemetry is no longer refreshing
   * instead of a frozen value that looks live.
   */
  function updateLiveBadge(ok) {
    if (!el.telUpdated) return;
    if (!ok) {
      el.telUpdated.textContent = "indisponivel";
      if (el.telLive) el.telLive.classList.add("is-stale");
      return;
    }
    if (el.telLive) el.telLive.classList.remove("is-stale");
    const secs = lastTelemetryAt ? Math.floor((Date.now() - lastTelemetryAt) / 1000) : 0;
    el.telUpdated.textContent = secs < 5 ? "ao vivo" : "ha " + secs + "s";
  }

  /** 1s ticker so the "ha Xs" label counts up between 10s fetches. */
  function startLiveTicker() {
    if (liveTicker) clearInterval(liveTicker);
    liveTicker = setInterval(function () {
      if (lastTelemetryAt) updateLiveBadge(true);
    }, 1000);
  }

  async function fetchTelemetry() {
    try {
      const r = await fetch("/api/host/telemetry", { credentials: "include" });
      if (!r.ok) { updateLiveBadge(false); return; }
      const snap = await r.json();
      renderTelemetry(snap);
      lastTelemetryAt = Date.now();
      updateLiveBadge(true);
    } catch (_) { updateLiveBadge(false); }
  }

  function startTelemetryPolling() {
    if (telemetryTimer) clearInterval(telemetryTimer);
    // Reveal the card immediately so the user sees the dashboard is loading,
    // rather than a blank Live column that looks broken until the first
    // successful fetch lands.
    if (el.hostTelemetrySection) el.hostTelemetrySection.classList.remove("hidden");
    fetchTelemetry();
    telemetryTimer = setInterval(fetchTelemetry, 10000);
    startLiveTicker();
    // The visibility handler must be registered exactly once: the previous code
    // added a new listener on every (re-)activation, which could leak and even
    // spawn duplicate intervals after a hide/show cycle.
    if (!visibilityListenerAdded) {
      visibilityListenerAdded = true;
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) {
          if (telemetryTimer) { clearInterval(telemetryTimer); telemetryTimer = null; }
        } else if (!telemetryTimer) {
          fetchTelemetry();
          telemetryTimer = setInterval(fetchTelemetry, 10000);
        }
      });
    }
  }

  /**
   * Best-effort revoke of the server-side proxy session (the dl_conn_session
   * cookie set by /auth on the tunnel host, not this vault's own in-memory
   * lock). Without this, locking or wiping the vault only hides the identity
   * in this tab — a cookie a device already picked up keeps working against
   * every proxied service for the rest of its TTL. Only reachable when this
   * page itself is being served from the tunnel origin (same-origin cookie);
   * a copy hosted elsewhere (e.g. GitHub Pages) has no session to revoke from
   * here and the request is simply dropped by the browser.
   */
  async function revokeServerSession() {
    if (!state.tunnelURL) return;
    try {
      await fetch(state.tunnelURL + "/auth/logout", {
        method: "POST",
        credentials: "include",
        keepalive: true,
      });
    } catch (_) {
      // Offline or cross-origin without CORS — locking the vault still
      // proceeds regardless.
    }
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
    } else if (minutes === 1) {
      el.autoLockStatus.textContent = "Bloqueio automático: 1 minuto";
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
    el.btnToggleRelays.addEventListener("click", onToggleRelays);
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
    el.btnEnableBiometricLater.addEventListener("click", onEnableBiometricLater);
    el.biometricPin.addEventListener("keypress", (e) => { if (e.key === "Enter") onEnableBiometricLater(); });
    el.btnToggleDebug.addEventListener("click", onToggleDebug);
    el.btnRunDiagnostics.addEventListener("click", runDiagnostics);
    el.btnClearDebug.addEventListener("click", onClearDebug);
  }

  function setSessionStatus(text, tone) {
    if (!el.sessionStatus) return;
    el.sessionStatus.textContent = text;
    // Reassigning className outright would drop "kpi-value" (the element also
    // lives inside a .kpi-card now), so only the status-* tone class is
    // swapped in/out.
    Array.from(el.sessionStatus.classList).forEach((c) => {
      if (c.startsWith("status-") && c !== "status-value") el.sessionStatus.classList.remove(c);
    });
    if (tone) el.sessionStatus.classList.add("status-" + tone);
  }

  function onSessionEvent(event) {
    if (event === "unlocked") {
      // Keep the card up while an identity is still waiting to be saved —
      // hiding it would take the PIN fields with it (see showSavePrompt).
      if (!state.pendingIdentity) el.vaultSection.classList.add("hidden");
      el.btnLockSession.classList.remove("hidden");
      el.autoLockSection.classList.remove("hidden");
      setSessionStatus("Em espera", "dim");
      // Reveal the Live column on authentication so the user sees connection
      // feedback (status rail) while the tunnel is discovered, instead of a
      // blank screen. Services populate when the host responds.
      el.app.setAttribute("data-phase", "live");
      refreshBiometricEnrollUI();
      startNostr();
    } else if (event === "pending") {
      setSessionStatus("Em espera", "dim");
    } else if (event === "active") {
      setSessionStatus("Ativa", "ok");
      startTelemetryPolling();
    } else if (event === "locked") {
      revokeServerSession();
      state.pendingIdentity = null;
      el.app.setAttribute("data-phase", "setup");
      el.btnLockSession.classList.add("hidden");
      el.autoLockSection.classList.add("hidden");
      el.servicesSection.classList.add("hidden");
      if (el.hostTelemetrySection) el.hostTelemetrySection.classList.add("hidden");
      if (state.nostr) state.nostr.disconnect();
      state.nostr = null;
      clearLiveTimers();
      el.tunnelStatus.textContent = "Aguardando túnel…";
      setSessionStatus("Bloqueada", "dim");
      // A locked session (manual or auto-lock) still has its vault on disk —
      // send the user back to the PIN/biometric unlock screen, not the
      // signup/login screen checkVaultState() falls back to when there's
      // truly no vault (only wipe/first-run reach that path).
      checkVaultState();
    } else if (event === "wiped") {
      revokeServerSession();
      el.app.setAttribute("data-phase", "setup");
      el.btnLockSession.classList.add("hidden");
      el.autoLockSection.classList.add("hidden");
      el.servicesSection.classList.add("hidden");
      if (el.hostTelemetrySection) el.hostTelemetrySection.classList.add("hidden");
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

  /**
   * Shows/hides the "enable biometric" offer in the auto-lock card for
   * whoever declined it (or wasn't asked, e.g. NIP-07 login) when the vault
   * was first created. Re-checked on every unlock/login since the answer
   * depends on both platform support and whether a credential already
   * exists — either can change between sessions.
   */
  function refreshBiometricEnrollUI() {
    // Biometric unlock bridges to a PIN-protected vault (see
    // unlockWithBiometric); offering it before one exists — an ephemeral
    // nsec/NIP-07 session that hasn't been saved yet, or was dismissed via
    // "Agora não" — would register a credential with nothing for it to
    // unlock.
    if (!state.session.hasVault) {
      el.biometricEnroll.classList.add("hidden");
      return;
    }
    state.session.canEnableBiometric().then((ok) => {
      el.biometricEnroll.classList.toggle("hidden", !ok);
    });
  }

  async function onEnableBiometricLater() {
    const pin = el.biometricPin.value.trim();
    if (!pin) { el.autoLockStatus.textContent = "Digite o PIN para ativar a biometria"; return; }
    try {
      await state.session.enableBiometric(pin);
      el.biometricPin.value = "";
      el.biometricEnroll.classList.add("hidden");
      el.autoLockStatus.textContent = "Biometria ativada!";
    } catch (err) {
      el.autoLockStatus.textContent = "Erro ao ativar biometria: " + err.message;
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
      // The vault now exists — if biometric was left unchecked (or failed
      // above), offer it again right away instead of only on the next login.
      refreshBiometricEnrollUI();
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
    // Route every client-side diagnostic through the debug console.
    state.nostr.setDebugListener(pushDebug);
    try {
      const connected = await state.nostr.connect();
      if (connected === 0) {
        el.relayStatus.textContent = "Nenhum relay conectado. Verifique sua conexão.";
        pushDebug("error", "nostr", "Nenhum relay conectado em startNostr");
        return;
      }
      el.relayStatus.textContent = connected + "/" + relayUrls.length + " relays conectados";
      logIdentity();
      const responseChannel = state.nostr.subscribeToResponses(
        state.session.npub, state.session.sk
      );
      responseChannel.addEventListener("response", (e) => onDiscoveryResponse(e.detail));
      el.tunnelStatus.textContent = "Solicitando descoberta de serviços...";
      const generation = ++discoveryGeneration;
      const result = await state.nostr.sendDiscoverRequest(
        state.session.npub, state.session.sk
      );
      if (answeredGeneration >= generation) return;
      // The publish result used to be discarded, which made a rejected or
      // timed-out request indistinguishable from a host that simply had not
      // answered yet.
      if (result && result.status === "timeout") {
        el.tunnelStatus.textContent = "Sem confirmação dos relays ao publicar o pedido.";
        pushDebug("warn", "nostr", "Publicação do pedido expirou sem confirmação");
        return;
      }
      if (result && result.status === "failed") {
        el.tunnelStatus.textContent =
          "Falha ao publicar o pedido: " + (result.errors || []).join("; ");
        pushDebug("error", "nostr", "Falha ao publicar pedido: " + (result.errors || []).join("; "));
        return;
      }
      el.tunnelStatus.textContent = "Pedido enviado. Aguardando o host…";
      startDiscoveryTimeout();
    } catch (err) {
      el.relayStatus.textContent = "Erro: " + err.message;
      pushDebug("error", "nostr", "Exceção em startNostr: " + err.message, String(err));
    }
    // Keep the liveness watchdog running as long as a connection is intended.
    startNostrWatchdog();
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

  /**
   * Drops a reply older than the one already applied, so a late-arriving
   * stale tunnel URL cannot overwrite the current one.
   */
  function onDiscoveryResponse(detail) {
    const { data, createdAt } = detail || {};
    if (!data) return;
    if (createdAt && createdAt < lastResponseAt) {
      pushDebug("warn", "sub", "Resposta ignorada por ser mais antiga que a já aplicada (created_at " + createdAt + " < " + lastResponseAt + ")");
      return;
    }
    lastResponseAt = createdAt || lastResponseAt;
    handleNostrResponse(data);
  }

  function handleNostrResponse(data) {
    awaitingDiscovery = false;
    answeredGeneration = discoveryGeneration;
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
    if (data.host_telemetry) renderTelemetry(data.host_telemetry);
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

  /* ── Debug console ─────────────────────────────────────────── */

  /**
   * Append a structured entry to the debug ring buffer and, when the debug
   * panel is open, re-render it. Levels: info | ok | warn | error. The buffer
   * itself is always kept so a manual diagnosis can be triggered after the
   * fact, even with the panel closed.
   */
  function pushDebug(level, area, msg, detail) {
    const entry = { t: new Date(), level, area, msg, detail: detail || "" };
    debugLog.push(entry);
    if (debugLog.length > DEBUG_MAX) debugLog.shift();
    if (el.debugSection && !el.debugSection.classList.contains("hidden")) renderDebug();
  }

  /** Rebuild the debug log DOM from the ring buffer (terminal-like). */
  function renderDebug() {
    if (!el.debugLog) return;
    const frag = document.createDocumentFragment();
    for (const e of debugLog) {
      const row = elem("div", { class: "debug-row debug-" + e.level });
      row.appendChild(elem("span", { class: "debug-ts" }, e.t.toLocaleTimeString()));
      row.appendChild(elem("span", { class: "debug-area" }, e.area));
      row.appendChild(elem("span", { class: "debug-msg" }, e.msg));
      if (e.detail) row.appendChild(elem("span", { class: "debug-detail" }, " — " + e.detail));
      frag.appendChild(row);
    }
    el.debugLog.replaceChildren(frag);
    el.debugLog.scrollTop = el.debugLog.scrollHeight;
  }

  function onToggleDebug() {
    const willShow = el.debugSection.classList.contains("hidden");
    el.debugSection.classList.toggle("hidden", !willShow);
    el.btnToggleDebug.setAttribute("aria-expanded", String(willShow));
    if (willShow) renderDebug();
  }

  function onClearDebug() {
    debugLog.length = 0;
    if (el.debugLog) el.debugLog.replaceChildren();
  }

  /** Surface the active identity/host so a vanished backend is easy to triage. */
  function logIdentity() {
    const npub = state.session && state.session.npub;
    const host = state.config.hostNpub;
    pushDebug("info", "ident", "npub do cliente: " + (npub || "(indisponível)"));
    pushDebug("info", "ident", "host npub configurado: " + (host || "(nenhum)"));
    if (npub && host && npub === host) {
      pushDebug("warn", "ident", "npub do cliente == host npub: a descoberta exige chaves distintas.");
    }
    pushDebug("info", "ident", "Sem resposta do host? Confirme que este npub está em authorizedNpubs do daemon.");
  }

  /**
   * Hard-reconnect: tear down the current client and run startNostr again. This
   * is the recovery path for a dead relay socket (the usual cause of the
   * backend silently disappearing on strict browsers that throttle background
   * tabs) — nostr-tools does not auto-reconnect, so we do it explicitly.
   */
  async function reconnectNostr() {
    pushDebug("info", "nostr", "Reconexão solicitada: encerrando cliente e reiniciando Nostr");
    if (state.nostr) {
      try { state.nostr.disconnect(); } catch { /* ignore */ }
    }
    state.nostr = null;
    // Accept a fresh reply from a new session instead of suppressing it as stale.
    answeredGeneration = -1;
    lastResponseAt = 0;
    awaitingDiscovery = false;
    if (discoveryTimer) { clearTimeout(discoveryTimer); discoveryTimer = null; }
    try {
      await startNostr();
      pushDebug("ok", "nostr", "Reconexão concluída");
    } catch (err) {
      pushDebug("error", "nostr", "Reconexão falhou: " + (err && err.message), String(err));
    }
  }

  /**
   * Manual self-test reachable from the debug panel. Re-probes relays, reports
   * per-relay liveness from the client, and recovers (reconnect or re-send) so
   * the user gets a concrete verdict instead of a blank screen.
   */
  async function runDiagnostics() {
    pushDebug("info", "diag", "Iniciando diagnóstico manual…");
    try {
      const results = await state.relayManager.testAll();
      results.forEach((r) => pushDebug(
        r.ok ? "ok" : "error", "relay",
        (r.ok ? "OK " : "FALHA ") + r.url + (r.ok ? (" (" + r.rttMs + "ms)") : (" — " + (r.error || "sem detalhe")))
      ));
    } catch (e) {
      pushDebug("error", "relay", "testAll falhou: " + (e && e.message), String(e));
    }

    if (state.nostr) {
      const diag = state.nostr.getRelayDiagnostics();
      pushDebug("info", "nostr", "Estado dos relays no cliente: " + diag.length + " monitorado(s)");
      diag.forEach((d) => pushDebug(
        d.connected ? "ok" : "warn", "nostr",
        d.url + (d.connected ? " conectado" : " DESCONECTADO") +
        (d.lastCloseReason ? (" — fechou: " + d.lastCloseReason) : "")
      ));
      if (!state.nostr.isAlive()) {
        pushDebug("error", "nostr", "Nenhum relay vivo. Reconectando…");
        await reconnectNostr();
      } else {
        pushDebug("ok", "nostr", "Ao menos um relay vivo. Reenviando pedido de descoberta…");
        onRefreshServices();
      }
    } else {
      pushDebug("warn", "nostr", "Cliente Nostr não inicializado. Reconectando…");
      await reconnectNostr();
    }
    pushDebug("info", "diag", "Diagnóstico concluído.");
  }

  /**
   * Background liveness watchdog. nostr-tools will not reconnect a dead relay
   * socket, so after a while (background tab, suspend, flaky network) every
   * relay can be gone while the UI still thinks it is connected — the backend
   * "vanishes" with no console error. Detect the transition and auto-recover.
   * Registered exactly once.
   */
  function startNostrWatchdog() {
    if (debugWatchdog) return;
    debugWatchdog = setInterval(() => {
      if (!state.nostr || state.session.isLocked) {
        if (!state.nostr) lastWatchdogAlive = true;
        return;
      }
      const alive = state.nostr.isAlive();
      if (!alive && lastWatchdogAlive) {
        pushDebug("error", "watchdog",
          "Todos os relays desconectados sem aviso (provável socket morto por aba em segundo plano). Reconectando automaticamente…");
        reconnectNostr();
      }
      lastWatchdogAlive = alive;
    }, 15000);
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
    const generation = ++discoveryGeneration;
    try {
      const result = await state.nostr.sendDiscoverRequest(
        state.session.npub, state.session.sk
      );
      if (answeredGeneration >= generation) return;
      if (result && result.status === "timeout") {
        el.tunnelStatus.textContent = "Sem resposta do host ao atualizar.";
        pushDebug("warn", "nostr", "Atualização expirou sem confirmação");
        return;
      }
      if (result && result.status === "failed") {
        el.tunnelStatus.textContent =
          "Falha ao atualizar: " + (result.errors || []).join("; ");
        pushDebug("error", "nostr", "Falha ao atualizar: " + (result.errors || []).join("; "));
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

  function serviceIcon(icon) {
    if (!icon) {
      return '<span class="service-icon" aria-hidden="true"><svg class="icon"><use href="#i-package"></use></svg></span>';
    }
    const clean = String(icon).trim();
    const normalized = clean.toLowerCase().replace(/^#?i-/, "");
    const aliases = {
      home: "home",
      hass: "home",
      "home-assistant": "home",
      homeassistant: "home",
      video: "video",
      frigate: "video",
      cctv: "video",
      stream: "video",
      streaming: "video",
      camera: "camera",
      cam: "camera",
      webcam: "camera",
      router: "router",
      zigbee: "router",
      zigbee2mqtt: "router",
      z2m: "router",
      mqtt: "router",
      wifi: "wifi",
      wireless: "wifi",
      wlan: "wifi",
      network: "globe",
      server: "server",
      nas: "server",
      proxmox: "server",
      truenas: "server",
      unraid: "server",
      homelab: "server",
      database: "database",
      db: "database",
      sql: "database",
      postgres: "database",
      postgresql: "database",
      mysql: "database",
      mariadb: "database",
      redis: "database",
      mongo: "database",
      mongodb: "database",
      dashboard: "dashboard",
      dash: "dashboard",
      grafana: "dashboard",
      homepage: "dashboard",
      dashy: "dashboard",
      activity: "activity",
      pulse: "activity",
      monitoring: "activity",
      uptime: "activity",
      uptimekuma: "activity",
      status: "activity",
      terminal: "terminal",
      cli: "terminal",
      shell: "terminal",
      console: "terminal",
      bash: "terminal",
      ssh: "terminal",
      code: "code",
      git: "code",
      gitea: "code",
      forgejo: "code",
      github: "code",
      gitlab: "code",
      dev: "code",
      shield: "shield",
      security: "shield",
      vpn: "shield",
      wireguard: "shield",
      tailscale: "shield",
      vaultwarden: "shield",
      bitwarden: "shield",
      auth: "shield",
      authelia: "shield",
      authentik: "shield",
      lock: "lock",
      unlock: "unlock",
      cloud: "cloud",
      nextcloud: "cloud",
      owncloud: "cloud",
      sync: "cloud",
      globe: "globe",
      web: "globe",
      site: "globe",
      website: "globe",
      internet: "globe",
      domain: "globe",
      music: "music",
      audio: "music",
      sound: "music",
      navidrome: "music",
      spotify: "music",
      film: "film",
      movie: "film",
      media: "film",
      plex: "film",
      jellyfin: "film",
      emby: "film",
      tv: "tv",
      television: "tv",
      monitor: "tv",
      display: "tv",
      screen: "tv",
      "hard-drive": "hard-drive",
      harddrive: "hard-drive",
      hdd: "hard-drive",
      ssd: "hard-drive",
      disk: "hard-drive",
      storage: "hard-drive",
      drive: "hard-drive",
      cpu: "cpu",
      chip: "cpu",
      processor: "cpu",
      hardware: "cpu",
      esphome: "cpu",
      microcontroller: "cpu",
      zap: "zap",
      bolt: "zap",
      power: "zap",
      energy: "zap",
      wled: "zap",
      automation: "zap",
      electricity: "zap",
      sliders: "sliders",
      settings: "sliders",
      control: "sliders",
      tuning: "sliders",
      config: "sliders",
      options: "sliders",
      bell: "bell",
      notification: "bell",
      notifications: "bell",
      alarm: "bell",
      alerts: "bell",
      alert: "alert",
      warning: "alert",
      thermometer: "thermometer",
      temp: "thermometer",
      temperature: "thermometer",
      climate: "thermometer",
      weather: "thermometer",
      sensor: "thermometer",
      sensors: "thermometer",
      printer: "printer",
      "3dprinter": "printer",
      "3d-printer": "printer",
      octoprint: "printer",
      klipper: "printer",
      mainsail: "printer",
      fluidd: "printer",
      download: "download",
      downloads: "download",
      torrent: "download",
      torrents: "download",
      transmission: "download",
      qbittorrent: "download",
      deluge: "download",
      aria2: "download",
      lightbulb: "lightbulb",
      light: "lightbulb",
      lights: "lightbulb",
      lamp: "lightbulb",
      bulb: "lightbulb",
      hue: "lightbulb",
      docker: "docker",
      container: "docker",
      containers: "docker",
      portainer: "docker",
      podman: "docker",
      eye: "eye",
      vision: "eye",
      detection: "eye",
      detect: "eye",
      folder: "folder",
      folders: "folder",
      files: "folder",
      filebrowser: "folder",
      explorer: "folder",
      timer: "timer",
      time: "timer",
      clock: "timer",
      package: "package",
      box: "package",
      key: "key",
      qr: "qr",
      fingerprint: "fingerprint",
    };
    const target = aliases[normalized] || normalized;
    if (document.getElementById("i-" + target)) {
      return '<span class="service-icon" aria-hidden="true"><svg class="icon"><use href="#i-' + escapeHtml(target) + '"></use></svg></span>';
    }
    // Fallback: render as text/emoji if it is a unicode character or non-sprite icon
    return '<span class="service-icon" aria-hidden="true">' + escapeHtml(clean) + '</span>';
  }

  /**
   * Draw the services health bar: a proportional strip of up/down/unknown
   * segments plus the counts in the legend. Segment widths are plain numbers
   * set via `setAttribute` on SVG `<rect>`s (same technique as the telemetry
   * sparklines), never inline `style` — the CSP has no style-src
   * 'unsafe-inline'. Hidden entirely when there is nothing to summarize.
   */
  function renderServicesHealth() {
    if (!el.servicesHealth) return;
    const total = state.services.length;
    if (total === 0) {
      el.servicesHealth.classList.add("hidden");
      return;
    }
    let up = 0, down = 0, unknown = 0;
    for (const svc of state.services) {
      if (svc.status === "up") up++;
      else if (svc.status === "down") down++;
      else unknown++;
    }
    el.servicesHealth.classList.remove("hidden");
    const upW = (up / total) * 100;
    const downW = (down / total) * 100;
    const unknownW = (unknown / total) * 100;
    if (el.healthSegUp) { el.healthSegUp.setAttribute("x", "0"); el.healthSegUp.setAttribute("width", upW.toFixed(2)); }
    if (el.healthSegDown) { el.healthSegDown.setAttribute("x", upW.toFixed(2)); el.healthSegDown.setAttribute("width", downW.toFixed(2)); }
    if (el.healthSegUnknown) { el.healthSegUnknown.setAttribute("x", (upW + downW).toFixed(2)); el.healthSegUnknown.setAttribute("width", unknownW.toFixed(2)); }
    if (el.healthCountUp) el.healthCountUp.textContent = up + (up === 1 ? " ativo" : " ativos");
    if (el.healthCountDown) el.healthCountDown.textContent = down + (down === 1 ? " inativo" : " inativos");
    if (el.healthCountUnknown) el.healthCountUnknown.textContent = unknown + " aguardando";
  }

  function renderServices() {
    el.servicesList.innerHTML = "";
    renderServicesHealth();
    if (!state.tunnelURL) return;
    if (state.services.length === 0) {
      el.servicesList.innerHTML =
        '<p class="services-empty" role="status">Nenhum serviço na visualização.</p>';
      return;
    }
    state.services.forEach((svc) => {
      const card = document.createElement("div");
      card.className = "service-card";
      // A trailing slash matters here: proxied SPAs (Frigate's is the known
      // case) fetch some of their own assets via relative URLs resolved
      // against the current document's path. Land the browser on
      // ".../frigate" (no slash) and the resolver drops "frigate" itself
      // when resolving "locales/en/x.json", sending it to the origin root
      // instead of under the service's own prefix. ".../frigate/" resolves
      // it correctly.
      const redirectPath = (svc.prefix || "/").replace(/\/*$/, "/");
      // Percent-encode both values: they land inside an href attribute, and
      // the prefix arrives over the wire from the host's DM.
      const href = state.tunnelURL + "/auth?token=" +
        encodeURIComponent(state.authToken || "") +
        "&redirect=" + encodeURIComponent(redirectPath);
      card.innerHTML =
        serviceIcon(svc.icon) +
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

  function onToggleRelays() {
    const willShow = el.relayPanel.classList.contains("hidden");
    el.relayPanel.classList.toggle("hidden", !willShow);
    el.btnToggleRelays.setAttribute("aria-expanded", String(willShow));
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
