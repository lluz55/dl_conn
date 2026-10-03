/* dev/mock_data.js — fixtures for the local UI harness.
 *
 * Every value here is synthetic.
 *
 * Plain data, no behavior. Values are chosen to make the interface *show* its
 * states rather than to be realistic: one disk is deliberately over the warn
 * threshold and one over the critical one, so the amber and red meter states
 * are visible without waiting for a real host to misbehave. Edit freely —
 * nothing outside web/dev/ reads this.
 */

import { getPublicKey } from '../vendor/nostr-tools-2.9.2.mjs';

/** Placeholder identity.
 *
 *  k = 1, i.e. 0x00…01, padded to 32 bytes. secp256k1 rejects 0 (the scalar
 *  must satisfy 0 < k < n), so an all-zero placeholder is *not* an option here
 *  — getPublicKey() throws on it. k = 1 is valid, and its public key is the
 *  curve's generator point: a well-known "null" identity, which is exactly what
 *  you want in a fixture, since it cannot be confused with someone's real key.
 *  Never persisted, and never replace it with a real one.
 */
export const MOCK_DEV_SK = "0".repeat(63) + "1";
export const MOCK_DEV_NPUB = getPublicKey(MOCK_DEV_SK);

export const MOCK_TUNNEL_URL = "https://dev-harness.trycloudflare.com";
export const MOCK_HOST_NPUB = "npub1ccz8l9zpa47k6vz9gphftsrumpw80rjt3nhnefat4symjhrsnmjs38mnyd";
/** Short, so the expiry meter and the rail countdown are visibly ticking. */
export const MOCK_TTL_SECONDS = 3600;

/**
 * Shaped like config.yaml services: the fields renderServices() reads are
 * id, name, prefix, icon, description, status.
 */
export const MOCK_SERVICES = [
  { id: "homeassistant", name: "Home Assistant", prefix: "/ha", icon: "home", status: "up" },
  { id: "frigate", name: "Frigate", prefix: "/frigate", icon: "camera", status: "up" },
  { id: "z2m", name: "Zigbee2MQTT", prefix: "/z2m", icon: "lightbulb", status: "up" },
  { id: "grafana", name: "Grafana", prefix: "/grafana", icon: "activity", status: "up" },
  { id: "mosquitto", name: "Mosquitto", prefix: "/mqtt", icon: "server", status: "down" },
  { id: "plex", name: "Plex", prefix: "/plex", icon: "film", status: "up" },
  { id: "jellyfin", name: "Jellyfin", prefix: "/jellyfin", icon: "tv", status: "up" },
  { id: "portainer", name: "Portainer", prefix: "/portainer", icon: "package", status: "unknown" },
  { id: "nas", name: "Storage", prefix: "/nas", icon: "hard-drive", status: "up" },
  { id: "uptime", name: "Uptime Kuma", prefix: "/kuma", icon: "zap", status: "up" },
];

/* ── Telemetry ────────────────────────────────────────────────────
 * A smooth random walk rather than white noise: real load and memory move
 * slowly, and a jittering meter looks broken in a way that hides real bugs.
 * Every series is deterministic in shape but advances on a clock, so two
 * browser tabs show the same shapes and one tab does not jump on reload. */

let t = 0;

function walk(centre, spread, step = 0.04) {
  // Box-Muller, then a leaky integrator so the value trends rather than jumps.
  const noise = Math.sqrt(-2 * Math.log(Math.random() + 1e-9)) *
    Math.cos(2 * Math.PI * Math.random());
  t = t * 0.94 + noise * step;
  return Math.max(0, Math.min(100, centre + t * spread * 40));
}

/** One synthetic snapshot, shaped like a real sensors.Snapshot. */
export function mockSnapshot() {
  const cores = 4;
  const cpuLoad = 0.35 + (walk(0.4, 0.9) / 100) * cores;
  const ramPct = 55 + walk(0, 0.35) * 0.4;
  return {
    sampled_at: new Date().toISOString(),
    num_cpu: cores,
    // Seconds, not milliseconds: uptime_s is what /proc/uptime reports, and
    // formatUptime() treats it as seconds. Writing 1000*60*60*24*3 here showed
    // "72283h" in the header pill and is a good reminder of the unit.
    uptime_s: 3 * 24 * 3600 + 17 * 60 + 42,
    cpu: {
      temp_c: 47 + walk(0, 0.5) * 0.22,
      load1: cpuLoad,
      load5: cpuLoad * 0.94,
      load15: cpuLoad * 0.88,
      freq_mhz: 2400 + Math.round(walk(0, 1) * 6),
    },
    memory: {
      total_mb: 8192,
      used_mb: Math.round((ramPct / 100) * 8192),
      available_mb: Math.round(8192 - (ramPct / 100) * 8192),
      used_pct: ramPct,
    },
    disks: [
      { mountpoint: "/", total_mb: 512000, used_mb: 197632, used_pct: 38.6 },
      // Over the 90% warn line: the row should render amber.
      { mountpoint: "/var/lib/docker", total_mb: 204800, used_mb: 194560, used_pct: 95.0 },
      // Over the 97% critical line: the row should render red.
      { mountpoint: "/mnt/backups", total_mb: 1024000, used_mb: 1003520, used_pct: 98.0 },
    ],
    gpu: { temp_c: 58 + walk(0, 0.4) * 0.2, util_pct: Math.round(12 + walk(0, 0.6) * 0.5) },
    battery: { capacity_pct: 78, status: "Discharging", available: true },
  };
}

/** A deterministic series for the history chart, oldest first. */
export function mockHistory(count, spanSeconds) {
  const out = [];
  const now = Date.now();
  const stepMs = (spanSeconds * 1000) / Math.max(1, count - 1);
  for (let i = 0; i < count; i++) {
    const when = new Date(now - (count - 1 - i) * stepMs);
    const at = when.getTime() / 1000;
    // A daily cycle, so a 7-day window shows seven humps instead of a blob.
    const hour = when.getHours() + when.getMinutes() / 60;
    const daily = Math.sin(((hour - 4) / 24) * Math.PI * 2);
    const used = 40 + daily * 22 + Math.sin(i / 7) * 5;
    out.push({
      sampled_at: when.toISOString(),
      num_cpu: 4,
      uptime_s: i * 60,
      cpu: { temp_c: 46 + daily * 9, load1: (used / 100) * 4, load5: (used / 100) * 4, load15: (used / 100) * 4 },
      memory: { total_mb: 8192, used_mb: Math.round((used / 100) * 8192), used_pct: used },
      disks: [{ mountpoint: "/", total_mb: 512000, used_mb: 197632, used_pct: 38.6 }],
      gpu: { temp_c: 55 + daily * 12, util_pct: Math.round(20 + daily * 45) },
      battery: { capacity_pct: 78, status: "Discharging", available: true },
      _at: at,
    });
  }
  return out;
}
