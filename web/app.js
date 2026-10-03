/* app.js — main SPA controller */
import { NostrAuth } from './js/nostr_auth.js';
import { NostrClient } from './js/nostr_client.js';
import { RelayManager } from './js/relay_manager.js';
import { SessionManager } from './js/session_manager.js';
import { startScan } from './js/qr_scanner.js';
import {
  CUSTOM_SERVICES_STORAGE_KEY,
  CUSTOM_SERVICE_STRINGS,
  SAFE_SERVICE_ICONS,
  createCustomService,
  exportCustomServicesNix,
  exportCustomServicesYaml,
  mergeHostAndCustomServices,
  parseCustomServices,
  serializeCustomServices,
} from './js/custom_services.js';
import {
  captureReturnTo,
  readReturnTo,
  clearReturnTo,
  describeTarget,
  resumeTarget,
} from './js/return_to.js';
import {
  clearStepUp,
  getStepUpHeader,
  redeemAndOpen,
  requestStepUp,
  serviceHref,
} from './js/api_client.js';

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const el = {
    app: $("app"),
    loading: $("loading"),
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
    localPortSection: $("local-port-section"),
    localPortInput: $("local-port-input"),
    localPortStatus: $("local-port-status"),
    btnOpenLocalPort: $("btn-open-local-port"),
    tunnelStatus: $("tunnel-status"),
    relayStatus: $("relay-status"),
    themeToggle: $("theme-toggle"),
    railTunnel: $("rail-tunnel"),
    railTunnelDot: $("rail-tunnel-dot"),
    railSession: $("rail-session"),
    railSessionDot: $("rail-session-dot"),
    railRelay: $("rail-relay"),
    railRelayDot: $("rail-relay-dot"),
    railService: $("rail-service"),
    railServiceDot: $("rail-service-dot"),
    btnAppearance: $("btn-appearance"),
    btnAppearanceClose: $("btn-appearance-close"),
    appearancePanel: $("appearance-panel"),
    themeGroup: $("theme-group"),
    paletteGroup: $("palette-group"),
    densityGroup: $("density-group"),
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
    sessionSetup: $("session-setup"),
    sessionLive: $("session-live"),
    sessionStatusText: $("session-status-text"),
    sessionStatePill: $("session-state-pill"),
    sessionNpub: $("session-npub"),
    sessionIdenticon: $("session-identicon"),
    sessionPendingIcon: $("session-pending-icon"),
    sessionDiscoveryNote: $("session-discovery-note"),
    sessionNip44Pill: $("session-nip44-pill"),
    vaultStatePill: $("vault-state-pill"),
    countdownWrap: $("countdown-wrap"),
    countdownRect: $("countdown-rect"),
    countdownText: $("countdown-text"),
    kpiSessionCountdown: $("kpi-session-countdown"),
    biometricEnroll: $("biometric-enroll"),
    biometricPin: $("biometric-pin"),
    btnEnableBiometricLater: $("btn-enable-biometric-later"),
    hostTelemetrySection: $("host-telemetry-section"),
    telUptime: $("tel-uptime"),
    telLive: $("tel-live"),
    telUpdated: $("tel-updated"),
    telMeters: $("tel-meters"),
    telStorage: $("tel-storage"),
    telStorageList: $("tel-storage-list"),
    telStorageCount: $("tel-storage-count"),
    histWindowGroup: $("hist-window-group"),
    histMetricGroup: $("hist-metric-group"),
    histValue: $("hist-value"),
    histUnit: $("hist-unit"),
    histMin: $("hist-min"),
    histAvg: $("hist-avg"),
    histMax: $("hist-max"),
    histGrid: $("hist-grid"),
    histThreshold: $("hist-threshold"),
    histFill: $("hist-fill"),
    histLine: $("hist-line"),
    histStatus: $("hist-status"),
    histChartFrame: document.querySelector("#host-telemetry-section .chart-frame"),
    btnToggleDebug: $("btn-toggle-debug"),
    debugSection: $("debug-section"),
    debugLog: $("debug-log"),
    btnRunDiagnostics: $("btn-run-diagnostics"),
    btnClearDebug: $("btn-clear-debug"),
    servicesHealth: $("services-health"),
    healthSegUp: $("health-seg-up"),
    healthSegDown: $("health-seg-down"),
    healthSegUnknown: $("health-seg-unknown"),
    healthCountUp: $("health-count-up"),
    healthCountDown: $("health-count-down"),
    healthCountUnknown: $("health-count-unknown"),
    servicesOverview: $("services-overview"),
    servicesOverviewList: $("services-overview-list"),
    servicesOverviewCount: $("services-overview-count"),
    btnToggleCustomService: $("btn-toggle-custom-service"),
    customServiceForm: $("custom-service-form"),
    customServiceName: $("custom-service-name"),
    customServicePort: $("custom-service-port"),
    customServiceIcon: $("custom-service-icon"),
    customServiceDescription: $("custom-service-description"),
    customServiceWebsocket: $("custom-service-websocket"),
    customServicePersist: $("custom-service-persist"),
    customServiceStatus: $("custom-service-status"),
    btnExportServicesYaml: $("btn-export-services-yaml"),
    btnExportServicesNix: $("btn-export-services-nix"),
    returnBanner: $("return-banner"),
    returnBannerText: $("return-banner-text"),
    returnBannerLink: $("return-banner-link"),
    btnReturnCancel: $("btn-return-cancel"),
  };

  let expiryTimer = null;
  let discoveryTimer = null;
  let telemetryTimer = null;
  let telemetryFetchInFlight = false;
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
   * Where the daemon bounced this browser from (see js/return_to.js). Read
   * once at startup, honored once a fresh token arrives, then forgotten.
   */
  let returnTo = null;
  /** Timer for the grace period before the automatic return navigation. */
  let returnTimer = null;

  /**
   * How long the "returning to X" banner stays before navigating. Long
   * enough to read it and cancel, short enough not to feel stuck — the user
   * clicked a service link and is waiting to arrive.
   */
  const RETURN_DELAY_MS = 2500;

  const SERVICES_ORDER_KEY = "dl_conn_services_order";

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
   * Refresh the host health card often enough to feel live without overlap.
   * There used to be client-side ring buffers backing sparklines here, but
   * they only ever showed what this tab had observed since it loaded — they
   * reset on every reload. The history panel now reads the daemon's
   * telemetry_samples table instead, so a window is a real range query.
   */
  const TELEMETRY_POLL_MS = 2000;
  /** Host telemetry endpoint, the one route the operator can put behind step-up. */
  const TELEMETRY_PATH = "/api/host/telemetry";

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
      // formatUptime/formatCapacity inlined, so the panel renderers below are
      // undeclared there. `typeof x === "function"` never throws on an
      // undeclared identifier, unlike calling it directly would.
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
    if (typeof renderMeters === "function") renderMeters(snap);
    if (typeof renderStorage === "function") renderStorage(snap);
  }

  /* ══════════════════════════════════════════════════════════════════
     Host monitoring panel

     Two layers over one snapshot: live meters (current value plus a bar
     against a threshold) and a history chart fed by
     /api/host/telemetry?from=&to=, which reads the daemon's SQLite
     telemetry_samples table. The history therefore survives a reload,
     which the client-side ring buffer it replaced did not.

     Every bar and every chart point is an SVG geometry attribute set
     with setAttribute — never an inline `style`, because the page CSP
     declares style-src 'self' with no 'unsafe-inline'. Colors come from
     the dataviz tokens in style.css, so switching palette recolors this
     whole surface without touching a rule here.
     ══════════════════════════════════════════════════════════════════ */

  /** Percentage at which a meter turns amber, per resource. */
  const METER_WARN_PCT = { cpu: 80, ram: 85, disk: 90, gpu: 90, battery: 20 };
  /** Percentage at which it turns red. */
  const METER_CRIT_PCT = { cpu: 95, ram: 95, disk: 97, gpu: 97, battery: 10 };
  /** A battery meter drains downward, so its states are inverted. */
  const BATTERY_METER = "battery";
  /** The busiest mountpoint stands in for "disk" in the history chart. */
  const HISTORY_METRICS = ["cpu", "ram", "disk", "gpu"];
  /** Cap on drawn points: more than this is indistinguishable at 1px. */
  const HISTORY_MAX_POINTS = 240;

  /** Cached meter shells, keyed by resource, built on first sight. */
  const meterRefs = new Map();

  /**
   * State class for a meter at `pct`. Returns "" for healthy, and an
   * empty string when there is no reading — an unknown value must never
   * be painted as a healthy one.
   */
  function meterState(key, pct) {
    if (pct == null || isNaN(pct)) return "";
    if (key === BATTERY_METER) {
      if (pct <= METER_CRIT_PCT[BATTERY_METER]) return " is-crit";
      if (pct <= METER_WARN_PCT[BATTERY_METER]) return " is-warn";
      return "";
    }
    if (pct >= METER_CRIT_PCT[key]) return " is-crit";
    if (pct >= METER_WARN_PCT[key]) return " is-warn";
    return "";
  }

  /**
   * Build the meter shell for `key` on first call and return its parts.
   * The bar is an SVG rect whose `width` is what we animate, so a meter
   * update is a single setAttribute rather than a style mutation.
   */
  function ensureMeter(host, key, label) {
    let refs = meterRefs.get(key);
    if (refs) return refs;
    const wrap = document.createElement("div");
    wrap.className = "meter";
    wrap.setAttribute("role", "meter");
    wrap.setAttribute("aria-valuemin", "0");
    wrap.setAttribute("aria-valuemax", "100");
    wrap.setAttribute("aria-label", label);
    wrap.innerHTML =
      '<div class="meter-head">' +
        '<span class="meter-label"></span>' +
        '<span class="meter-value num"></span>' +
      "</div>" +
      '<svg class="meter-bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">' +
        '<rect class="meter-track" x="0" y="0" width="100" height="6"></rect>' +
        '<rect class="meter-fill" x="0" y="0" width="0" height="6"></rect>' +
        '<rect class="meter-tick" x="0" y="0" width="1" height="6"></rect>' +
      "</svg>" +
      '<span class="meter-sub"></span>';
    wrap.querySelector(".meter-label").textContent = label;
    host.appendChild(wrap);
    refs = {
      wrap: wrap,
      value: wrap.querySelector(".meter-value"),
      sub: wrap.querySelector(".meter-sub"),
      fill: wrap.querySelector(".meter-fill"),
      tick: wrap.querySelector(".meter-tick"),
    };
    meterRefs.set(key, refs);
    return refs;
  }

  /** Write one reading into a meter. `pct` may be null (unknown). */
  function setMeter(refs, key, labelText, valueText, pct, subText) {
    if (!refs) return;
    refs.wrap.className = "meter" + meterState(key, pct);
    refs.value.textContent = valueText;
    refs.sub.textContent = subText || "";
    const width = pct == null || isNaN(pct) ? 0 : Math.max(0, Math.min(100, pct));
    refs.fill.setAttribute("width", width.toFixed(2));
    // The tick marks the warn threshold, so the bar reads as a scale
    // rather than as a progress bar with no goalpost.
    refs.tick.setAttribute("x", String(METER_WARN_PCT[key]));
    refs.wrap.setAttribute("aria-valuenow", pct == null || isNaN(pct) ? "" : pct.toFixed(0));
    refs.wrap.setAttribute("aria-valuetext", labelText + ": " + valueText);
  }

  /**
   * CPU as a percentage of capacity. A raw load average is not a
   * dashboard metric — 0.42 means idle on a 4-core box and busy on a
   * 64-core one — so it is normalized by the core count the collector
   * reports. Without that count we show the raw load and no bar rather
   * than inventing a percentage.
   */
  function cpuPercent(snap) {
    const load1 = snap && snap.cpu ? snap.cpu.load1 : null;
    const cores = snap ? snap.num_cpu : null;
    if (load1 == null || !cores) return null;
    return (load1 / cores) * 100;
  }

  /** Render the live meters for every resource the host actually reports. */
  function renderMeters(snap) {
    const host = el.telMeters;
    if (!host || !snap) return;
    meterRefs.clear();
    host.replaceChildren();
    if (el.telUptime) el.telUptime.textContent = formatUptime(snap.uptime_s);

    // CPU
    const cpu = snap.cpu || null;
    const cpuPct = cpuPercent(snap);
    if (cpu) {
      const bits = [];
      if (cpu.temp_c != null) bits.push(cpu.temp_c.toFixed(1) + " °C");
      if (cpu.freq_mhz != null) bits.push((cpu.freq_mhz / 1000).toFixed(1) + " GHz");
      if (cpuPct == null && cpu.load1) bits.push("carga " + cpu.load1.toFixed(2));
      setMeter(
        ensureMeter(host, "cpu", "CPU"),
        "cpu",
        "CPU",
        cpuPct == null ? (cpu.load1 ? cpu.load1.toFixed(2) : "—") : cpuPct.toFixed(0) + "%",
        cpuPct,
        bits.join(" · ") || "—"
      );
    }

    // Memory
    const mem = snap.memory || null;
    if (mem) {
      setMeter(
        ensureMeter(host, "ram", "Memória"),
        "ram",
        "Memória",
        mem.used_pct.toFixed(0) + "%",
        mem.used_pct,
        formatCapacity(mem.used_mb) + " / " + formatCapacity(mem.total_mb)
      );
    }

    // GPU — the bar tracks utilization; temperature rides in the sub-line
    // because it is a different quantity and must not share a scale.
    const gpu = snap.gpu || null;
    if (gpu && gpu.util_pct != null) {
      const bits = [];
      if (gpu.temp_c != null) bits.push(gpu.temp_c.toFixed(1) + " °C");
      setMeter(
        ensureMeter(host, "gpu", "GPU"),
        "gpu",
        "GPU",
        gpu.util_pct.toFixed(0) + "%",
        gpu.util_pct,
        bits.join(" · ") || "—"
      );
    }

    // Battery — inverts: a full battery is healthy, an empty one is not.
    const batt = snap.battery || null;
    if (batt && batt.available && batt.capacity_pct != null) {
      setMeter(
        ensureMeter(host, "battery", "Bateria"),
        "battery",
        "Bateria",
        batt.capacity_pct + "%",
        batt.capacity_pct,
        batt.status || ""
      );
    }
  }

  /** One row per mount: the volume that is filling up must be its own line. */
  function renderStorage(snap) {
    const host = el.telStorageList;
    if (!host || !snap) return;
    const disks = snap.disks && snap.disks.length
      ? snap.disks
      : (snap.disk_used_pct != null
          ? [{ mountpoint: snap.mountpoint || "/", used_pct: snap.disk_used_pct,
               used_mb: snap.disk_used_mb, total_mb: snap.disk_total_mb }]
          : []);
    if (!el.telStorage) return;
    if (!disks.length) {
      el.telStorage.classList.add("hidden");
      host.replaceChildren();
      return;
    }
    el.telStorage.classList.remove("hidden");
    if (el.telStorageCount) {
      el.telStorageCount.textContent = disks.length === 1
        ? "1 ponto de montagem"
        : disks.length + " pontos de montagem";
    }
    const frag = document.createDocumentFragment();
    for (const d of disks) {
      const row = document.createElement("div");
      row.className = "storage-row" + meterState("disk", d.used_pct);
      row.innerHTML =
        '<span class="storage-mount"></span>' +
        '<svg class="storage-bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">' +
          '<rect class="storage-track" x="0" y="0" width="100" height="6"></rect>' +
          '<rect class="storage-fill" x="0" y="0" width="0" height="6"></rect>' +
        "</svg>" +
        '<span class="storage-pct"></span>' +
        '<span class="storage-size"></span>';
      row.querySelector(".storage-mount").textContent = d.mountpoint;
      row.querySelector(".storage-pct").textContent = d.used_pct.toFixed(0) + "%";
      row.querySelector(".storage-size").textContent =
        formatCapacity(d.used_mb) + " / " + formatCapacity(d.total_mb);
      row.querySelector(".storage-fill")
        .setAttribute("width", Math.max(0, Math.min(100, d.used_pct)).toFixed(2));
      frag.appendChild(row);
    }
    host.replaceChildren(frag);
  }

  /* ── History chart ──────────────────────────────────────────────── */

  const historyState = { windowSec: 604800, metric: "cpu", samples: null, inFlight: false };

  /** Extract one chartable percentage from a snapshot; null if unavailable. */
  function historyValue(snap, metric) {
    if (!snap) return null;
    if (metric === "cpu") return cpuPercent(snap);
    if (metric === "ram") return snap.memory ? snap.memory.used_pct : null;
    if (metric === "gpu") return snap.gpu && snap.gpu.util_pct != null ? snap.gpu.util_pct : null;
    if (metric === "disk") {
      if (snap.disks && snap.disks.length) {
        return snap.disks.reduce((m, d) => Math.max(m, d.used_pct || 0), 0);
      }
      return snap.disk_used_pct != null ? snap.disk_used_pct : null;
    }
    return null;
  }

  /**
   * Bucket-average the series down to at most HISTORY_MAX_POINTS. A 7-day
   * window can hold tens of thousands of samples; drawing them all is
   * wasted work and, at sub-pixel spacing, a smear rather than a line.
   */
  function downsample(points, maxPoints) {
    if (points.length <= maxPoints) return points;
    const bucketSize = points.length / maxPoints;
    const out = [];
    for (let i = 0; i < maxPoints; i++) {
      const start = Math.floor(i * bucketSize);
      const end = Math.min(points.length, Math.floor((i + 1) * bucketSize));
      let sum = 0;
      let n = 0;
      for (let j = start; j < end; j++) { sum += points[j][1]; n++; }
      if (!n) continue;
      out.push([points[start][0], sum / n]);
    }
    return out;
  }

  /** Draw grid, threshold, line and fill for the current history state. */
  function renderHistory() {
    if (!el.histLine) return;
    const samples = historyState.samples;
    const key = historyState.metric;
    const points = [];
    if (samples) {
      for (const s of samples) {
        const v = historyValue(s, key);
        if (v == null || isNaN(v)) continue;
        const ts = Date.parse(s.sampled_at) / 1000;
        if (!isFinite(ts)) continue;
        points.push([ts, v]);
      }
    }
    const reduced = downsample(points, HISTORY_MAX_POINTS);

    if (el.histChartFrame) el.histChartFrame.classList.toggle("is-empty", !reduced.length);

    // Gridlines: four horizontal rules plus the warn threshold marker.
    if (el.histGrid) {
      const frag = document.createDocumentFragment();
      for (let i = 1; i < 4; i++) {
        const y = (i / 4) * 40;
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", "0");
        line.setAttribute("x2", "100");
        line.setAttribute("y1", y.toFixed(2));
        line.setAttribute("y2", y.toFixed(2));
        frag.appendChild(line);
      }
      el.histGrid.replaceChildren(frag);
    }

    // The series is a percentage, so the scale is always 0..100 — a
    // self-scaling axis would make a flat line look like a storm.
    const toY = (v) => (40 - (Math.max(0, Math.min(100, v)) / 100) * 40).toFixed(2);
    if (el.histThreshold) {
      el.histThreshold.setAttribute("y1", toY(METER_WARN_PCT[key]));
      el.histThreshold.setAttribute("y2", toY(METER_WARN_PCT[key]));
    }

    if (!reduced.length) {
      el.histLine.setAttribute("points", "");
      if (el.histFill) el.histFill.setAttribute("points", "");
      for (const node of [el.histValue, el.histMin, el.histAvg, el.histMax]) {
        if (node) node.textContent = "—";
      }
      if (el.histUnit) el.histUnit.textContent = "";
      if (el.histStatus) {
        el.histStatus.textContent = historyState.samples
          ? "Sem amostras para esta métrica na janela selecionada."
          : "Histórico indisponível neste host.";
      }
      return;
    }

    // x is positional, not time-linear: a gap in sampling should read as
    // a gap, and an even spread keeps the line continuous.
    const step = reduced.length > 1 ? 100 / (reduced.length - 1) : 0;
    const coords = reduced.map((p, i) => {
      const x = reduced.length > 1 ? i * step : 100;
      return x.toFixed(2) + "," + toY(p[1]);
    });
    el.histLine.setAttribute("points", coords.join(" "));
    if (el.histFill) {
      const lastX = ((reduced.length - 1) * step).toFixed(2);
      el.histFill.setAttribute(
        "points",
        ["0,40"].concat(coords).concat([lastX + ",40"]).join(" ")
      );
    }

    const values = reduced.map((p) => p[1]);
    const last = values[values.length - 1];
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    if (el.histValue) el.histValue.textContent = last.toFixed(0) + "%";
    if (el.histUnit) el.histUnit.textContent = "de capacidade";
    if (el.histMin) el.histMin.textContent = min.toFixed(0) + "%";
    if (el.histAvg) el.histAvg.textContent = avg.toFixed(0) + "%";
    if (el.histMax) el.histMax.textContent = max.toFixed(0) + "%";
    if (el.histStatus) {
      const hours = Math.round(historyState.windowSec / 3600);
      const window = hours >= 24 ? Math.round(hours / 24) + "d" : hours + "h";
      el.histStatus.textContent = reduced.length + " amostras · janela de " + window;
    }
  }

  /**
   * Load the selected window from the daemon. Falls back to "no history"
   * rather than erroring, so an older daemon that ignores the query
   * params still leaves the rest of the panel working.
   */
  async function fetchHistory() {
    if (historyState.inFlight) return;
    historyState.inFlight = true;
    const to = Math.floor(Date.now() / 1000);
    const from = to - historyState.windowSec;
    try {
      const r = await telemetryGet(TELEMETRY_PATH + "?from=" + from + "&to=" + to);
      if (!r.ok) throw new Error("telemetry history: " + r.status);
      const data = await r.json();
      historyState.samples = Array.isArray(data) ? data : null;
    } catch (_) {
      historyState.samples = null;
    } finally {
      historyState.inFlight = false;
      renderHistory();
    }
  }

  /** Wire the window and metric segmented controls. */
  function setupHistoryControls() {
    const pick = (group, attr, apply) => {
      if (!group) return;
      group.addEventListener("click", (event) => {
        const btn = event.target.closest(".seg[data-" + attr + "]");
        if (!btn || !group.contains(btn)) return;
        for (const other of group.querySelectorAll(".seg")) {
          other.classList.toggle("is-on", other === btn);
        }
        apply(btn.dataset[attr]);
      });
    };
    pick(el.histWindowGroup, "window", (v) => {
      historyState.windowSec = Number(v) || 604800;
      fetchHistory();
    });
    pick(el.histMetricGroup, "metric", (v) => {
      historyState.metric = HISTORY_METRICS.indexOf(v) >= 0 ? v : "cpu";
      renderHistory();
    });
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

  /** 1s ticker so the "ha Xs" label counts up between telemetry fetches. */
  function startLiveTicker() {
    if (liveTicker) clearInterval(liveTicker);
    liveTicker = setInterval(function () {
      if (lastTelemetryAt) updateLiveBadge(true);
    }, 1000);
  }

  /**
   * GET the telemetry route, minting a step-up proof once if the operator
   * put the endpoint behind one. Refusal drives the proof, not the poll: an
   * operator who never enabled step-up pays nothing for this. Shared by the
   * live poll and the history query so both honour it identically.
   */
  async function telemetryGet(url) {
    let r = await fetch(url, {
      credentials: "include",
      headers: getStepUpHeader() || undefined,
    });
    if (r.status === 401 && getStepUpHeader() === null) {
      await requestStepUp(state.tunnelURL);
      r = await fetch(url, {
        credentials: "include",
        headers: getStepUpHeader() || undefined,
      });
    }
    return r;
  }

  async function fetchTelemetry() {
    // A slow request must not pile up behind the 2s interval.
    if (telemetryFetchInFlight) return;
    telemetryFetchInFlight = true;
    try {
      const r = await telemetryGet(TELEMETRY_PATH);
      if (!r.ok) { updateLiveBadge(false); return; }
      const snap = await r.json();
      renderTelemetry(snap);
      lastTelemetryAt = Date.now();
      updateLiveBadge(true);
      // Load the history window once the live route has proven reachable,
      // so the chart never fires before a session is actually established.
      if (historyState.samples === null && !historyState.inFlight) fetchHistory();
    } catch (_) {
      updateLiveBadge(false);
    } finally {
      telemetryFetchInFlight = false;
    }
  }

  function startTelemetryPolling() {
    if (telemetryTimer) clearInterval(telemetryTimer);
    // Reveal the card immediately so the user sees the dashboard is loading,
    // rather than a blank Live column that looks broken until the first
    // successful fetch lands.
    if (el.hostTelemetrySection) el.hostTelemetrySection.classList.remove("hidden");
    fetchTelemetry();
    telemetryTimer = setInterval(fetchTelemetry, TELEMETRY_POLL_MS);
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
          telemetryTimer = setInterval(fetchTelemetry, TELEMETRY_POLL_MS);
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
    hostServices: [],
    customServices: [],
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
    // Read "?next=" before anything else can navigate: this is the whole
    // record of where the user was going when their link expired.
    returnTo = captureReturnTo();
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
    loadCustomServices();
    populateCustomServiceIcons();
    state.session.on(onSessionEvent);
    state.relayManager.on(onRelayEvent);
    bindEvents();
    initAutoLockUI();
    setupHistoryControls();
    setupAppearancePanel();
    setupStatusRail();
    checkVaultState();
  }

  function checkVaultState() {
    if (state.session.hasVault) showUnlockScreen();
    else showLoginScreen();
    announcePendingReturn();
  }

  /**
   * Tell the user *why* they are looking at a login screen they didn't ask
   * for. Without this, a bounce from an expired Frigate link is
   * indistinguishable from opening the app cold, and the automatic
   * navigation that follows looks like the app hijacking the tab.
   */
  function announcePendingReturn() {
    if (!returnTo) return;
    const label = describeTarget(returnTo, state.services) || returnTo;
    el.vaultStatus.textContent =
      "Sua sessão expirou. Entre novamente para voltar para " + label + ".";
  }

  /**
   * Mirrors the KPI-style state pill onto the still-locked/logged-out card
   * head, matching the prototype's session-summary composition where the
   * card always shows a pill ("sem sessão" / "Bloqueada") next to the title
   * instead of a bare icon.
   */
  function setVaultStatePill(text, variant, dotClass) {
    if (!el.vaultStatePill) return;
    el.vaultStatePill.className = "pill" + (variant ? " " + variant : "");
    el.vaultStatePill.textContent = "";
    if (dotClass) {
      const dot = document.createElement("span");
      dot.className = "dot " + dotClass;
      dot.setAttribute("aria-hidden", "true");
      el.vaultStatePill.appendChild(dot);
    }
    el.vaultStatePill.appendChild(document.createTextNode(text));
  }

  /**
   * Foca e seleciona o input de PIN do unlock, para o usuário começar a
   * digitar imediatamente quando a tela de desbloqueio aparece (vault já
   * existe com PIN salvo). Usa um tick de setTimeout para garantir que o
   * elemento esteja visível (classList.remove("hidden") sincronizado) e foco
   * real antes da seleção — alguns navegadores recusam .select() sem .focus()
   * prévio.
   */
  function focusPinInput() {
    if (!el.pinInput) return;
    el.pinInput.focus();
    setTimeout(() => el.pinInput.select(), 0);
  }

  function showUnlockScreen() {
    el.sessionSetup.classList.remove("hidden");
    el.sessionLive.classList.add("hidden");
    el.unlockUi.classList.remove("hidden");
    el.loginUi.classList.add("hidden");
    el.vaultSavePrompt.classList.add("hidden");
    el.hostNpubSection.classList.add("hidden");
    setVaultStatePill("bloqueada", "p-warn", "dot-warn");
    const hint = state.session.getVaultHint();
    el.unlockIdentity.textContent = hint ? "Identidade salva: " + hint : "";
    el.vaultStatus.textContent = "Vault bloqueado. Desbloqueie para continuar.";
    state.session.canUseBiometric().then((ok) => {
      el.btnUnlockBio.classList.toggle("hidden", !ok);
    });
    focusPinInput();
  }

  function showLoginScreen() {
    el.sessionSetup.classList.remove("hidden");
    el.sessionLive.classList.add("hidden");
    el.unlockUi.classList.add("hidden");
    el.loginUi.classList.remove("hidden");
    el.loginNip07.classList.remove("hidden");
    el.btnScanQr.classList.remove("hidden");
    if (el.nsecFallback) el.nsecFallback.classList.remove("hidden");
    el.vaultSavePrompt.classList.add("hidden");
    setVaultStatePill("sem sessão", "p-warn", "dot-warn");
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
    renderCountdown();
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
    el.btnToggleCustomService.addEventListener("click", onToggleCustomServiceForm);
    el.customServiceForm.addEventListener("submit", onAddCustomService);
    el.btnExportServicesYaml.addEventListener("click", () => onExportCustomServices("yaml"));
    el.btnExportServicesNix.addEventListener("click", () => onExportCustomServices("nix"));
    el.btnClearAll.addEventListener("click", onClearAll);
    el.btnOpenLocalPort.addEventListener("click", onOpenLocalPort);
    el.localPortInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") onOpenLocalPort();
    });
    el.btnScanQr.addEventListener("click", onScanQr);
    el.btnQrClose.addEventListener("click", stopQrScan);
    // Escape closes the modal scanner and returns focus to its opener.
    wireDialog(el.qrOverlay, { modal: true });
    if (el.btnReturnCancel) el.btnReturnCancel.addEventListener("click", cancelReturn);
    el.autoLockTimeout.addEventListener("change", onAutoLockChange);
    el.btnEnableBiometricLater.addEventListener("click", onEnableBiometricLater);
    el.biometricPin.addEventListener("keypress", (e) => { if (e.key === "Enter") onEnableBiometricLater(); });
    el.btnToggleDebug.addEventListener("click", onToggleDebug);
    el.btnRunDiagnostics.addEventListener("click", runDiagnostics);
    el.btnClearDebug.addEventListener("click", onClearDebug);
  }

  /**
   * The KPI value is clipped to one line with an ellipsis (see .kpi-value in
   * style.css) so a long tunnel URL cannot stretch every card sharing its
   * grid row; the full text is kept reachable on hover/focus via the native
   * title tooltip.
   */
  function setTunnelStatus(text) {
    if (!el.tunnelStatus) return;
    el.tunnelStatus.textContent = text;
    el.tunnelStatus.setAttribute("title", text);
  }

  function setSessionStatus(text, tone) {
    if (!el.sessionStatus) return;
    // #session-status is a wrapper around the human text and the live
    // countdown (#kpi-session-countdown); write the text into the inner span
    // so the ticker's sibling node is never clobbered by a state change.
    const target = el.sessionStatusText || el.sessionStatus;
    target.textContent = text;
    // Reassigning className outright would drop "kpi-value" (the element also
    // lives inside a .kpi-card now), so only the status-* tone class is
    // swapped in/out.
    Array.from(el.sessionStatus.classList).forEach((c) => {
      if (c.startsWith("status-") && c !== "status-value") el.sessionStatus.classList.remove(c);
    });
    if (tone) el.sessionStatus.classList.add("status-" + tone);
  }

  /** Mirrors the KPI state onto the unified session card's pill. */
  function setSessionPill(text, variant, dotClass) {
    if (!el.sessionStatePill) return;
    el.sessionStatePill.className = "pill session-state" + (variant ? " " + variant : "");
    el.sessionStatePill.textContent = "";
    if (dotClass) {
      const dot = document.createElement("span");
      // "live-dot" is the pulsing indicator (matches the prototype's pending
      // pill); every other dot is a static status color and keeps the base
      // "dot" class.
      dot.className = dotClass === "live-dot" ? "live-dot" : "dot " + dotClass;
      dot.setAttribute("aria-hidden", "true");
      el.sessionStatePill.appendChild(dot);
    }
    el.sessionStatePill.appendChild(document.createTextNode(text));
  }

  /** FNV-1a over the npub tail → 3×3 identicon, pure classes, CSP-safe. */
  function buildIdenticon(node, npub) {
    node.textContent = "";
    let h = 2166136261;
    const src = (npub || "dl_conn").slice(-24);
    for (let i = 0; i < src.length; i++) {
      h ^= src.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    for (let i = 0; i < 9; i++) {
      const cell = document.createElement("i");
      const v = (h >> ((i % 8) * 3)) & 3;
      if (v > 0) cell.className = "on-" + v;
      node.appendChild(cell);
    }
  }

  function renderSessionIdentity() {
    const npub = (state.session && state.session.npub) || "";
    if (el.sessionNpub) {
      el.sessionNpub.textContent = npub ? truncateNpub(npub) : "—";
      el.sessionNpub.setAttribute("title", npub || "Identidade ativa (npub)");
    }
    if (el.sessionIdenticon) buildIdenticon(el.sessionIdenticon, npub);
  }

  /**
   * Mirrors the prototype's dedicated "aguardando host" composition: while
   * the key is unlocked but the daemon has not answered the discovery DM yet
   * (SessionManager's "pending" window), the identicon steps aside for a
   * relay icon tile and the card explains what is happening instead of just
   * showing an npub with a differently colored pill.
   */
  function setSessionPendingVisual(isPending) {
    if (el.sessionIdenticon) el.sessionIdenticon.classList.toggle("hidden", isPending);
    if (el.sessionPendingIcon) el.sessionPendingIcon.classList.toggle("hidden", !isPending);
    if (el.sessionDiscoveryNote) el.sessionDiscoveryNote.classList.toggle("hidden", !isPending);
    if (el.sessionNip44Pill) el.sessionNip44Pill.classList.toggle("hidden", !isPending);
  }

  /* ── Auto-lock countdown (mirrors SessionManager's inactivity timer) ─ */

  let countdownTimer = null;

  function fmtCountdown(sec) {
    const m = Math.floor(sec / 60);
    const s = String(sec % 60).padStart(2, "0");
    return m + ":" + s;
  }

  function startCountdownTicker() {
    stopCountdownTicker();
    countdownTimer = setInterval(renderCountdown, 1000);
    renderCountdown();
  }

  function stopCountdownTicker() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function renderCountdown() {
    if (!state.session) return;
    const left = state.session.secondsRemaining;
    const total = state.session.inactivityTimeoutMinutes * 60;
    const live = left != null && total > 0;
    if (el.kpiSessionCountdown) {
      el.kpiSessionCountdown.textContent = live ? " · " + fmtCountdown(left) : "";
      el.kpiSessionCountdown.classList.toggle("hidden", !live);
    }
    if (!el.countdownRect || !el.countdownText || !el.countdownWrap) return;
    if (!live) {
      // Locked, disabled or unavailable: full neutral bar, no ticking text.
      el.countdownRect.setAttribute("width", "100");
      el.countdownText.textContent = total === 0 && !state.session.isLocked ? "—" : "";
      el.countdownWrap.classList.remove("is-warning", "is-danger");
      return;
    }
    const pct = Math.max(0, Math.min(100, (left / total) * 100));
    el.countdownRect.setAttribute("width", String(pct));
    el.countdownText.textContent = fmtCountdown(left);
    el.countdownWrap.classList.toggle("is-warning", pct <= 33 && pct > 10);
    el.countdownWrap.classList.toggle("is-danger", pct <= 10);
    // role="progressbar" with no value is unannounced: assistive tech has no
    // way to say where the countdown is. The visible text already carries the
    // remaining time, so valuetext is what actually gets spoken.
    el.countdownWrap.setAttribute("aria-valuemin", "0");
    el.countdownWrap.setAttribute("aria-valuemax", "100");
    el.countdownWrap.setAttribute("aria-valuenow", pct.toFixed(0));
    el.countdownWrap.setAttribute("aria-valuetext", el.countdownText.textContent);
  }

  function onSessionEvent(event) {
    if (event === "unlocked") {
      // The unified session card keeps the identity context on screen; the
      // login/unlock sub-area steps aside for the live side (npub, state and
      // countdown) — but stays while an identity is still waiting to be
      // saved, hiding it would take the PIN fields with it (see
      // showSavePrompt).
      if (!state.pendingIdentity) el.sessionSetup.classList.add("hidden");
      el.sessionLive.classList.remove("hidden");
      renderSessionIdentity();
      setSessionPendingVisual(true);
      setSessionPill("Em espera", "p-warn", "live-dot");
      el.btnLockSession.classList.remove("hidden");
      el.autoLockSection.classList.remove("hidden");
      setSessionStatus("Em espera", "dim");
      startCountdownTicker();
      // Reveal the Live column on authentication so the user sees connection
      // feedback (status rail) while the tunnel is discovered, instead of a
      // blank screen. Services populate when the host responds.
      el.app.setAttribute("data-phase", "live");
      refreshBiometricEnrollUI();
      startNostr();
    } else if (event === "pending") {
      setSessionStatus("Em espera", "dim");
      setSessionPendingVisual(true);
      setSessionPill("Em espera", "p-warn", "live-dot");
    } else if (event === "active") {
      setSessionStatus("Ativa", "ok");
      setSessionPendingVisual(false);
      setSessionPill("Ativa", "p-ok", "dot-good");
      startTelemetryPolling();
    } else if (event === "locked") {
      revokeServerSession();
      clearStepUp();
      state.pendingIdentity = null;
      el.app.setAttribute("data-phase", "setup");
      el.btnLockSession.classList.add("hidden");
      el.autoLockSection.classList.add("hidden");
      el.sessionLive.classList.add("hidden");
      el.sessionSetup.classList.remove("hidden");
      setSessionPendingVisual(false);
      setSessionPill("Bloqueada", "");
      el.servicesOverview.classList.add("hidden");
      el.localPortSection.classList.add("hidden");
      if (el.hostTelemetrySection) el.hostTelemetrySection.classList.add("hidden");
      if (state.nostr) state.nostr.disconnect();
      state.nostr = null;
      clearLiveTimers();
      stopCountdownTicker();
      setTunnelStatus("Aguardando túnel…");
      setSessionStatus("Bloqueada", "dim");
      // A locked session (manual or auto-lock) still has its vault on disk —
      // send the user back to the PIN/biometric unlock screen, not the
      // signup/login screen checkVaultState() falls back to when there's
      // truly no vault (only wipe/first-run reach that path).
      checkVaultState();
    } else if (event === "wiped") {
      revokeServerSession();
      clearStepUp();
      el.app.setAttribute("data-phase", "setup");
      el.btnLockSession.classList.add("hidden");
      el.autoLockSection.classList.add("hidden");
      el.sessionLive.classList.add("hidden");
      setSessionPendingVisual(false);
      setSessionPill("Bloqueada", "");
      el.servicesOverview.classList.add("hidden");
      el.localPortSection.classList.add("hidden");
      if (el.hostTelemetrySection) el.hostTelemetrySection.classList.add("hidden");
      clearLiveTimers();
      stopCountdownTicker();
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
      focusPinInput();
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
    // EXCETO dl_conn_theme/dl_conn_palette: preferências de aparência devem
    // sobreviver ao reset.
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("dl_conn_") && k !== "dl_conn_theme" && k !== "dl_conn_palette") localStorage.removeItem(k);
    }
    for (const k of Object.keys(sessionStorage)) if (k.startsWith("dl_conn_")) sessionStorage.removeItem(k);
    // reinicia estado em memória
    state.hostServices = [];
    state.customServices = [];
    if (returnTimer) { clearTimeout(returnTimer); returnTimer = null; }
    returnTo = null;
    clearReturnTo();
    state.services = [];
    state.tunnelURL = null;
    state.authToken = null;
    state.config.hostNpub = null;
    state.pendingIdentity = null;
    clearLiveTimers();
    el.servicesOverview.classList.add("hidden");
    el.localPortSection.classList.add("hidden");
    setTunnelStatus("Aguardando túnel…");
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
   * controls are done with, but the session card's setup side has to stay on
   * screen for the PIN fields to be reachable.
   */
  function showSavePrompt() {
    el.sessionSetup.classList.remove("hidden");
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
    el.sessionSetup.classList.add("hidden");
  }

  let _qrStop = null;

  function stopQrScan() {
    if (_qrStop) { _qrStop(); _qrStop = null; }
    // closeDialog also hands focus back to the button that opened the
    // scanner, which a bare .hidden toggle never did.
    closeDialog(el.qrOverlay);
    el.qrStatus.textContent = "";
  }

  async function onScanQr() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      el.vaultStatus.textContent = "Câmera indisponível neste navegador.";
      return;
    }
    // Modal, so focus is trapped inside until the scanner is dismissed.
    openDialog(el.qrOverlay, el.btnScanQr);
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
      setTunnelStatus("Solicitando descoberta de serviços...");
      const generation = ++discoveryGeneration;
      const result = await state.nostr.sendDiscoverRequest(
        state.session.npub, state.session.sk
      );
      if (answeredGeneration >= generation) return;
      // The publish result used to be discarded, which made a rejected or
      // timed-out request indistinguishable from a host that simply had not
      // answered yet.
      if (result && result.status === "timeout") {
        setTunnelStatus("Sem confirmação dos relays ao publicar o pedido.");
        pushDebug("warn", "nostr", "Publicação do pedido expirou sem confirmação");
        return;
      }
      if (result && result.status === "failed") {
        setTunnelStatus("Falha ao publicar o pedido: " + (result.errors || []).join("; "));
        pushDebug("error", "nostr", "Falha ao publicar pedido: " + (result.errors || []).join("; "));
        return;
      }
      setTunnelStatus("Pedido enviado. Aguardando o host…");
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
      setTunnelStatus(
        "O host não respondeu. Verifique se o daemon está rodando e se seu npub " +
        "está em authorizedNpubs."
      );
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
    setTunnelStatus("Túnel: " + (data.tunnel_url || "conectado") + " · atualizado às " + hora);
    state.tunnelURL = data.tunnel_url;
    state.authToken = data.auth_token;
    state.hostServices = data.services || [];
    mergeServices();
    // Apply any saved user ordering after receiving fresh services
    loadServicesOrder();
    startExpiryCountdown(data.expires_in_seconds || 0);
    renderServices();
    el.servicesOverview.classList.remove("hidden");
    el.localPortSection.classList.remove("hidden");
    if (data.host_telemetry) renderTelemetry(data.host_telemetry);
    el.app.setAttribute("data-phase", "live");
    // Transition session from "pending" to "active" on first successful
    // backend contact.
    state.session.setBackendActive();
    // The token that just arrived is the missing piece of the interrupted
    // trip — this is the earliest moment the return can actually work.
    resumeReturnTo();
  }

  /**
   * Finish the trip that an expired link interrupted: with a fresh one-time
   * token in hand, send the browser back to where it was going.
   *
   * Announced with a short delay and a cancel button rather than navigating
   * outright: the user may have come back for something else in the
   * meantime, and a tab that jumps away on its own with no explanation is
   * indistinguishable from a bug.
   */
  function resumeReturnTo() {
    if (!returnTo) return;
    const target = resumeTarget(returnTo);
    if (!target || !state.tunnelURL) return; // no tunnel/target yet — a later discovery will retry

    const label = describeTarget(returnTo, state.services) || returnTo;
    // Consume it now: a second discovery (manual refresh, reconnect) must
    // not bounce the user away again after they chose to stay.
    returnTo = null;
    clearReturnTo();

    // The banner's href carries no credential. The token is redeemed in a
    // POST body before the browser leaves, so it never reaches this tab's
    // history, the tunnel's access log, or the Referer of whatever the
    // resumed page loads. The redemption is a form submission so the
    // Set-Cookie on the response lands in a first-party context — see
    // api_client.js for why this can't be a fetch().
    const href = serviceHref(state.tunnelURL, target);
    const go = () => {
      const token = state.authToken;
      state.authToken = null;
      if (token) {
        redeemAndOpen(state.tunnelURL, token, target);
      } else {
        window.location.assign(href);
      }
    };

    if (!el.returnBanner) {
      go();
      return;
    }
    el.returnBannerText.textContent = "Sessão renovada. Voltando para " + label + "…";
    el.returnBannerLink.href = href;
    el.returnBannerLink.textContent = "Ir agora";
    el.returnBannerLink.onclick = (e) => {
      e.preventDefault();
      if (returnTimer) { clearTimeout(returnTimer); returnTimer = null; }
      go();
    };
    el.returnBanner.classList.remove("hidden");

    if (returnTimer) clearTimeout(returnTimer);
    returnTimer = setTimeout(() => {
      returnTimer = null;
      go();
    }, RETURN_DELAY_MS);
  }

  /** Stop the automatic navigation; the link stays for a manual click. */
  function cancelReturn() {
    if (returnTimer) { clearTimeout(returnTimer); returnTimer = null; }
    if (el.returnBannerText) {
      el.returnBannerText.textContent = "Retorno cancelado.";
    }
    if (el.btnReturnCancel) el.btnReturnCancel.classList.add("hidden");
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

  const localPortStrings = {
    invalid: "Digite uma porta entre 1024 e 65535.",
    opening: "Abrindo serviço local…"
  };

  /**
   * Redeems the pending one-time token, then opens a service in a new tab.
   *
   * The token goes out in a POST body rather than in the URL, so it never
   * reaches the browser's history, cloudflared's access log, or the Referer
   * of anything the opened page loads. The form submission is itself the
   * navigation (target="_blank"), so the new tab navigates to /auth, the
   * daemon answers 303 to the service URL with the Set-Cookie, and the
   * browser follows the redirect — landing on the service with a live
   * session. No follow-up window.open is needed and would just race the
   * navigation.
   *
   * A redemption that fails still opens the destination: an already-
   * established session works, and without one the daemon sends the
   * browser to the login page, which is where an unauthenticated click
   * already led.
   */
  function openService(redirectPath) {
    if (!state.tunnelURL) return;
    if (state.authToken) {
      const token = state.authToken;
      state.authToken = null;
      redeemAndOpen(
        state.tunnelURL,
        token,
        redirectPath,
        "_blank"
      );
    } else {
      const targetUrl = serviceHref(state.tunnelURL, redirectPath);
      const opened = window.open(targetUrl, "_blank");
      if (opened) {
        try { opened.opener = null; } catch { /* ignore */ }
      } else {
        window.location.assign(targetUrl);
      }
    }
  }

  function onOpenLocalPort() {
    const port = Number(el.localPortInput.value);
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || !state.tunnelURL) {
      el.localPortStatus.textContent = localPortStrings.invalid;
      return;
    }
    el.localPortStatus.textContent = localPortStrings.opening;
    openService("/local/" + port + "/");
  }

  function onClearServices() {
    if (!confirm("Apagar todos os serviços da visualização? Isso também remove os serviços personalizados salvos neste navegador.")) return;
    state.hostServices = [];
    state.customServices = [];
    // The in-memory list is cleared either way; only the persistence outcome
    // decides which message is honest (see saveCustomServices/mergeServices).
    const persisted = mergeServices();
    localStorage.removeItem(SERVICES_ORDER_KEY);
    renderServices();
    if (el.customServiceStatus) {
      el.customServiceStatus.textContent = persisted ? "" : CUSTOM_SERVICE_STRINGS.clearedButNotPersisted;
    }
  }

  function populateCustomServiceIcons() {
    if (!el.customServiceIcon) return;
    el.customServiceIcon.replaceChildren(...SAFE_SERVICE_ICONS.map((icon) => {
      const option = document.createElement("option");
      option.value = icon;
      option.textContent = icon;
      return option;
    }));
    el.customServiceIcon.value = "package";
  }

  function loadCustomServices() {
    state.customServices = parseCustomServices(localStorage.getItem(CUSTOM_SERVICES_STORAGE_KEY));
    mergeServices();
  }

  /**
   * Persists the current custom-services set (the opt-in subset only — see
   * serializeCustomServices) and reports whether the write actually landed.
   * localStorage.setItem can throw (quota exceeded, disabled storage in
   * private browsing, SecurityError), and swallowing that silently used to
   * make add/remove/clear report success even when nothing was saved, so
   * every caller below must check this return value and phrase its status
   * message honestly instead of assuming success.
   */
  function saveCustomServices() {
    try {
      localStorage.setItem(CUSTOM_SERVICES_STORAGE_KEY, serializeCustomServices(state.customServices));
      return true;
    } catch (_) {
      return false;
    }
  }

  /** Rebuilds the merged view and persists it; returns whether the persist step succeeded (see saveCustomServices). */
  function mergeServices() {
    const merged = mergeHostAndCustomServices(state.hostServices, state.customServices);
    state.customServices = merged.customServices;
    state.services = merged.services;
    return saveCustomServices();
  }

  function onToggleCustomServiceForm() {
    const willShow = el.customServiceForm.classList.contains("hidden");
    el.customServiceForm.classList.toggle("hidden", !willShow);
    el.btnToggleCustomService.setAttribute("aria-expanded", String(willShow));
    if (willShow) el.customServiceName.focus();
  }

  function onAddCustomService(event) {
    event.preventDefault();
    try {
      const service = createCustomService({
        name: el.customServiceName.value,
        port: el.customServicePort.value,
        icon: el.customServiceIcon.value,
        description: el.customServiceDescription.value,
        websocket: el.customServiceWebsocket.checked,
        persisted: el.customServicePersist.checked,
      }, state.hostServices, state.customServices);
      state.customServices.push(service);
      // The in-memory add always applies; mergeServices' return value only
      // decides which status message is honest, so a failed localStorage
      // write never rolls back the service the user just saw get added.
      const persisted = mergeServices();
      loadServicesOrder();
      renderServices();
      el.customServiceForm.reset();
      el.customServiceIcon.value = "package";
      if (service.persisted && !persisted) {
        el.customServiceStatus.textContent = CUSTOM_SERVICE_STRINGS.addedButNotPersisted;
      } else {
        el.customServiceStatus.textContent = service.persisted
          ? CUSTOM_SERVICE_STRINGS.addedPersisted
          : CUSTOM_SERVICE_STRINGS.addedTemporary;
      }
    } catch (err) {
      el.customServiceStatus.textContent = err.message;
    }
  }

  function onDeleteCustomService(configId) {
    const deletedWasPersisted = state.customServices.some((service) => service.configId === configId && service.persisted);
    state.customServices = state.customServices.filter((service) => service.configId !== configId);
    // Same rule as onAddCustomService: the in-memory removal always applies;
    // only the message reflects whether localStorage actually caught up, so
    // a deleted persisted entry can only "reappear" via the storage that
    // failed to update, never via the in-memory list this function owns.
    const persisted = mergeServices();
    saveServicesOrder();
    renderServices();
    el.customServiceStatus.textContent = deletedWasPersisted && !persisted
      ? CUSTOM_SERVICE_STRINGS.deletedButNotPersisted
      : CUSTOM_SERVICE_STRINGS.deleted;
  }

  function downloadableCustomServices() {
    return state.customServices;
  }

  function downloadText(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function onExportCustomServices(format) {
    const services = downloadableCustomServices();
    if (!services.length) {
      el.customServiceStatus.textContent = CUSTOM_SERVICE_STRINGS.noCustomServices;
      return;
    }
    if (format === "yaml") {
      downloadText("dl-conn-custom-services.yaml", exportCustomServicesYaml(services), "application/yaml;charset=utf-8");
      el.customServiceStatus.textContent = CUSTOM_SERVICE_STRINGS.exportYaml;
      return;
    }
    downloadText("dl-conn-custom-services.nix", exportCustomServicesNix(services), "text/plain;charset=utf-8");
    el.customServiceStatus.textContent = CUSTOM_SERVICE_STRINGS.exportNix;
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
    setTunnelStatus("Atualizando status…");
    const generation = ++discoveryGeneration;
    try {
      const result = await state.nostr.sendDiscoverRequest(
        state.session.npub, state.session.sk
      );
      if (answeredGeneration >= generation) return;
      if (result && result.status === "timeout") {
        setTunnelStatus("Sem resposta do host ao atualizar.");
        pushDebug("warn", "nostr", "Atualização expirou sem confirmação");
        return;
      }
      if (result && result.status === "failed") {
        setTunnelStatus("Falha ao atualizar: " + (result.errors || []).join("; "));
        pushDebug("error", "nostr", "Falha ao atualizar: " + (result.errors || []).join("; "));
        return;
      }
      setTunnelStatus("Pedido enviado. Aguardando o host…");
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
   *
   * A custom service is always "unprobed": it rides the `/local/<porta>/`
   * route, which the host never probes.
   */
  function serviceStatusMeta(svc) {
    const status = svc.status === "up" || svc.status === "down"
      ? svc.status
      : "unknown";
    const meta = svc.custom
      ? { cls: "dot-unknown", title: CUSTOM_SERVICE_STRINGS.unprobed }
      : {
        up: { cls: "dot-good", title: "Ativo" },
        down: { cls: "dot-bad", title: "Inativo" },
        unknown: { cls: "dot-unknown", title: "Aguardando confirmação do host" },
      }[status];
    return { status: status, cls: meta.cls, title: meta.title };
  }

  function serviceIcon(icon, dotHtml) {
    const dot = dotHtml || "";
    if (!icon) {
      return '<span class="service-icon"><svg class="icon" aria-hidden="true"><use href="#i-package"></use></svg>' + dot + "</span>";
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
      return '<span class="service-icon"><svg class="icon" aria-hidden="true"><use href="#i-' + escapeHtml(target) + '"></use></svg>' + dot + "</span>";
    }
    // Fallback: render as text/emoji if it is a unicode character or non-sprite icon
    return '<span class="service-icon">' + escapeHtml(clean) + dot + "</span>";
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

  /** Load saved service order from localStorage and apply it. */
  function loadServicesOrder() {
    try {
      const saved = localStorage.getItem(SERVICES_ORDER_KEY);
      if (saved) {
        const order = JSON.parse(saved);
        if (Array.isArray(order) && order.length > 0) {
          // Reorder services to match saved order by ID
          const serviceMap = new Map(state.services.map((s) => [s.id, s]));
          const reordered = order.map((id) => serviceMap.get(id)).filter(Boolean);
          // Append any new services not in the saved order
          const remaining = state.services.filter((s) => !order.includes(s.id));
          state.services = reordered.concat(remaining);
        }
      }
    } catch (_) { /* ignore */ }
  }

  /** Save current service order to localStorage. */
  function saveServicesOrder() {
    try {
      // Save the service IDs in current order
      const order = state.services.map((s) => s.id);
      localStorage.setItem(SERVICES_ORDER_KEY, JSON.stringify(order));
    } catch (_) { /* ignore */ }
  }

  /** Reorder services array and persist. */
  function reorderServices(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= state.services.length || toIndex >= state.services.length) return;
    const [removed] = state.services.splice(fromIndex, 1);
    state.services.splice(toIndex, 0, removed);
    saveServicesOrder();
  }

  /**
   * Render the services list in the Visão geral section — the one and only
   * services view. It carries the rows, the health strip and every management
   * control, so the block's visibility follows the Live phase (the caller
   * un-hides it) rather than the service count: with zero services the
   * "add service" button has to stay reachable, which is why an empty list
   * renders a message instead of collapsing the whole block.
   */
  function renderServicesOverview() {
    if (!el.servicesOverview || !el.servicesOverviewList || !el.servicesOverviewCount) return;

    const total = state.services.length;
    el.servicesOverviewCount.textContent = total + (total === 1 ? " serviço" : " serviços");

    if (total === 0) {
      el.servicesOverviewList.replaceChildren();
      const empty = document.createElement("li");
      empty.className = "services-empty";
      empty.setAttribute("role", "status");
      empty.textContent = "Nenhum serviço na visualização.";
      el.servicesOverviewList.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();

    state.services.forEach((svc, index) => {
      const li = document.createElement("li");
      li.className = "service-overview-item";
      li.dataset.index = index;

      const redirectPath = (svc.prefix || "/").replace(/\/*$/, "/");
      // No token in the href: a link that can be bookmarked, shared or
      // middle-clicked should not carry a one-time secret, and the click
      // handler below redeems the token before the browser leaves.
      const href = serviceHref(state.tunnelURL, redirectPath);

      const statusMeta = serviceStatusMeta(svc);

      const iconHtml = serviceIcon(svc.icon,
        '<span class="svc-dot ' + statusMeta.cls + '" title="' + escapeHtml(statusMeta.title) + '" aria-hidden="true"></span>');

      const name = escapeHtml(svc.name || svc.id || "serviço");

      // Custom entries carry the same three markers the grid used to show:
      // the "personalizado" badge, whether it survives a reload, and the
      // fact that a `/local/<porta>/` route is never probed by the host.
      const customMeta = svc.custom
        ? '<div class="service-overview-custom">' +
          '<span class="pill p-info">' + CUSTOM_SERVICE_STRINGS.customBadge + '</span>' +
          '<span class="service-overview-badge">' +
          escapeHtml(svc.persisted ? CUSTOM_SERVICE_STRINGS.persistedBadge : CUSTOM_SERVICE_STRINGS.temporaryBadge) +
          '</span>' +
          '<span class="service-overview-badge">' + CUSTOM_SERVICE_STRINGS.unprobed + '</span>' +
          '</div>'
        : "";

      li.innerHTML =
        '<span class="service-overview-drag" aria-label="Reordenar" data-tip="Arrastar para reordenar">' +
        '<svg class="icon" aria-hidden="true"><use href="#i-sliders"></use></svg>' +
        '</span>' +
        iconHtml +
        '<div class="service-overview-meta">' +
        '<div class="service-overview-name">' + name + '</div>' +
        (svc.description ? '<div class="service-overview-desc">' + escapeHtml(svc.description) + '</div>' : "") +
        '<div class="service-overview-status">' +
        '<span class="dot ' + statusMeta.cls + '" aria-hidden="true"></span>' +
        '<span>' + escapeHtml(statusMeta.title) + '</span>' +
        '</div>' +
        customMeta +
        '</div>' +
        '<a href="' + href + '" class="service-overview-link" target="_blank" rel="noopener noreferrer" aria-label="Abrir ' + name + '">' +
        '<svg class="icon icon-sm" aria-hidden="true"><use href="#i-launch"></use></svg></a>' +
        (svc.custom
          ? '<button type="button" class="btn-icon custom-service-delete" aria-label="' + CUSTOM_SERVICE_STRINGS.deleteLabel + '" data-custom-id="' + escapeHtml(svc.configId) + '">' +
            '<svg class="icon icon-sm" aria-hidden="true"><use href="#i-trash"></use></svg></button>'
          : "");

      // A plain left-click redeems the token first and only then leaves, so
      // the opened URL carries no credential. Modified clicks (new tab,
      // new window, download) are left to the browser: they cannot be awaited,
      // and the href is already a valid destination for anyone who already
      // has a session.
      const overviewLink = li.querySelector(".service-overview-link");
      overviewLink.addEventListener("click", (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey ||
            event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        openService(redirectPath);
      });

      if (svc.custom) {
        li.querySelector(".custom-service-delete")
          .addEventListener("click", () => onDeleteCustomService(svc.configId));
      }

      attachReorder(li, index, name);

      frag.appendChild(li);
    });

    el.servicesOverviewList.replaceChildren(frag);
  }

  /* ── Service reordering ────────────────────────────────────────────
     Replaced the HTML5 drag-and-drop API: it has no touch support at
     all, so on Android and iOS the drag handles did nothing, and it is
     unreachable by keyboard. Pointer events cover mouse, touch and pen
     with one path, and the handle being a real <button> gives the
     keyboard route for free. */
  const DRAG_START_PX = 8;
  const dragPointer = {
    id: null,
    source: null,
    from: -1,
    to: -1,
    started: false,
    originX: 0,
    originY: 0,
  };

  /** The reorderable container under a point, if any. */
  function reorderTargetAt(x, y, source) {
    const node = document.elementFromPoint(x, y);
    if (!node) return null;
    const item = node.closest(".service-overview-item");
    return item && item !== source ? item : null;
  }

  function clearDropHighlight() {
    document.querySelectorAll(".drag-over").forEach((n) => n.classList.remove("drag-over"));
  }

  function endPointerDrag() {
    if (dragPointer.source) {
      dragPointer.source.classList.remove("dragging");
      if (dragPointer.source.releasePointerCapture && dragPointer.id !== null) {
        try { dragPointer.source.releasePointerCapture(dragPointer.id); } catch (_) { /* already released */ }
      }
    }
    clearDropHighlight();
    const from = dragPointer.from;
    const to = dragPointer.to;
    const wasStarted = dragPointer.started;
    dragPointer.id = null;
    dragPointer.source = null;
    dragPointer.from = -1;
    dragPointer.to = -1;
    dragPointer.started = false;
    if (wasStarted && from !== to && from >= 0 && to >= 0) {
      reorderServices(from, to);
      renderServices();
    }
  }

  /**
   * Wire one reorderable row. `handle` is the drag grip; the row body also
   * starts a drag for a mouse, which is what the previous
   * whole-element draggable did, but a finger on the body must still
   * scroll the list, so touch is restricted to the handle.
   */
  function attachReorder(row, index, name) {
    const handle = row.querySelector(".service-overview-drag");
    if (handle) {
      handle.setAttribute("role", "button");
      handle.setAttribute("tabindex", "0");
      handle.setAttribute("aria-label",
        "Reordenar " + name + ". Posição " + (index + 1) + " de " + state.services.length +
        ". Use as setas para cima e para baixo.");
      handle.setAttribute("aria-describedby", "reorder-hint");
      handle.addEventListener("keydown", (event) => {
        const up = event.key === "ArrowUp";
        const down = event.key === "ArrowDown";
        if (!up && !down) return;
        event.preventDefault();
        const target = up ? index - 1 : index + 1;
        if (target < 0 || target >= state.services.length) return;
        reorderServices(index, target);
        renderServices();
        // Focus has to follow the item, or the next keypress acts on
        // whatever landed in the same slot.
        const rows = document.querySelectorAll(".service-overview-item");
        const moved = rows[target];
        const grip = moved && moved.querySelector(".service-overview-drag");
        if (grip) grip.focus();
      });
    }

    const begin = (event) => {
      if (event.button !== undefined && event.button > 0) return;
      // Ignore a press that starts on a real control (open, delete).
      if (event.target.closest("a, button:not(.service-overview-drag)")) return;
      if (event.target.closest(".service-overview-drag")) {
        if (event.pointerType && event.pointerType !== "mouse" && event.pointerType !== "touch" && event.pointerType !== "pen") return;
      } else if (event.pointerType && event.pointerType !== "mouse") {
        return; // let the list scroll under a finger
      }
      dragPointer.id = event.pointerId;
      dragPointer.source = row;
      dragPointer.from = index;
      dragPointer.to = index;
      dragPointer.started = false;
      dragPointer.originX = event.clientX;
      dragPointer.originY = event.clientY;
    };

    row.addEventListener("pointerdown", begin);
    row.addEventListener("pointermove", (event) => {
      if (dragPointer.source !== row || event.pointerId !== dragPointer.id) return;
      if (!dragPointer.started) {
        const moved = Math.hypot(event.clientX - dragPointer.originX, event.clientY - dragPointer.originY);
        if (moved < DRAG_START_PX) return;
        dragPointer.started = true;
        row.classList.add("dragging");
        if (row.setPointerCapture) {
          try { row.setPointerCapture(event.pointerId); } catch (_) { /* not capturable */ }
        }
      }
      event.preventDefault();
      const over = reorderTargetAt(event.clientX, event.clientY, row);
      clearDropHighlight();
      if (over) {
        over.classList.add("drag-over");
        dragPointer.to = parseInt(over.dataset.index, 10);
      } else {
        dragPointer.to = dragPointer.from;
      }
    });
    row.addEventListener("pointerup", (event) => {
      if (dragPointer.source !== row) return;
      event.preventDefault();
      endPointerDrag();
    });
    row.addEventListener("pointercancel", () => {
      if (dragPointer.source !== row) return;
      endPointerDrag();
    });
  }

  /* ── Status rail ──────────────────────────────────────────────────
     The rail summarizes what the cards below already say. Rather than
     keep a second copy of that state — which would drift the moment any
     one of a dozen call sites updated a card and forgot the rail — it
     reads the authoritative elements directly, and a MutationObserver
     repaints it whenever one of them changes. That also means the
     per-second session countdown keeps the rail honest for free. */

  /** Map a health dot class onto the rail's dot. */
  function railDot(dot, level) {
    if (!dot) return;
    dot.className = "dot dot-" + (level === "good" ? "good" : level === "bad" ? "bad" : level === "warn" ? "warn" : "unknown");
  }

  /** Level implied by the dot the relay tester already rendered. */
  function relayLevel() {
    if (!el.relaySummary) return "unknown";
    const dot = el.relaySummary.querySelector(".dot");
    if (!dot) return "unknown";
    if (dot.classList.contains("dot-good")) return "good";
    if (dot.classList.contains("dot-warn")) return "warn";
    if (dot.classList.contains("dot-bad")) return "bad";
    return "unknown";
  }

  function syncStatusRail() {
    if (!el.railTunnel) return;

    // Tunnel: the URL is the source of truth, the expiry is the detail.
    if (el.railTunnel) {
      const up = Boolean(state.tunnelURL);
      const expiry = el.tunnelExpiry ? el.tunnelExpiry.textContent : "";
      const expired = expiry === "Expirado";
      el.railTunnel.textContent = up ? (expired ? "expirado" : (expiry || "ativo")) : "inativo";
      railDot(el.railTunnelDot, up ? (expired ? "bad" : "good") : "unknown");
    }

    // Session: reuse the pill the session card already maintains.
    if (el.railSession) {
      const pill = el.sessionStatePill;
      const text = pill ? pill.textContent.trim() : "—";
      el.railSession.textContent = text;
      const locked = /bloqueada|locked/i.test(text);
      railDot(el.railSessionDot, locked ? "warn" : "good");
    }

    // Relays: how many are enabled, graded by the last test result.
    if (el.railRelay) {
      let active = 0;
      try { active = state.relayManager ? state.relayManager.getActiveUrls().length : 0; }
      catch (_) { active = 0; }
      el.railRelay.textContent = active + " ativos";
      railDot(el.railRelayDot, relayLevel());
    }

    // Services: up over total, faults first in meaning — a single red
    // service matters more than the ratio.
    if (el.railService) {
      const total = state.services.length;
      const upCount = state.services.filter((s) => s.status === "up").length;
      const downCount = state.services.filter((s) => s.status === "down").length;
      el.railService.textContent = total ? upCount + "/" + total : "—";
      railDot(el.railServiceDot, !total ? "unknown" : downCount ? "bad" : "good");
    }
  }

  /** Watch the elements the rail mirrors and repaint on any change. */
  function setupStatusRail() {
    if (!el.railTunnel) return;
    syncStatusRail();
    const watched = [
      el.tunnelExpiry, el.tunnelStatus, el.relaySummary, el.sessionStatePill,
      el.healthSegUp, el.healthSegDown, el.servicesOverviewCount,
    ].filter(Boolean);
    if (!watched.length || typeof MutationObserver !== "function") return;
    // Coalesced: the poller touches several of these in one tick, and a
    // per-mutation repaint would redraw the rail several times over.
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      Promise.resolve().then(() => {
        queued = false;
        syncStatusRail();
      });
    });
    for (const node of watched) {
      observer.observe(node, { childList: true, subtree: true, characterData: true, attributes: true });
    }
  }

  /**
   * The single services renderer. There used to be a second, grid-shaped
   * rendering of the same `state.services`; both are gone — the list in the
   * Visão geral is the only place services are shown, and this entry point
   * paints it together with the health strip that lives in the same block.
   */
  function renderServices() {
    renderServicesHealth();
    renderServicesOverview();
  }

  function onToggleRelays() {
    const willShow = el.relayPanel.classList.contains("hidden");
    el.relayPanel.classList.toggle("hidden", !willShow);
    el.btnToggleRelays.classList.toggle("on", willShow);
    el.btnToggleRelays.setAttribute("aria-expanded", String(willShow));
    el.btnToggleRelays.setAttribute("aria-label", willShow
      ? "Ocultar configuração de relays"
      : "Mostrar configuração de relays");
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
      });
      urlCell.appendChild(elem("span", { class: "relay-url-text" }, relay.url));
      if (result && result.nip11) {
        urlCell.setAttribute("tabindex", "0");
        urlCell.setAttribute("aria-label", relay.url + ". Detalhes NIP-11 disponíveis");
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

  /* ── Theme, palette, density ──────────────────────────────────────
     Three orthogonal axes, all token-driven: the palette picks the
     --color-chart-* and --color-* values, the theme picks the light or
     dark block, and density only moves spacing and control height.
     "system" is a real state, not an initial guess — before this, the
     preference was read once at load and never again, so switching the
     OS to dark with the tab open left the page light, and the first
     click on the toggle silently discarded the system preference. */
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const coarsePointer = window.matchMedia("(pointer: coarse)");

  /** The theme actually in effect, after resolving "system". */
  function effectiveTheme(preference) {
    if (preference === "dark") return "dark";
    if (preference === "light") return "light";
    return darkQuery.matches ? "dark" : "light";
  }

  function applyAppearance() {
    const root = document.documentElement;
    const preference = localStorage.getItem("dl_conn_theme") || "system";
    // Tokens live on the root element (see style.css palette blocks), so the
    // attributes are set on <html>, not <body>. The palette attribute must
    // always exist: every dark block is scoped [data-palette=…][data-theme=dark].
    root.setAttribute("data-theme", effectiveTheme(preference));
    root.setAttribute("data-palette", localStorage.getItem("dl_conn_palette") || "azure");
    // Compact drops controls below the 44px touch minimum, so it is refused
    // on a coarse pointer rather than left to the CSS media query alone —
    // the stored preference is kept, so a dock back to a mouse restores it.
    const density = localStorage.getItem("dl_conn_density") || "comfortable";
    if (density === "compact" && coarsePointer.matches) root.removeAttribute("data-density");
    else root.setAttribute("data-density", density);
    if (el.themeToggle) el.themeToggle.innerHTML = themeIcon(root.getAttribute("data-theme") === "dark");
    syncAppearanceControls();
  }

  /** Reflect the live appearance on the sheet's controls. */
  function syncAppearanceControls() {
    const root = document.documentElement;
    const preference = localStorage.getItem("dl_conn_theme") || "system";
    const mark = (group, attr, value) => {
      if (!group) return;
      for (const btn of group.querySelectorAll(".seg, .palette")) {
        const on = btn.dataset[attr] === value;
        btn.classList.toggle("is-on", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      }
    };
    mark(el.themeGroup, "themeChoice", preference);
    mark(el.paletteGroup, "paletteChoice", root.getAttribute("data-palette"));
    const density = localStorage.getItem("dl_conn_density") || "comfortable";
    const effective = (density === "compact" && coarsePointer.matches) ? "comfortable" : density;
    mark(el.densityGroup, "densityChoice", effective);
  }

  function setupTheme() {
    applyAppearance();
    // Follow the OS while the preference is "system" and only then — once
    // the user picks light or dark explicitly, their choice wins outright.
    const onSchemeChange = () => {
      if ((localStorage.getItem("dl_conn_theme") || "system") === "system") applyAppearance();
    };
    if (typeof darkQuery.addEventListener === "function") darkQuery.addEventListener("change", onSchemeChange);
    else if (typeof darkQuery.addListener === "function") darkQuery.addListener(onSchemeChange);
  }

  function toggleTheme() {
    // Binary: an explicit choice, which also opts out of following the OS.
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    localStorage.setItem("dl_conn_theme", next);
    applyAppearance();
  }

  /* ── Dialog plumbing ──────────────────────────────────────────────
     Two dialogs now exist (the appearance sheet and the QR scanner) and
     both need the same three things: Escape to close, focus moved in,
     and focus returned to the opener. That contract lives here once so
     neither dialog can quietly skip it. */

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /** Open a dialog, remembering what had focus so it can be restored. */
  function openDialog(panel, opener) {
    if (!panel) return;
    panel._opener = opener || document.activeElement;
    panel.classList.remove("hidden");
    if (opener && opener.setAttribute) opener.setAttribute("aria-expanded", "true");
    const first = panel.querySelector(FOCUSABLE);
    if (first) first.focus();
  }

  /** Close a dialog and hand focus back to whatever opened it. */
  function closeDialog(panel) {
    if (!panel || panel.classList.contains("hidden")) return;
    panel.classList.add("hidden");
    const opener = panel._opener;
    panel._opener = null;
    if (opener && opener.setAttribute) opener.setAttribute("aria-expanded", "false");
    if (opener && opener.focus) opener.focus();
  }

  /**
   * Wire Escape-to-close and Tab containment for a dialog. Trap is only
   * enforced for a modal; the appearance sheet is non-modal (it sits over
   * the page but the page stays usable), so Tab is allowed to leave it.
   */
  function wireDialog(panel, { modal = false } = {}) {
    if (!panel) return;
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeDialog(panel);
        return;
      }
      if (event.key !== "Tab" || !modal) return;
      const items = Array.from(panel.querySelectorAll(FOCUSABLE))
        .filter((n) => n.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  function setupAppearancePanel() {
    wireDialog(el.appearancePanel, { modal: false });
    if (el.btnAppearance) {
      el.btnAppearance.addEventListener("click", () => {
        if (el.appearancePanel.classList.contains("hidden")) {
          openDialog(el.appearancePanel, el.btnAppearance);
        } else {
          closeDialog(el.appearancePanel);
        }
      });
    }
    if (el.btnAppearanceClose) {
      el.btnAppearanceClose.addEventListener("click", () => closeDialog(el.appearancePanel));
    }
    // Clicking away dismisses the sheet: it is non-modal, so it must not
    // demand an explicit close.
    document.addEventListener("click", (event) => {
      const panel = el.appearancePanel;
      if (!panel || panel.classList.contains("hidden")) return;
      if (panel.contains(event.target) || (el.btnAppearance && el.btnAppearance.contains(event.target))) return;
      closeDialog(panel);
    });
    const choose = (group, attr, key, apply) => {
      if (!group) return;
      group.addEventListener("click", (event) => {
        const btn = event.target.closest("[data-" + attr + "]");
        if (!btn || !group.contains(btn)) return;
        localStorage.setItem(key, btn.dataset[attr]);
        apply(btn.dataset[attr]);
      });
    };
    choose(el.themeGroup, "themeChoice", "dl_conn_theme", applyAppearance);
    choose(el.paletteGroup, "paletteChoice", "dl_conn_palette", applyAppearance);
    choose(el.densityGroup, "densityChoice", "dl_conn_density", applyAppearance);
  }

  function truncateNpub(npub) {
    if (!npub) return "";
    return npub.slice(0, 8) + "..." + npub.slice(-8);
  }

  function showApp() {
    el.loading.classList.add("hidden");
    el.app.classList.remove("hidden");
  }

  window.addEventListener("DOMContentLoaded", async () => {
    try {
      await init();
    } finally {
      // Keep the boot overlay until async configuration and the first stable
      // login/unlock state are ready, avoiding an empty card and layout shift.
      showApp();
    }
  });
})();
