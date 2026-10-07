/* app.js — main SPA controller */
import { NostrAuth } from './js/nostr_auth.js';
import { NostrClient } from './js/nostr_client.js';
import { RelayManager } from './js/relay_manager.js';
import { RelayRttHistory, sparklinePoints } from './js/relay_rtt_history.js';
import {
  availabilityStrip,
  availabilitySummary,
  incarnationSpan,
  incarnationSeconds,
  SEG_UP,
  SEG_DOWN,
} from './js/host_history.js';
import { wireSegGroup } from './js/seg_control.js';
import {
  nextCollapsed,
  collapseLabel,
  storedCollapsed,
  storedValue,
} from './js/section_collapse.js';
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
    telLive: $("tel-live"),
    telUpdated: $("tel-updated"),
    telMeters: $("tel-meters"),
    telThrottle: $("tel-throttle"),
    telStorage: $("tel-storage"),
    telStorageList: $("tel-storage-list"),
    telStorageCount: $("tel-storage-count"),
    histWindowGroup: $("hist-window-group"),
    servicesAvailability: $("services-availability"),
    availList: $("avail-list"),
    availAxisStart: $("avail-axis-start"),
    availAxisMid: $("avail-axis-mid"),
    availAxisEnd: $("avail-axis-end"),
    availWindowGroup: $("avail-window-group"),
    tunnelTimeline: $("tunnel-timeline"),
    tunnelTimelineBlock: $("tunnel-timeline-block"),
    tunnelTimelineCount: $("tunnel-timeline-count"),
    timelineFrom: $("timeline-from"),
    timelineTo: $("timeline-to"),
    histMetricGroup: $("hist-metric-group"),
    histLegend: $("hist-legend"),
    histLine2: $("hist-line-2"),
    histLine3: $("hist-line-3"),
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
    histAxisStart: $("hist-axis-start"),
    histAxisMid: $("hist-axis-mid"),
    histAxisEnd: $("hist-axis-end"),
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
    // The whole services card. Its `hidden` class is the phase gate: the list
    // and the "add service" button appear only once the tunnel answers.
    servicesSection: $("services-section"),
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
  let telemetrySource = "http";
  /** Newest live snapshot; the history panel consults it to explain a gap. */
  let lastSnapshot = null;
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
   * Every collapsible section, declared once.
   *
   * The two sections that could already collapse each had their own toggle
   * function, and "every section collapses" was unenforceable: adding a card
   * meant remembering to hand-copy a fourth toggle. Here the button, the body
   * it hides, the visible label and the storage key live in one row, and
   * `layout_tests.js` diffs this list against the `<section>`s in index.html —
   * so a new section without a collapse button fails the suite instead of
   * quietly shipping one.
   *
   * The pattern is the one the relay and session cards already used: collapse
   * the body in place and leave the `.card-head` visible, so the pills in the
   * head (relay summary, session state, service count) stay readable while the
   * body is closed.
   *
   * `bodies` and `buttons` are arrays because the session card has two mutually
   * exclusive sides — setup and live — sharing one preference. A preference per
   * side would make the card "remember" two different collapses and reappear
   * expanded after the next login, which is exactly when the operator least
   * wants to scroll to the unlock controls. Only the visible side is clickable,
   * and the toggle reads the first listed body.
   *
   * `storageKey` is spelled out per row rather than derived from `key` so the
   * relay and session preferences keep the names they already had on disk.
   *
   * `section` names the `<section>` element itself. Nothing reads it at
   * runtime — it exists so the test can diff this table against the markup and
   * fail when a section appears that has no row here, which is the only way
   * "every section collapses" stays true as cards are added.
   */
  const COLLAPSIBLE_SECTIONS = [
    {
      key: "session",
      section: "vault-section",
      label: "sessão",
      storageKey: "dl_conn_session_collapsed",
      bodies: ["session-setup-body", "session-live-body"],
      buttons: ["btn-collapse-session-setup", "btn-collapse-session-live"],
    },
    {
      key: "relays",
      section: "relay-panel",
      label: "relays",
      storageKey: "dl_conn_relay_collapsed",
      bodies: ["relay-panel-body"],
      buttons: ["btn-collapse-relays"],
    },
    {
      key: "overview",
      section: "status-section",
      label: "visão geral",
      storageKey: "dl_conn_overview_collapsed",
      bodies: ["status-body"],
      buttons: ["btn-collapse-status"],
    },
    {
      key: "services",
      section: "services-section",
      label: "serviços",
      storageKey: "dl_conn_services_collapsed",
      bodies: ["services-body"],
      buttons: ["btn-collapse-services"],
    },
    {
      key: "host",
      section: "host-telemetry-section",
      label: "saúde do host",
      storageKey: "dl_conn_host_collapsed",
      bodies: ["host-telemetry-body"],
      buttons: ["btn-collapse-host"],
    },
    {
      key: "local-port",
      section: "local-port-section",
      label: "porta local",
      storageKey: "dl_conn_local_port_collapsed",
      bodies: ["local-port-body"],
      buttons: ["btn-collapse-local-port"],
    },
    {
      key: "host-npub",
      section: "host-npub-section",
      label: "npub do host",
      storageKey: "dl_conn_host_npub_collapsed",
      bodies: ["host-npub-body"],
      buttons: ["btn-collapse-host-npub"],
    },
    {
      key: "debug",
      section: "debug-section",
      label: "depuração",
      storageKey: "dl_conn_debug_collapsed",
      bodies: ["debug-body"],
      buttons: ["btn-collapse-debug"],
    },
  ];

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

  /**
   * Host history endpoint: service probe rounds and tunnel incarnations. It
   * is served by the same handler as TELEMETRY_PATH and therefore shares its
   * credential, step-up gate and rate-limit budget.
   */
  const HOST_HISTORY_PATH = "/api/host/history";

  /** Cells in one availability strip. Matches the widest strip that stays
      legible as separate cells on a phone. */
  const AVAILABILITY_SLOTS = 60;

  /**
   * Resolves a path (such as /api/host/telemetry) against the discovered
   * tunnel URL if one is known, allowing static launchers (GitHub Pages) to
   * query the daemon directly.
   */
  function telemetryEndpoint(pathAndQuery) {
    if (typeof state !== "undefined" && state && state.tunnelURL) {
      try {
        const base = new URL(state.tunnelURL);
        return new URL(pathAndQuery, base).href;
      } catch (_) {}
    }
    return pathAndQuery;
  }

  /**
   * Reports whether this browser origin can reach the daemon's HTTP telemetry
   * route. When loaded from a static launcher (like GitHub Pages), the origin
   * has no local backend, so it queries the discovered tunnel URL once known.
   */
  function canPollTelemetry() {
    if (typeof window !== "undefined" && window.location) {
      const isStaticLauncher = window.location.hostname && (
        window.location.hostname.endsWith(".github.io") ||
        window.location.protocol === "file:"
      );
      if (isStaticLauncher) {
        return Boolean(typeof state !== "undefined" && state && state.tunnelURL);
      }
    }
    return true;
  }


  /** Stop everything the Live zone drives; called whenever it goes away. */
  function clearLiveTimers() {
    if (expiryTimer) { clearInterval(expiryTimer); expiryTimer = null; }
    if (discoveryTimer) { clearTimeout(discoveryTimer); discoveryTimer = null; }
    if (telemetryTimer) { clearInterval(telemetryTimer); telemetryTimer = null; }
    if (liveTicker) { clearInterval(liveTicker); liveTicker = null; }
    if (debugWatchdog) { clearInterval(debugWatchdog); debugWatchdog = null; }
  }

  /**
   * Host uptime as the two largest units that carry the magnitude.
   *
   * Hours stop being readable early: a box up 45 days read as "1080h", which
   * is not obviously "since last month" and cannot be placed on a calendar
   * at all, so the duration is decomposed instead. The month is the usual
   * 30-day convention — an uptime is a duration, not a date, and there is no
   * calendar to divide by.
   *
   * Minutes are the floor: below an hour they are the only unit that applies
   * ("42 min"); from one hour up the value shows the largest unit and the one
   * below it ("1 h 0 min", "3 d 17 h", "2 sem 3 d", "1 mês 1 sem"). Two units
   * is what fits the badge, and the pair is enough to read the value as a date.
   * "min" stays spelled out: a bare "m" would be ambiguous between minute and
   * month, and "sem" is the abbreviation a pt-BR dashboard uses for week.
   *
   * The value is in seconds, matching `uptime_s` from /proc/uptime.
   */
  function formatUptime(total) {
    if (total == null || isNaN(total) || total < 0) return "—";
    // [singular, plural, seconds]: the month is the only unit that inflects,
    // since it is the only one spelled out and long enough to read as a word.
    const units = [
      ["mês", "meses", 30 * 24 * 3600],
      ["sem", "sem", 7 * 24 * 3600],
      ["d", "d", 24 * 3600],
      ["h", "h", 3600],
      ["min", "min", 60],
    ];
    let rest = Math.floor(total);
    // A leading zero is not a unit of the value: under an hour nothing above
    // "min" applies, so the first shown unit becomes the last real one.
    let i = 0;
    while (i < units.length - 1 && rest < units[i][2]) i++;
    const parts = [];
    for (; i < units.length && parts.length < 2; i++) {
      const n = Math.floor(rest / units[i][2]);
      rest -= n * units[i][2];
      parts.push(n + " " + units[i][n === 1 ? 0 : 1]);
    }
    return parts.join(" ");
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
      // formatCapacity inlined, so the panel renderers below are
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
        const name = gpuVendorName(snap.gpu.vendor);
        if (name && name !== GPU_VENDOR_LABELS.other) g.push(name);
        if (snap.gpu.temp_c != null) g.push(snap.gpu.temp_c.toFixed(1) + "°C");
        if (snap.gpu.util_pct != null) g.push(snap.gpu.util_pct.toFixed(0) + "%");
        el.telGpu.textContent = g.join(" · ");
      } else if (snap.gpu_temp_c != null || snap.gpu_util_pct != null) {
        const g = [];
        if (snap.gpu_temp_c != null) g.push(snap.gpu_temp_c.toFixed(1) + "°C");
        if (snap.gpu_util_pct != null) g.push(snap.gpu_util_pct.toFixed(0) + "%");
        el.telGpu.textContent = g.join(" · ") || "—";
      } else if (snap.gpu && snap.gpu.vendor) {
        // A card that reports nothing is still a card: naming it here is what
        // tells the user the daemon found their GPU and the driver simply
        // publishes no counters for it.
        el.telGpu.textContent = gpuVendorName(snap.gpu.vendor) + " (sem leitura)";
      } else el.telGpu.textContent = "—";
    }
    if (el.telBatt) {
      if (snap.battery && snap.battery.available) el.telBatt.textContent = snap.battery.capacity_pct + "% " + (snap.battery.status || "");
      else if (snap.batt_capacity_pct != null) el.telBatt.textContent = snap.batt_capacity_pct + "% " + (snap.batt_status || "");
      else el.telBatt.textContent = "—";
    }
    if (el.telUpdated) el.telUpdated.textContent = formatUptime(snap.uptime_s);
    updateLiveBadgeTip();
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

  /**
   * Vendor names, keyed by the code the daemon reports in `gpu.vendor`.
   *
   * The daemon sends a stable code, never a translated name: the GPU it finds
   * is whichever one the kernel enumerated, so it could be AMD, Intel, NVIDIA
   * or a vendor nobody has a name for, and the words for those belong in one
   * place on the client (see docs/okf/concepts/i18n.md).
   *
   * Naming the chip matters now that the reading is not NVIDIA-only. A host
   * with an Intel iGPU used to report nothing at all, and "GPU" alone leaves
   * the user unable to tell which card the panel is talking about on a machine
   * that has two.
   */
  const GPU_VENDOR_LABELS = {
    amd: "AMD", intel: "Intel", nvidia: "NVIDIA", other: "GPU",
  };

  /**
   * The vendor's name for the UI, or "" when the daemon did not say.
   *
   * An empty string is a real answer, not a failure: a daemon that predates
   * `gpu.vendor` still reports temperature and utilization, and inventing a
   * vendor for it would be a claim about hardware nobody measured.
   */
  function gpuVendorName(vendor) {
    if (!vendor) return "";
    return GPU_VENDOR_LABELS[vendor] || GPU_VENDOR_LABELS.other;
  }

  /**
   * Label for the GPU meter: the vendor when known, plain "GPU" otherwise.
   * Shown next to the bar so the number is about a named card.
   */
  function gpuMeterLabel(gpu) {
    const name = gpuVendorName(gpu && gpu.vendor);
    return name && name !== GPU_VENDOR_LABELS.other ? "GPU · " + name : "GPU";
  }

  /**
   * Unit caption for the GPU chart series, naming the card it reads — the same
   * job `tempSourceLabel()` does for the temperature series. On a host with
   * more than one card the daemon follows the busiest one, so the line is the
   * host's GPU and not always the same silicon; the vendor is what makes that
   * readable instead of surprising.
   */
  function gpuSourceLabel(snap) {
    const gpu = snap && snap.gpu;
    const name = gpuVendorName(gpu && gpu.vendor);
    return name && name !== GPU_VENDOR_LABELS.other ? "utilização da " + name : "utilização da GPU";
  }

  /**
   * Cap on drawn points: more than this is indistinguishable at 1px — and it
   * is also what we ask the daemon for. The two are the same number on
   * purpose. The chart draws a fixed number of pixels across the window, so
   * asking for every stored sample bought nothing: the 7-day window holds
   * ~60k rows at the default 10s cadence, which came back as ~25 MB of JSON
   * and blocked the main thread for ~200 ms on every load. The daemon caps
   * the answer too (maxRangePoints), so an older client asking for the whole
   * window still gets a bounded series.
   */
  const HISTORY_MAX_POINTS = 240;

  /**
   * How often the event histories (availability, tunnel incarnations) reload.
   * Deliberately much slower than the live chart: a probe round lands every
   * 30s and the tunnel URL changes on the order of hours, so re-reading this
   * every few seconds would spend a shared rate-limit budget on numbers that
   * cannot have moved.
   */
  const HOST_HISTORY_REFRESH_MS = 2 * 60 * 1000;
  /**
   * How long a failed history load waits before the 2s poll tries again. The
   * poll re-checks on every tick, so without a cooldown one bad response
   * meant one full-window request every two seconds, for as long as the page
   * stayed open.
   */
  const HISTORY_RETRY_MS = 30000;
  /**
   * How old the loaded series may get before the live poll refreshes it. The
   * chart follows the live edge, so a series loaded once at page open went
   * stale while the meters next to it kept moving — a frozen line next to
   * live numbers reads as a broken chart. Five minutes keeps the window's
   * leading edge moving at one request per 300 polls, which the 1 req/s
   * limiter never notices.
   */
  const HISTORY_REFRESH_MS = 5 * 60 * 1000;

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
    const load1 = snap && snap.cpu ? snap.cpu.load1 : (snap && snap.cpu_load1 != null ? snap.cpu_load1 : null);
    const cores = snap ? snap.num_cpu : null;
    if (load1 == null || !cores) return null;
    return (load1 / cores) * 100;
  }

  /**
   * The clock this CPU reaches when it is not thermally limited — the highest
   * frequency anywhere in the loaded window.
   *
   * There is no rated maximum in the snapshot, so the window's own peak is the
   * reference. That is a weaker claim than a datasheet number and is treated
   * as such: it is only ever used together with a high temperature, because
   * "low frequency" alone is indistinguishable from "the CPU is idle", and a
   * throttling warning that fires on every idle host is worse than none.
   */
  function referenceFreqMHz(samples) {
    let best = null;
    if (!samples) return null;
    for (const s of samples) {
      const f = s && s.cpu && s.cpu.freq_mhz != null ? s.cpu.freq_mhz
        : (s && s.cpu_freq_mhz != null ? s.cpu_freq_mhz : null);
      if (f == null) continue;
      if (best == null || f > best) best = f;
    }
    return best;
  }

  /** Render the live meters for every resource the host actually reports. */
  function renderMeters(snap) {
    const host = el.telMeters;
    if (!host || !snap) return;
    meterRefs.clear();
    host.replaceChildren();

    // CPU
    const cpu = snap.cpu || (snap.cpu_load1 != null || snap.cpu_temp_c != null || snap.cpu_freq_mhz != null ? {
      load1: snap.cpu_load1,
      load5: snap.cpu_load5,
      load15: snap.cpu_load15,
      temp_c: snap.cpu_temp_c,
      freq_mhz: snap.cpu_freq_mhz,
    } : null);
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
    const mem = snap.memory || (snap.ram_used_pct != null ? {
      used_pct: snap.ram_used_pct,
      used_mb: snap.ram_used_mb,
      total_mb: snap.ram_total_mb,
    } : null);
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
    const gpu = snap.gpu || (snap.gpu_util_pct != null || snap.gpu_temp_c != null ? {
      util_pct: snap.gpu_util_pct,
      temp_c: snap.gpu_temp_c,
    } : null);
    if (gpu && gpu.util_pct != null) {
      const bits = [];
      if (gpu.temp_c != null) bits.push(gpu.temp_c.toFixed(1) + " °C");
      const label = gpuMeterLabel(gpu);
      setMeter(
        ensureMeter(host, "gpu", label),
        "gpu",
        label,
        gpu.util_pct.toFixed(0) + "%",
        gpu.util_pct,
        bits.join(" · ") || "—"
      );
    }

    // Battery — inverts: a full battery is healthy, an empty one is not.
    const batt = snap.battery || (snap.batt_capacity_pct != null ? {
      available: true,
      capacity_pct: snap.batt_capacity_pct,
      status: snap.batt_status,
    } : null);
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

    renderThrottleNote(cpu);
  }

  /**
   * How far below its own recent peak the clock has to sit, and how hot the
   * package has to be, before this is called throttling rather than idle.
   *
   * The 10% margin absorbs the ordinary movement of frequency governors: a
   * CPU that is simply unloaded sits at its lowest P-state, and without the
   * temperature half of the test every idle host would be flagged.
   */
  const THROTTLE_FREQ_RATIO = 0.90;
  const THROTTLE_TEMP_C = 75;

  /**
   * Report thermal throttling, or say nothing.
   *
   * The verdict is a heuristic and the wording says so. It combines two facts
   * the snapshot already carries — the clock and the package temperature —
   * against the highest clock seen anywhere in the loaded window. It cannot
   * distinguish thermal throttling from power limiting or from a host that
   * simply never boosts, which is why it claims "possível" rather than
   * asserting a cause.
   *
   * Silently absent otherwise: a warning that clears itself is the only kind
   * worth showing here, because there is no history of throttling events to
   * browse and a permanently visible badge would just be furniture.
   */
  function renderThrottleNote(cpu) {
    const host = el.telThrottle;
    if (!host) return;
    const freq = cpu ? cpu.freq_mhz : null;
    const temp = cpu ? cpu.temp_c : null;
    const reference = referenceFreqMHz(historyState.samples);

    if (freq == null || temp == null || reference == null ||
        freq >= reference * THROTTLE_FREQ_RATIO || temp < THROTTLE_TEMP_C) {
      host.classList.add("hidden");
      host.textContent = "";
      return;
    }
    const pct = Math.round((1 - freq / reference) * 100);
    host.classList.remove("hidden");
    host.textContent =
      "Possível throttling térmico: a CPU está a " + (freq / 1000).toFixed(2) +
      " GHz, cerca de " + pct + "% abaixo do pico recente de " +
      (reference / 1000).toFixed(2) + " GHz, a " + temp.toFixed(0) + " °C.";
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

  /**
   * Temperature at which the chart draws its warn line, in Celsius. Chosen to
   * sit below where a desktop CPU throttles rather than at a percentage of
   * anything: 80 °C sustained is the point where the number is worth noticing.
   */
  const TEMP_WARN_C = 80;
  /**
   * One row per selectable metric, in selector order. The unit, the axis
   * domain and the warn line live here rather than being hardcoded at the
   * drawing site, because the series is no longer always a percentage: a
   * temperature drawn on a 0..100% axis is a wrong number, not just a wrong
   * label. `value` extracts the series from one snapshot, `null` when the host
   * does not report it.
   */
  const HISTORY_METRICS = [
    {
      // There used to be a "Carga" metric here next to this one, and its
      // 1-minute curve was this exact series: both read `load1 / num_cpu`. Two
      // tabs drawing the same line is one too many, so the duplicate went and
      // this kept the name. What the duplicate alone could show was the 5- and
      // 15-minute smoothing; that is a real signal, but it is not this
      // metric's job to fake it — it belongs to the load average the daemon
      // sends, not to a second reading of the same instant.
      key: "cpu", label: "CPU", unit: "%", caption: "de capacidade",
      domain: [0, 100], warn: METER_WARN_PCT.cpu,
      value: (s) => cpuPercent(s),
    },
    {
      key: "ram", label: "Memória", unit: "%", caption: "de capacidade",
      domain: [0, 100], warn: METER_WARN_PCT.ram,
      value: (s) => (s && s.memory && s.memory.used_pct != null ? s.memory.used_pct : (s && s.ram_used_pct != null ? s.ram_used_pct : null)),
    },
    {
      key: "disk", label: "Disco", unit: "%", caption: "de capacidade",
      domain: [0, 100], warn: METER_WARN_PCT.disk,
      // The busiest mountpoint stands in for "disk", so a filling volume is
      // the one that shows up regardless of how many others stay flat.
      value: (s) => {
        if (!s) return null;
        if (s.disks && s.disks.length) {
          return s.disks.reduce((m, d) => Math.max(m, d.used_pct || 0), 0);
        }
        return s.disk_used_pct != null ? s.disk_used_pct : null;
      },
    },
    {
      key: "gpu", label: "GPU", unit: "%", caption: "de capacidade",
      domain: [0, 100], warn: METER_WARN_PCT.gpu,
      // Utilization, not temperature: this is the axis the GPU meter uses, and
      // temperature has its own metric below rather than sharing this one.
      value: (s) => (s && s.gpu && s.gpu.util_pct != null ? s.gpu.util_pct : (s && s.gpu_util_pct != null ? s.gpu_util_pct : null)),
    },
    {
      key: "temp", label: "Temp.", unit: "°C", caption: "de temperatura",
      domain: [0, 100], warn: TEMP_WARN_C,
      value: (s) => hostTempC(s),
    },
  ];

  /** The metric descriptor for `key`, falling back to the first one. */
  function historyMetric(key) {
    return HISTORY_METRICS.find((m) => m.key === key) || HISTORY_METRICS[0];
  }

  /**
   * The temperature this host reports, and where it came from. The CPU package
   * sensor wins because it is the one every x86 and ARM host exposes; a GPU
   * sensor is the fallback, and the two are never mixed into one series — a
   * line that silently switched source halfway would be a lie about the host.
   */
  function hostTempC(snap) {
    if (!snap) return null;
    if (snap.cpu && snap.cpu.temp_c != null) return snap.cpu.temp_c;
    if (snap.gpu && snap.gpu.temp_c != null) return snap.gpu.temp_c;
    if (snap.cpu_temp_c != null) return snap.cpu_temp_c;
    if (snap.gpu_temp_c != null) return snap.gpu_temp_c;
    return null;
  }

  /** Which sensor the temperature metric is reading, for the unit caption. */
  function tempSourceLabel(snap) {
    if (!snap) return "";
    if ((snap.cpu && snap.cpu.temp_c != null) || snap.cpu_temp_c != null) return "temperatura da CPU";
    if ((snap.gpu && snap.gpu.temp_c != null) || snap.gpu_temp_c != null) return "temperatura da GPU";
    return "temperatura";
  }

  /**
   * `samples` is the last series that actually loaded, kept on screen across a
   * failed reload: a transient error should not wipe a chart the user is
   * reading. `lastAttempt` is the cooldown that keeps the 2s live poll from
   * re-firing a failed range request on every tick, and `lastSuccess` (0 =
   * never loaded) is what tells a fresh load from a loaded-but-empty window.
   *
   * `pendingReload` is what keeps the window buttons honest. A click that lands
   * while a request is in flight cannot open a second request, so it parks here
   * and the in-flight one issues it on the way out — otherwise the button
   * repainted as selected while nothing was ever asked for, and the old window
   * stayed on screen until HISTORY_REFRESH_MS let the poll through.
   *
   * `fromUnix` / `toUnix` are the window the daemon actually served, kept with
   * the series so the drawing can be placed against real time instead of array
   * position. They are part of the series' identity for the same reason
   * `windowSec` is: a series without the window it came from cannot be drawn
   * honestly, because a 24h and a 7d answer are both 240 points and index-based
   * x renders the two windows identically.
   */
  const historyState = {
    windowSec: 604800,
    fromUnix: 0,
    toUnix: 0,
    metric: "cpu",
    samples: null,
    inFlight: false,
    pendingReload: false,
    lastAttempt: 0,
    lastSuccess: 0,
    error: null,
  };

  /** Extract one chartable value from a snapshot; null if unavailable. */
  function historyValue(snap, metric) {
    if (!snap) return null;
    return historyMetric(metric).value(snap);
  }

  /**
   * Bucket-average the series down to at most HISTORY_MAX_POINTS. A 7-day
   * window can hold tens of thousands of samples; drawing them all is
   * wasted work and, at sub-pixel spacing, a smear rather than a line.
   *
   * Each output point keeps the snapshot it came from as a third element. That
   * is what lets a metric with more than one curve read every curve off the
   * *same* instants: without it, the extra curves would have to be downsampled
   * on their own and could drift out of alignment with the primary one.
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
      out.push([points[start][0], sum / n, points[start][2]]);
    }
    return out;
  }

  /**
   * Map a sample instant onto the chart's 0..100 x range, against the window
   * the daemon actually served rather than the sample's position in the array.
   *
   * Position is what made the window buttons look dead. A 24h and a 7d answer
   * are both 240 points, so index-based x drew the two windows pixel for pixel
   * identically — clicking the button changed the data underneath and nothing
   * on screen. The same choice stretched two days of a young host across a
   * chart labelled "7d", and squeezed a 90-minute outage in a 24h window (6.5%
   * of the window) into one slot (0.44% of the width).
   *
   * Returns `(ts, index) => x`. The index is only used by the positional
   * fallback, which applies before any answer has landed — a window of zero
   * span would otherwise collapse every sample onto one x.
   */
  function historyX(fromUnix, toUnix, count) {
    const span = toUnix - fromUnix;
    if (span > 0) {
      return (ts) => Math.max(0, Math.min(100, ((ts - fromUnix) / span) * 100));
    }
    return (_ts, i) => (count > 1 ? (i / (count - 1)) * 100 : 100);
  }

  /**
   * One timestamp as a chart-axis label, at a precision the window can carry.
   *
   * Minutes are enough for a one-hour window and useless across a week, where
   * the same label would read as the same instant seven times over; days alone
   * lose the hour on a window short enough for the hour to be the interesting
   * part. So the format follows the span rather than being fixed.
   */
  function historyAxisLabel(unixSec, spanSec) {
    const d = new Date(unixSec * 1000);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    if (spanSec <= 6 * 3600) return hh + ":" + mm;
    if (spanSec <= 48 * 3600) return dd + "/" + mo + " " + hh + ":" + mm;
    return dd + "/" + mo;
  }

  /** Human duration for the status line: "45 min", "3 h", "2 d". */
  function historySpanLabel(sec) {
    if (sec < 3600) return Math.round(sec / 60) + " min";
    if (sec < 48 * 3600) return Math.round(sec / 3600) + " h";
    return Math.round(sec / 86400) + " d";
  }

  /**
   * Paint the window's ends under the chart.
   *
   * The axis is the reason a window change is legible at all: without it the
   * two charts are geometry-only, and "1h" versus "7d" of a steady host is two
   * identical flat lines. It marks the window the daemon served — a series
   * that does not reach the left edge is saying the host was not up for the
   * whole window, which is true and worth seeing rather than stretching away.
   */
  function renderHistoryAxis() {
    if (!el.histAxisStart || !el.histAxisEnd) return;
    const span = historyState.toUnix - historyState.fromUnix;
    if (span <= 0) {
      el.histAxisStart.textContent = "";
      if (el.histAxisMid) el.histAxisMid.textContent = "";
      el.histAxisEnd.textContent = "";
      return;
    }
    el.histAxisStart.textContent = historyAxisLabel(historyState.fromUnix, span);
    if (el.histAxisMid) {
      el.histAxisMid.textContent = historyAxisLabel(
        historyState.fromUnix + Math.round(span / 2), span);
    }
    el.histAxisEnd.textContent = historyAxisLabel(historyState.toUnix, span);
  }

  /**
   * Draw a metric's extra curves (everything past the first) onto the soft
   * polylines, sharing the primary's x positions.
   *
   * A curve with no data at a given instant breaks the line there instead of
   * being interpolated across the gap: a reading the host never produced must
   * not be drawn as though it had been measured.
   *
   * No metric declares `series` today — the one that did, "Carga", was removed
   * for drawing the same line as "CPU". The renderer stays because it is keyed
   * on `metric.series`, not on that metric: the next multi-curve metric needs
   * no new code, and the polylines it would draw are already in the markup.
   */
  function drawSecondarySeries(metric, reduced, toY, toX, nodes) {
    const extra = (metric.series || []).slice(1);
    if (!extra.length) return;

    extra.forEach((def, i) => {
      const node = nodes[i];
      if (!node) return;
      // Each segment between two present points is emitted separately, so a
      // missing sample leaves a real gap in the path.
      const segments = [];
      let current = [];
      reduced.forEach((p, idx) => {
        const sample = p[2];
        const v = sample ? def.value(sample) : null;
        if (v == null || isNaN(v)) {
          if (current.length) segments.push(current);
          current = [];
          return;
        }
        const x = toX(p[0], idx).toFixed(2);
        current.push(x + "," + toY(v));
      });
      if (current.length) segments.push(current);
      node.setAttribute("points", segments.map((s) => s.join(" ")).join(" "));
    });
  }

  /**
   * The legend for a multi-curve metric. Single-curve metrics get none: one
   * swatch with nothing to compare it against is decoration, not a legend.
   */
  function renderHistoryLegend(metric) {
    const host = el.histLegend;
    if (!host) return;
    const series = metric.series || [];
    if (series.length < 2) {
      host.hidden = true;
      host.replaceChildren();
      return;
    }
    host.hidden = false;
    const frag = document.createDocumentFragment();
    series.forEach((def, i) => {
      const item = document.createElement("span");
      item.className = "chart-legend-item" + (i === 0 ? " is-primary" : "");
      const swatch = document.createElement("span");
      swatch.className = "chart-legend-swatch";
      item.appendChild(swatch);
      item.appendChild(document.createTextNode(def.label));
      frag.appendChild(item);
    });
    host.replaceChildren(frag);
  }

  /** Draw grid, threshold, line and fill for the current history state. */
  function renderHistory() {
    if (!el.histLine) return;
    const samples = historyState.samples;
    const metric = historyMetric(historyState.metric);
    const key = metric.key;
    const points = [];
    if (samples) {
      for (const s of samples) {
        const v = historyValue(s, key);
        if (v == null || isNaN(v)) continue;
        const ts = Date.parse(s.sampled_at) / 1000;
        if (!isFinite(ts)) continue;
        // The snapshot rides along so the extra curves of a multi-curve metric
        // can be read off these same instants.
        points.push([ts, v, s]);
      }
    }
    const reduced = downsample(points, HISTORY_MAX_POINTS);

    if (el.histChartFrame) el.histChartFrame.classList.toggle("is-empty", !reduced.length);

    // The window's ends, painted whatever the series contains: an axis that
    // disappears with the data cannot say how far back "7d" really reaches.
    renderHistoryAxis();

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

    // The scale is fixed per metric (see the descriptor table) — a
    // self-scaling axis would make a flat line look like a storm, and a
    // temperature sharing the percentage domain would be a wrong number.
    const [lo, hi] = metric.domain;
    const toY = (v) => (40 - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 40).toFixed(2);
    if (el.histThreshold) {
      el.histThreshold.setAttribute("y1", toY(metric.warn));
      el.histThreshold.setAttribute("y2", toY(metric.warn));
    }

    // The secondary curves are cleared on every render, not only when they are
    // redrawn: a metric with fewer curves would otherwise leave the previous
    // metric's lines behind, drawn on an axis that has nothing to do with them.
    const secondary = [el.histLine2, el.histLine3];
    for (const node of secondary) {
      if (node) node.setAttribute("points", "");
    }
    renderHistoryLegend(metric);

    if (!reduced.length) {
      el.histLine.setAttribute("points", "");
      if (el.histFill) el.histFill.setAttribute("points", "");
      for (const node of [el.histValue, el.histMin, el.histAvg, el.histMax]) {
        if (node) node.textContent = "—";
      }
      if (el.histUnit) el.histUnit.textContent = "";
      if (el.histStatus) {
        // Four different empty states, and collapsing them into one "no
        // samples" line is what made a broken chart look like a quiet host.
        const hostMissing = missingMetricReason(key);
        if (historyState.error) {
          el.histStatus.textContent = "Não foi possível ler o histórico: " + historyState.error + ".";
        } else if (!historyState.lastSuccess) {
          el.histStatus.textContent = "Carregando histórico…";
        } else if (hostMissing) {
          el.histStatus.textContent = hostMissing;
        } else if (historyState.samples && historyState.samples.length) {
          el.histStatus.textContent = "Sem amostras para esta métrica na janela selecionada.";
        } else {
          el.histStatus.textContent = "Nenhuma amostra gravada nesta janela.";
        }
      }
      return;
    }

    // x is placed against real time, not array position — see historyX(). The
    // fill is anchored to the first and last drawn x rather than to 0 and 100,
    // so a series that starts late does not paint empty canvas as if it were
    // part of the window.
    const toX = historyX(historyState.fromUnix, historyState.toUnix, reduced.length);
    const coords = reduced.map((p, i) => toX(p[0], i).toFixed(2) + "," + toY(p[1]));
    el.histLine.setAttribute("points", coords.join(" "));
    if (el.histFill) {
      const firstX = toX(reduced[0][0], 0).toFixed(2);
      const lastX = toX(reduced[reduced.length - 1][0], reduced.length - 1).toFixed(2);
      el.histFill.setAttribute(
        "points",
        [firstX + ",40"].concat(coords).concat([lastX + ",40"]).join(" ")
      );
    }

    // Secondary curves share the primary's x positions exactly — they are the
    // same samples of the same window — so each one is read off the same
    // representative snapshot the bucket kept. Downsampling them apart would
    // let the 5- and 15-minute curves drift out from under the 1-minute one
    // they are meant to be read against.
    drawSecondarySeries(metric, reduced, toY, toX, secondary);

    const values = reduced.map((p) => p[1]);
    const last = values[values.length - 1];
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    // Every number carries the metric's own unit: "60 °C" and "63 %" are
    // different quantities and one suffix for both is a wrong reading.
    const unit = metric.unit;
    if (el.histValue) el.histValue.textContent = last.toFixed(0) + unit;
    if (el.histUnit) {
      el.histUnit.textContent = key === "temp" ? tempSourceLabel(lastSnapshot)
        : key === "gpu" ? gpuSourceLabel(lastSnapshot)
        : metric.caption;
    }
    if (el.histMin) el.histMin.textContent = min.toFixed(0) + unit;
    if (el.histAvg) el.histAvg.textContent = avg.toFixed(0) + unit;
    if (el.histMax) el.histMax.textContent = max.toFixed(0) + unit;
    if (el.histStatus) {
      const hours = Math.round(historyState.windowSec / 3600);
      // Spelled the way the button spells it. "24h" was being announced as
      // "1d", so the control and the line under it disagreed about which
      // window was on screen.
      const label = hours % 24 === 0 ? hours / 24 + "d" : hours + "h";
      let text = reduced.length + " amostras · janela de " + label;
      // When the host has not been recording for the whole window, say so:
      // the line is drawn at its real position now, and its left edge sitting
      // short of the axis is only honest if the status line agrees.
      const first = reduced[0][0];
      const lastPt = reduced[reduced.length - 1][0];
      const covered = lastPt - first;
      if (covered > 0 && covered < historyState.windowSec * 0.9) {
        text += " · últimos " + historySpanLabel(covered);
      }
      el.histStatus.textContent = text;
    }
  }

  /**
   * Load the selected window from the daemon, at most every HISTORY_REFRESH_MS
   * unless forced. Falls back to an empty series rather than erroring, so an
   * older daemon that ignores the query params still leaves the rest of the
   * panel working.
   *
   * `force` bypasses both gates and is what a window change uses: the user
   * asked for a different range, so the previous answer is stale by
   * definition, not a reason to skip the request.
   *
   * `force` is also why a call that collides with an open request is parked in
   * `pendingReload` instead of dropped: `force` means "this answer no longer
   * counts", and returning quietly is how the window buttons ended up
   * repainting as selected while nothing was ever asked for.
   */
  async function fetchHistory(force) {
    if (typeof canPollTelemetry === "function" && !canPollTelemetry()) {
      return;
    }
    if (historyState.inFlight) {
      if (force) historyState.pendingReload = true;
      return;
    }
    const now = Date.now();
    if (!force) {
      if (now - historyState.lastAttempt < HISTORY_RETRY_MS) return;
      if (historyState.lastSuccess && now - historyState.lastSuccess < HISTORY_REFRESH_MS) return;
    }
    historyState.inFlight = true;
    historyState.lastAttempt = now;
    const to = Math.floor(now / 1000);
    // The window this request answers. A response that lands after the user
    // picked another one describes a range nobody is looking at any more, and
    // painting it under the new label is a chart lying about its own window.
    const windowSec = historyState.windowSec;
    const from = to - windowSec;
    try {
      // `points` is what the chart can actually draw, so it is all we ask
      // for; the daemon caps it again on its side.
      const path = TELEMETRY_PATH + "?from=" + from + "&to=" + to + "&points=" + HISTORY_MAX_POINTS;
      const endpoint = typeof telemetryEndpoint === "function" ? telemetryEndpoint(path) : path;
      const r = await telemetryGet(endpoint);
      if (!r.ok) throw new Error(historyErrorLabel(r.status));
      const data = await r.json();
      // A daemon built before the range query ignores ?from= and answers with
      // the single-snapshot object. Saying so is the whole difference between
      // the operator redeploying and the operator guessing — the panel cannot
      // work against that binary no matter what this code does.
      if (data && !Array.isArray(data)) throw new Error(historyStaleDaemonLabel());
      if (!Array.isArray(data)) throw new Error("resposta fora do contrato do histórico");
      // Window abandoned while this was in flight: neither the series nor its
      // freshness moves, so the poll stays free to answer the selected window.
      if (windowSec !== historyState.windowSec) return;
      historyState.samples = data;
      historyState.fromUnix = from;
      historyState.toUnix = to;
      historyState.lastSuccess = Date.now();
      historyState.error = null;
    } catch (err) {
      // The previous series stays on screen. `error` drives the status line
      // and the retry cooldown, never the data. A failure for a window the user
      // already left is not this window's failure either.
      if (windowSec === historyState.windowSec) {
        historyState.error = (err && err.message) || "falha desconhecida";
      }
    } finally {
      historyState.inFlight = false;
      if (windowSec === historyState.windowSec) renderHistory();
      // The window change that arrived mid-flight is answered now, for the
      // window it ended up selecting rather than the one it started on.
      if (historyState.pendingReload) {
        historyState.pendingReload = false;
        fetchHistory(true);
      }
    }
  }

  /** A readable reason for a history response that was not usable. */
  function historyErrorLabel(status) {
    if (status === 401) return "sessão expirada — recarregue a página";
    if (status === 429) return "limite de requisições do daemon, tente de novo em instantes";
    if (status === 501) return "histórico indisponível neste daemon";
    return "o daemon respondeu HTTP " + status;
  }

  /**
   * What to tell the operator when the daemon answers a range request with a
   * single snapshot — the signature of a build from before the range query
   * existed. It is a deployment fact, not a transient error, so it is named as
   * one instead of being flattened into "history unavailable".
   */
  function historyStaleDaemonLabel() {
    return "o daemon em execução é anterior ao histórico: reinicie o serviço na versão atual para a consulta de intervalo funcionar";
  }

  /**
   * Why a metric has no series on this host at all, or "" when the absence is
   * just an empty window. Without it the chart says "sem amostras" for a GPU
   * the host never had, which reads as a broken chart rather than as a host
   * that does not report one.
   *
   * The GPU branch has to separate three cases that used to collapse into one
   * wrong sentence: no card in /sys/class/drm at all, a card that reports
   * nothing, and a card that reports temperature but not utilization. The old
   * text — "a coleta usa nvidia-smi" — was accurate only while that was the
   * whole truth, and it stayed on screen on a host with a perfectly good AMD
   * card, which is exactly the report that started this: the panel claiming a
   * host had no GPU because the daemon only ever asked NVIDIA.
   */
  function missingMetricReason(key) {
    const snap = lastSnapshot;
    if (!snap) return "";
    if (key === "temp" && hostTempC(snap) == null) {
      return "Este host não expõe sensores de temperatura (lwtrace/coretemp).";
    }
    const gpu = snap.gpu || null;
    const card = gpu && (gpu.vendor || gpu.util_pct != null || gpu.temp_c != null);
    if (key === "gpu" && !card) {
      return "Este host não tem placa de GPU (/sys/class/drm não lista nenhuma).";
    }
    if (key === "gpu" && gpu.util_pct == null) {
      const name = gpuVendorName(gpu.vendor);
      const which = name && name !== GPU_VENDOR_LABELS.other ? " (" + name + ")" : "";
      // Temperature first: it is the reading this host does publish, and the
      // line below points at the tab that shows it.
      return "A GPU deste host" + which + " não expõe utilização"
        + (gpu.temp_c != null ? " — veja a aba Temp." : " — o driver não publica contadores de carga.");
    }
    return "";
  }

  /** Wire the window and metric segmented controls. */
  function setupHistoryControls() {
    // The markup attribute is the only argument: `wireSegGroup` derives both
    // the selector and the `dataset` key from it (see js/seg_control.js).
    // Spelling the two separately is what left the availability toggle wired
    // to a selector that matched nothing.
    wireSegGroup(el.histWindowGroup, "data-window", (v) => {
      historyState.windowSec = Number(v) || 604800;
      // Forced: a new window invalidates whatever is already loaded, and
      // until it arrives the chart is showing the previous range.
      fetchHistory(true);
    });
    wireSegGroup(el.histMetricGroup, "data-metric", (v) => {
      historyState.metric = historyMetric(v).key;
      renderHistory();
    });
    wireSegGroup(el.availWindowGroup, "data-avail-window", (v) => {
      hostHistoryState.windowSec = Number(v) || 86400;
      fetchHostHistory(true);
    });
  }

  /* ── Host history (service availability + tunnel incarnations) ── */

  /**
   * State for the two event-history views.
   *
   * `data` is the last response that actually parsed, kept on screen across a
   * failed reload for the same reason the telemetry series is: a transient
   * error should not wipe a strip the user is reading. `error` drives the
   * status line and the retry cooldown, never the drawing.
   *
   * `pendingReload` is the availability strip's half of the same rule the
   * telemetry chart follows: a window click that lands while a request is open
   * parks here and is issued on the way out, rather than leaving the strip on
   * the previous window until the next refresh tick.
   */
  const hostHistoryState = {
    windowSec: 86400,
    data: null,
    inFlight: false,
    pendingReload: false,
    lastAttempt: 0,
    lastSuccess: 0,
    error: null,
  };

  /**
   * Load the host history for the selected window.
   *
   * Refreshed far less often than the live chart: nothing here changes fast
   * enough to be worth a request every few seconds, and the daemon caps a
   * single session's polling rate across both routes — spending that budget
   * on a strip that is minutes old would starve the live chart.
   */
  async function fetchHostHistory(force) {
    if (typeof canPollTelemetry === "function" && !canPollTelemetry()) return;
    if (hostHistoryState.inFlight) {
      if (force) hostHistoryState.pendingReload = true;
      return;
    }
    const now = Date.now();
    if (!force) {
      if (now - hostHistoryState.lastAttempt < HISTORY_RETRY_MS) return;
      if (hostHistoryState.lastSuccess && now - hostHistoryState.lastSuccess < HOST_HISTORY_REFRESH_MS) return;
    }
    hostHistoryState.inFlight = true;
    hostHistoryState.lastAttempt = now;
    const to = Math.floor(now / 1000);
    // As in fetchHistory: the window this response belongs to, so a strip
    // answering for a range the user has since left is not drawn.
    const windowSec = hostHistoryState.windowSec;
    const from = to - windowSec;
    try {
      const path = HOST_HISTORY_PATH + "?from=" + from + "&to=" + to + "&points=" + AVAILABILITY_SLOTS;
      const endpoint = typeof telemetryEndpoint === "function" ? telemetryEndpoint(path) : path;
      const r = await telemetryGet(endpoint);
      if (!r.ok) throw new Error(hostHistoryErrorLabel(r.status));
      const data = await r.json();
      // A daemon built before this route answers 404 or serves the SPA. Say so
      // plainly: the strip cannot work against that binary no matter what the
      // client does, and a blank panel would look like "no outages".
      if (!data || typeof data !== "object" || Array.isArray(data) ||
          typeof data.services !== "object" || !Array.isArray(data.tunnel)) {
        throw new Error(hostHistoryStaleDaemonLabel());
      }
      if (windowSec !== hostHistoryState.windowSec) return;
      hostHistoryState.data = data;
      hostHistoryState.lastSuccess = Date.now();
      hostHistoryState.error = null;
    } catch (err) {
      if (windowSec === hostHistoryState.windowSec) {
        hostHistoryState.error = (err && err.message) || "falha desconhecida";
      }
    } finally {
      hostHistoryState.inFlight = false;
      if (windowSec === hostHistoryState.windowSec) {
        renderAvailability();
        renderTunnelTimeline();
      }
      if (hostHistoryState.pendingReload) {
        hostHistoryState.pendingReload = false;
        fetchHostHistory(true);
      }
    }
  }

  /** A readable reason for a host-history response that was not usable. */
  function hostHistoryErrorLabel(status) {
    if (status === 400) return "pedido sem janela";
    if (status === 401) return "sessão expirada";
    if (status === 403) return "exige step-up";
    if (status === 404) return "rota não encontrada";
    if (status === 429) return "limite de requisições";
    if (status === 501) return "histórico indisponível neste daemon";
    return "HTTP " + status;
  }

  /** The daemon predates /api/host/history. */
  function hostHistoryStaleDaemonLabel() {
    return "daemon sem suporte a /api/host/history";
  }

  /**
   * One availability row per service the daemon has ever recorded.
   *
   * Services are drawn from the recorded series rather than from the live
   * service list: a service that was removed from the config still has a
   * history, and hiding it would erase the very outage the reader came for.
   */
  function renderAvailability() {
    const host = el.availList;
    if (!host) return;
    const data = hostHistoryState.data;
    const services = data && data.services ? data.services : {};
    const ids = Object.keys(services).sort();

    if (!el.servicesAvailability) return;
    if (!ids.length) {
      // Nothing recorded yet is a legitimate state — a daemon that has been up
      // for five minutes has no history — but it is not the same as a failed
      // request, so the panel says which one it is.
      el.servicesAvailability.classList.remove("hidden");
      host.replaceChildren();
      // An axis with no strips under it would label nothing.
      for (const node of [el.availAxisStart, el.availAxisMid, el.availAxisEnd]) {
        if (node) node.textContent = "";
      }
      const empty = document.createElement("p");
      empty.className = "status-sub";
      empty.textContent = hostHistoryState.error
        ? "Não foi possível ler o histórico: " + hostHistoryState.error + "."
        : (hostHistoryState.lastSuccess
            ? "Nenhuma sonda de serviço registrada nesta janela."
            : "Carregando disponibilidade…");
      host.appendChild(empty);
      return;
    }

    el.servicesAvailability.classList.remove("hidden");
    const from = Number(data.from) || 0;
    const to = Number(data.to) || 0;
    // One axis above every strip, because they all share the window. It is also
    // the only thing that makes the window buttons legible here: a strip is
    // AVAILABILITY_SLOTS cells wide whatever the window, so on a host that was
    // simply up the whole time "1h" and "7d" are the same row of green.
    const span = to - from;
    if (span > 0 && el.availAxisStart) {
      el.availAxisStart.textContent = historyAxisLabel(from, span);
      if (el.availAxisMid) {
        el.availAxisMid.textContent = historyAxisLabel(from + Math.round(span / 2), span);
      }
      if (el.availAxisEnd) el.availAxisEnd.textContent = historyAxisLabel(to, span);
    }
    const frag = document.createDocumentFragment();

    for (const id of ids) {
      const strip = availabilityStrip(services[id] || [], from, to, AVAILABILITY_SLOTS);
      const summary = availabilitySummary(strip);

      const row = document.createElement("div");
      row.className = "availability-row";

      const name = document.createElement("span");
      name.className = "availability-name";
      name.textContent = serviceDisplayName(id);
      name.title = id;

      const cells = document.createElement("div");
      cells.className = "availability-cells";
      for (const state of strip) {
        const cell = document.createElement("span");
        cell.className = "availability-cell " + state;
        cells.appendChild(cell);
      }

      const pct = document.createElement("span");
      pct.className = "availability-pct num";
      // No denominator means no percentage: reporting 100% for a service that
      // was never probed would be a precise, confident, wrong number.
      pct.textContent = summary.percent == null
        ? "—"
        : summary.percent.toFixed(summary.percent === 100 ? 0 : 1) + "%";

      const label = summary.percent == null
        ? name.textContent + ": sem dados nesta janela"
        : name.textContent + ": " + summary.percent.toFixed(1) + "% no ar em " +
          summary.known + " amostras conhecidas (" + summary.down + " fora do ar)";
      row.setAttribute("title", label);
      row.setAttribute("aria-label", label);

      row.appendChild(name);
      row.appendChild(cells);
      row.appendChild(pct);
      frag.appendChild(row);
    }
    host.replaceChildren(frag);
  }

  /** The readable name for a service ID, falling back to the ID itself. */
  function serviceDisplayName(id) {
    const services = state.services || [];
    const hit = services.find((s) => s.id === id || s.name === id);
    return hit && hit.name ? hit.name : id;
  }

  /**
   * The tunnel's incarnation history as one bar per lifetime.
   *
   * A long uninterrupted bar is a tunnel that held; a row of thin ones is a
   * tunnel that kept rotating, which is the thing the operator cannot see from
   * the current URL alone — by definition, the URL they can see is the one
   * that is working.
   */
  function renderTunnelTimeline() {
    const host = el.tunnelTimeline;
    if (!host) return;
    const data = hostHistoryState.data;
    const incarnations = data && Array.isArray(data.tunnel) ? data.tunnel : [];
    if (!el.tunnelTimelineBlock) return;

    if (!incarnations.length) {
      el.tunnelTimelineBlock.classList.add("hidden");
      host.replaceChildren();
      return;
    }
    el.tunnelTimelineBlock.classList.remove("hidden");

    const from = Number(data.from) || 0;
    const to = Number(data.to) || 0;
    const nowUnix = Math.floor(Date.now() / 1000);
    const frag = document.createDocumentFragment();

    for (const inc of incarnations) {
      const span = incarnationSpan(inc, from, to);
      if (!span) continue;
      const x = (span.start * 100).toFixed(2);
      const w = Math.max(0.4, (span.end - span.start) * 100).toFixed(2);
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("class", "timeline-bar" + (span.current ? " is-current" : ""));
      rect.setAttribute("x", x);
      rect.setAttribute("y", "4");
      rect.setAttribute("width", w);
      rect.setAttribute("height", "18");
      rect.setAttribute("rx", "1");
      const secs = incarnationSeconds(inc, nowUnix);
      rect.setAttribute("data-tip",
        (span.current ? "Túnel atual" : "Túnel anterior") + ": " +
        inc.url + " · " + formatDurationSeconds(secs));
      frag.appendChild(rect);
    }
    host.replaceChildren(frag);

    const rotations = incarnations.length;
    if (el.tunnelTimelineCount) {
      el.tunnelTimelineCount.textContent = rotations === 1
        ? "1 URL nesta janela"
        : rotations + " URLs nesta janela";
    }
    if (el.timelineFrom) el.timelineFrom.textContent = formatTimestamp(from);
    if (el.timelineTo) el.timelineTo.textContent = formatTimestamp(to);
  }

  /** A compact age/duration for the timeline axis and tooltips. */
  function formatDurationSeconds(secs) {
    if (secs == null || !isFinite(secs) || secs <= 0) return "0s";
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h >= 24) return Math.floor(h / 24) + "d " + (h % 24) + "h";
    if (h > 0) return h + "h " + m + "m";
    if (m > 0) return m + "m";
    return Math.round(secs) + "s";
  }

  /** A short wall-clock label for the timeline axis. */
  function formatTimestamp(unix) {
    if (!unix) return "—";
    const d = new Date(unix * 1000);
    return d.toLocaleString(undefined, {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  }


  /**
   * Liveness of the live badge. The visible text is the host's uptime and
   * belongs to renderTelemetry(); this owns only the stale flag, so a failed
   * poll cannot leave the badge still reading as live.
   *
   * It used to also swap the text to "indisponivel" and back. The 1s ticker
   * called updateLiveBadge(true) every second — it tested lastTelemetryAt,
   * which stays set from the last *good* poll — so one failed poll flipped the
   * badge to "indisponivel" and was overwritten a second later, over and over.
   * Staleness is now a state of the dot, not a word that competes with uptime
   * for the same slot and flickers between the two.
   */
  function updateLiveBadge(ok) {
    if (el.telLive) el.telLive.classList.toggle("is-stale", !ok);
    updateLiveBadgeTip();
  }

  /**
   * The badge's tooltip: how long the host has been up, plus how old the
   * reading behind it is. Tooltip only — a per-second counter belongs here
   * because here it cannot be mistaken for the value on screen.
   */
  function updateLiveBadgeTip() {
    if (!el.telLive) return;
    const snap = lastSnapshot;
    const parts = [];
    if (snap && snap.uptime_s != null) parts.push("ligado há " + formatUptime(snap.uptime_s));
    if (lastTelemetryAt) {
      const secs = Math.floor((Date.now() - lastTelemetryAt) / 1000);
      parts.push(secs < 5 ? "leitura ao vivo" : "leitura há " + secs + "s");
    }
    el.telLive.title = parts.join(" · ") || "Telemetria do host em tempo real";
  }

  /** 1s ticker for the badge tooltip; it never rewrites the visible uptime. */
  function startLiveTicker() {
    if (liveTicker) clearInterval(liveTicker);
    liveTicker = setInterval(updateLiveBadgeTip, 1000);
  }

  /**
   * GET the telemetry route, minting a step-up proof once if the operator
   * put the endpoint behind one. Refusal drives the proof, not the poll: an
   * operator who never enabled step-up pays nothing for this. Shared by the
   * live poll and the history query so both honour it identically.
   */
  async function telemetryGet(url) {
    const buildHeaders = () => {
      const h = Object.assign({}, getStepUpHeader() || {});
      if (typeof state !== "undefined" && state && state.authToken) {
        h["Authorization"] = "Bearer " + state.authToken;
      }
      return Object.keys(h).length ? h : undefined;
    };
    let r = await fetch(url, {
      credentials: "include",
      headers: buildHeaders(),
    });
    if (r.status === 401 && getStepUpHeader() === null) {
      await requestStepUp(state.tunnelURL);
      r = await fetch(url, {
        credentials: "include",
        headers: buildHeaders(),
      });
    }
    return r;
  }

  async function fetchTelemetry() {
    if (typeof canPollTelemetry === "function" && !canPollTelemetry()) {
      if (telemetryTimer) { clearInterval(telemetryTimer); telemetryTimer = null; }
      return;
    }
    // A slow request must not pile up behind the 2s interval.
    if (telemetryFetchInFlight) return;
    telemetryFetchInFlight = true;
    try {
      const endpoint = typeof telemetryEndpoint === "function" ? telemetryEndpoint(TELEMETRY_PATH) : TELEMETRY_PATH;
      const r = await telemetryGet(endpoint);
      if (r.status === 404) {
        if (telemetryTimer) { clearInterval(telemetryTimer); telemetryTimer = null; }
        if (telemetrySource !== "nostr") updateLiveBadge(false);
        return;
      }
      if (!r.ok) {
        if (telemetrySource !== "nostr") updateLiveBadge(false);
        return;
      }
      const snap = await r.json();
      telemetrySource = "http";
      // Kept for the history panel: it needs to tell "this host has no such
      // metric" apart from "this window has no samples".
      lastSnapshot = snap;
      renderTelemetry(snap);
      lastTelemetryAt = Date.now();
      updateLiveBadge(true);
      // Kick the history window off once the live route has proven reachable,
      // so the chart never fires before a session is actually established.
      // fetchHistory gates itself from here on: it refreshes when the loaded
      // series goes stale and backs off while the last attempt failed, so this
      // call costs one request every HISTORY_REFRESH_MS, not one per tick.
      fetchHistory();
      // The event histories come from a sibling route that only exists once
      // the session does, so they are kicked off from the same place. Each
      // gates itself from here on.
      fetchHostHistory();
    } catch (_) {
      if (telemetrySource !== "nostr") updateLiveBadge(false);
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
    state.relayManager = new RelayManager().withHistory(new RelayRttHistory());
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
    restoreSectionCollapses();
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
    // Every section's disclosure button, in one loop — see COLLAPSIBLE_SECTIONS.
    bindSectionCollapses();
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
      el.servicesSection.classList.add("hidden");
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
      el.servicesSection.classList.add("hidden");
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
    // EXCETO dl_conn_theme/dl_conn_palette/dl_conn_density: preferências de aparência devem
    // sobreviver ao reset.
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("dl_conn_") && k !== "dl_conn_theme" && k !== "dl_conn_palette" && k !== "dl_conn_density") localStorage.removeItem(k);
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
    el.servicesSection.classList.add("hidden");
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
    el.servicesSection.classList.remove("hidden");
    el.localPortSection.classList.remove("hidden");
    if (data.host_telemetry) {
      telemetrySource = "nostr";
      lastSnapshot = data.host_telemetry;
      lastTelemetryAt = Date.now();
      renderTelemetry(data.host_telemetry);
      updateLiveBadge(true);
    }
    fetchHistory(true);
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
   * Render the services list in the Serviços section — the one and only services
   * view. It carries the rows, the health strip and every management control,
   * so the block's visibility follows the Live phase (the caller un-hides the
   * section) rather than the service count: with zero services the "add
   * service" button has to stay reachable, which is why an empty list renders a
   * message instead of collapsing the whole block.
   */
  function renderServicesOverview() {
    if (!el.servicesSection || !el.servicesOverviewList || !el.servicesOverviewCount) return;

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

  /**
   * Collapse/expand the relay card body in place. Distinct from
   * onToggleRelays, which hides the entire card: collapsing keeps the head
   * and the #relay-summary pill on screen, which is the point — how many
   * relays are reachable stays readable while the list is closed.
   */
  /**
   * Collapse/expand a section's body in place, driven by the declaration above.
   *
   * The previous version of this was one hand-written toggle per card, and
   * every bug it produced was a sibling drifting from its copy: the relay card
   * passed the collapsed state through un-inverted and its button did nothing
   * at all, and "every section collapses" was a convention nobody could check
   * because the set of sections was spread across the markup, the `el` map and
   * the listeners. One table plus one controller removes the place for that
   * drift; `layout_tests.js` asserts the table against the markup so a new
   * section cannot ship without a button.
   *
   * @param {{bodies:string[],buttons:string[],label:string}} section
   * @param {boolean} collapsed
   */
  function applySectionCollapse(section, collapsed) {
    for (const id of section.bodies) {
      const body = $(id);
      if (body) body.classList.toggle("hidden", collapsed);
    }
    // aria-label and data-tip move together: the tooltip is drawn from
    // attr(data-tip) (see [data-tip]::after in style.css), so updating only one
    // would leave a "Recolher" tooltip on a button that only expands.
    const label = collapseLabel(collapsed, section.label);
    for (const id of section.buttons) {
      const btn = $(id);
      if (!btn) continue;
      btn.setAttribute("aria-expanded", String(!collapsed));
      btn.setAttribute("aria-label", label);
      btn.setAttribute("data-tip", label);
    }
    try {
      localStorage.setItem(section.storageKey, storedValue(collapsed));
    } catch {
      // Storage can be unavailable (private mode, quota). The collapse still
      // works for this page view; it just will not survive a reload.
    }
  }

  /**
   * Flip one section between collapsed and expanded.
   *
   * The body's current class IS the state, so the next state is its inverse —
   * see nextCollapsed() in js/section_collapse.js for why passing the read
   * value straight through is silent rather than obvious.
   *
   * @param {{bodies:string[]}} section
   */
  function toggleSectionCollapse(section) {
    const body = $(section.bodies[0]);
    if (!body) return;
    applySectionCollapse(section, nextCollapsed(body.classList.contains("hidden")));
  }

  /** Wire every declared section's disclosure button. */
  function bindSectionCollapses() {
    for (const section of COLLAPSIBLE_SECTIONS) {
      for (const id of section.buttons) {
        const btn = $(id);
        if (btn) btn.addEventListener("click", () => toggleSectionCollapse(section));
      }
    }
  }

  /**
   * Restore every section's collapsed state from its saved preference.
   *
   * Runs on every load rather than only when a stored value exists: an absent
   * preference means "expanded", and that is also the state the markup ships
   * in, so the two agree without writing a redundant record. Reading the
   * stored value and applying it are kept together so a section cannot end up
   * displaying a state it did not persist.
   */
  function restoreSectionCollapses() {
    for (const section of COLLAPSIBLE_SECTIONS) {
      let saved = null;
      try {
        saved = localStorage.getItem(section.storageKey);
      } catch {
        continue; // unreadable storage: leave this section open
      }
      applySectionCollapse(section, storedCollapsed(saved));
    }
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

      row.appendChild(buildRttSparkline(relay.url, result));

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

  /**
   * The relay's recent RTT as a sparkline, or an empty box when there is
   * nothing to draw yet.
   *
   * Every relay in the column is drawn against the *slowest measured relay*,
   * not against its own peak. A per-relay scale would make a 2 s relay look
   * as smooth as a 50 ms one; sharing the scale is what lets the shapes be
   * compared with each other, which is the only reason to have a trend at
   * all. The shared ceiling is the reason the vertical axis is not drawn per
   * row — the badge next to it carries the current number.
   */
  function buildRttSparkline(url, result) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "relay-spark");
    svg.setAttribute("viewBox", "0 0 100 40");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("class", "relay-spark-line " + getBadgeClass(result));

    const history = state.relayManager.history;
    const samples = history ? history.get(url) : [];
    const ceiling = sharedSparkCeiling();

    if (samples.length && ceiling) {
      line.setAttribute("points", sparklinePoints(samples, ceiling));
      svg.appendChild(line);
      svg.setAttribute("data-samples", String(samples.length));
    } else {
      // Nothing measured yet. An empty element rather than a zero-valued
      // line: a flat line at the bottom would read as "measured, and fast".
      line.setAttribute("class", "relay-spark-line relay-spark-empty");
      svg.appendChild(line);
    }
    return svg;
  }

  /**
   * The vertical scale shared by every relay sparkline: the slowest value any
   * relay has recently measured, so no relay's line is ever clipped away and
   * the slowest relay's line reaches the top of its box.
   *
   * Returns 0 when nothing has been measured, which callers read as "nothing
   * to draw" — better than a scale of 1, which would turn any measurement
   * into a full-height spike.
   */
  function sharedSparkCeiling() {
    const history = state.relayManager.history;
    if (!history) return 0;
    let worst = 0;
    for (const relay of state.relayManager.getAll()) {
      for (const v of history.measured(relay.url)) {
        if (v > worst) worst = v;
      }
    }
    return worst;
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
    // The dataset key is camelCase ("themeChoice") but the markup spells the
    // attribute in kebab-case ("data-theme-choice"). Building the selector by
    // concatenation produced "[data-themeChoice]", which matches nothing, so
    // every click hit the early return and the sheet changed nothing at all.
    // The attribute name is derived from the same key dataset reads it from,
    // so the two can no longer drift apart.
    const dataAttr = (key) => "data-" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
    const choose = (group, attr, key, apply) => {
      if (!group) return;
      const selector = "[" + dataAttr(attr) + "]";
      group.addEventListener("click", (event) => {
        if (!event.target || typeof event.target.closest !== "function") return;
        const btn = event.target.closest(selector);
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
