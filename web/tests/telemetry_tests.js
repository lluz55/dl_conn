/* telemetry_tests.js — Tests for the host telemetry rendering */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log("  ✓ " + msg); }
  else { failed++; console.error("  ✗ FAIL: " + msg); }
}

const here = dirname(fileURLToPath(import.meta.url));
const appJs = readFileSync(join(here, '..', 'app.js'), 'utf8');

/**
 * Extract a top-level function body by name from a JS source string. The body
 * is everything between the opening `{` of the function and the matching
 * closing `}`. Brace counting respects single-line comments, block comments,
 * and string/template literals.
 */
function extractFunction(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(src);
  if (!m) throw new Error("function " + name + " not found");
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '"' || c === "'") {
      // skip string
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') i++;
        i++;
      }
    } else if (c === '`') {
      i++;
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') i++;
        i++;
      }
    } else if (c === '/' && src[i+1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && src[i+1] === '*') {
      i += 2;
      while (i < src.length - 1 && !(src[i] === '*' && src[i+1] === '/')) i++;
      i++;
    }
    i++;
  }
  return src.slice(m.index + m[0].length, i - 1);
}

const formatUptimeBody = extractFunction(appJs, 'formatUptime');
const renderTelemetryBody = extractFunction(appJs, 'renderTelemetry');

// renderTelemetry calls formatUptime internally. Since function declarations
// inside a new Function body don't get hoisted to the wrapped scope, we
// inline the formatUptime body as a const at the top.
const formatUptime = new Function('total', formatUptimeBody);
const renderTelemetry = new Function(
  'snap', 'el',
  'const formatUptime = ' + formatUptime + ';\n' + renderTelemetryBody
);

console.log("\n=== Telemetry formatUptime Tests ===");
assert(formatUptime(0) === "0m", "0s → 0m");
assert(formatUptime(60) === "1m", "60s → 1m");
assert(formatUptime(3600) === "1h 0m", "3600s → 1h 0m");
assert(formatUptime(3661) === "1h 1m", "3661s → 1h 1m");
assert(formatUptime(86400) === "24h 0m", "86400s → 24h 0m");
assert(formatUptime(90061) === "25h 1m", "90061s → 25h 1m");
assert(formatUptime(null) === "—", "null → em dash");
assert(formatUptime(undefined) === "—", "undefined → em dash");
assert(formatUptime(NaN) === "—", "NaN → em dash");

console.log("\n=== renderTelemetry Tests ===");

function makeEl() {
  return { textContent: "", classList: { add() {}, remove() {} } };
}
const el = {
  hostTelemetrySection: makeEl(),
  telCpu: makeEl(),
  telRam: makeEl(),
  telDisk: makeEl(),
  telGpu: makeEl(),
  telBatt: makeEl(),
  telUptime: makeEl(),
};

renderTelemetry({
  cpu: { temp_c: 65.5, load1: 0.42 },
  memory: { used_pct: 55.0, used_mb: 4400, total_mb: 8000 },
  disks: [{ mountpoint: "/", used_pct: 30.0, used_mb: 10000, total_mb: 33000 }],
  gpu: { temp_c: 70.0, util_pct: 25.0 },
  battery: { available: true, capacity_pct: 80, status: "Discharging" },
  uptime_s: 7320,
}, el);

assert(el.telCpu.textContent.includes("65.5°C"), "CPU shows temp: " + el.telCpu.textContent);
assert(el.telCpu.textContent.includes("load"), "CPU shows load: " + el.telCpu.textContent);
assert(el.telRam.textContent.includes("55.0%"), "RAM shows pct: " + el.telRam.textContent);
assert(el.telRam.textContent.includes("4400"), "RAM shows used_mb: " + el.telRam.textContent);
assert(el.telDisk.textContent.includes("30.0%"), "Disk shows pct: " + el.telDisk.textContent);
assert(el.telDisk.textContent.includes("/"), "Disk shows mountpoint: " + el.telDisk.textContent);
assert(el.telGpu.textContent.includes("70.0°C"), "GPU shows temp: " + el.telGpu.textContent);
assert(el.telGpu.textContent.includes("25%"), "GPU shows util: " + el.telGpu.textContent);
assert(el.telBatt.textContent.includes("80%"), "Battery shows pct: " + el.telBatt.textContent);
assert(el.telBatt.textContent.includes("Discharging"), "Battery shows status: " + el.telBatt.textContent);
assert(el.telUptime.textContent === "2h 2m", "Uptime formatted: " + el.telUptime.textContent);

renderTelemetry({
  cpu: { load1: 1.0 },
  memory: null,
  disks: [],
  gpu: null,
  battery: { available: false },
  uptime_s: 0,
}, el);
assert(el.telCpu.textContent.includes("load"), "CPU without temp still shows load");
assert(el.telRam.textContent === "—", "RAM missing → em dash");
assert(el.telDisk.textContent === "—", "Disks empty → em dash");
assert(el.telGpu.textContent === "—", "GPU missing → em dash");
assert(el.telBatt.textContent === "—", "Battery unavailable → em dash");
assert(el.telUptime.textContent === "0m", "Uptime 0 → 0m");

renderTelemetry({
  sampled_at: "2026-01-01T00:00:00Z",
  cpu_temp_c: 50.0,
  cpu_load1: 0.3,
  ram_used_pct: 40.0, ram_used_mb: 1000, ram_total_mb: 2500,
  disk_used_pct: 20.0, disk_used_mb: 100, disk_total_mb: 500,
  mountpoint: "/",
  gpu_temp_c: 60.0, gpu_util_pct: 10.0,
  batt_capacity_pct: 75, batt_status: "Charging",
  uptime_s: 1234,
}, el);
assert(el.telCpu.textContent.includes("50.0°C"), "compact CPU temp: " + el.telCpu.textContent);
assert(el.telRam.textContent.includes("40.0%"), "compact RAM pct");
assert(el.telDisk.textContent.includes("/"), "compact mountpoint");
assert(el.telGpu.textContent.includes("60.0°C"), "compact GPU temp");
assert(el.telGpu.textContent.includes("10%"), "compact GPU util");
assert(el.telBatt.textContent.includes("75%"), "compact batt");
assert(el.telBatt.textContent.includes("Charging"), "compact batt status");
assert(el.telUptime.textContent === "20m", "compact uptime");

console.log("\n=== Results: " + passed + " passed, " + failed + " failed ===");
if (failed > 0) process.exit(1);
