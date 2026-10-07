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

/**
 * Like extractFunction, but returns the whole `function name(...) { ... }`
 * text (with its `async` prefix when it has one) instead of just the body.
 * Needed to re-declare one extracted function inside another's scope — the
 * body alone is a bare statement sequence that runs immediately.
 */
function extractDeclaration(src, name) {
  const re = new RegExp('(async\\s+)?function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(src);
  if (!m) throw new Error("function " + name + " not found");
  return src.slice(m.index, m.index + m[0].length) + extractFunction(src, name) + "}";
}

/**
 * Returns the right-hand side of `const NAME = …` (objects, arrays, numbers),
 * so a test can evaluate the production constant itself instead of keeping a
 * copy that would happily drift away from the real one.
 */
function extractConstValue(src, name) {
  const re = new RegExp('(?:const|let)\\s+' + name + '\\s*=\\s*');
  const m = re.exec(src);
  if (!m) throw new Error("const " + name + " not found");
  let i = m.index + m[0].length;
  const start = i;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') i++;
        i++;
      }
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length - 1 && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i++;
    } else if (c === '(' || c === '[' || c === '{') {
      depth++;
    } else if (c === ')' || c === ']' || c === '}') {
      depth--;
    } else if (c === ';' && depth === 0) {
      return src.slice(start, i);
    }
    i++;
  }
  throw new Error("const " + name + " is not terminated");
}

const formatCapacityBody = extractFunction(appJs, 'formatCapacity');
const formatUptimeBody = extractFunction(appJs, 'formatUptime');
const historyAxisLabelBody = extractFunction(appJs, 'historyAxisLabel');
const historySpanLabelBody = extractFunction(appJs, 'historySpanLabel');
const renderTelemetryBody = extractFunction(appJs, 'renderTelemetry');
const downsampleBody = extractFunction(appJs, 'downsample');
const historyErrorLabelBody = extractFunction(appJs, 'historyErrorLabel');
const historyStaleDaemonLabelBody = extractFunction(appJs, 'historyStaleDaemonLabel');
const fetchHistoryBody = extractFunction(appJs, 'fetchHistory');
const indexHtml = readFileSync(join(here, '..', 'index.html'), 'utf8');

/**
 * The GPU vocabulary — the vendor table and the three labels built from it —
 * evaluated on its own so both the meter rendering and missingMetricReason()
 * can be tested against the production functions instead of a copy of them.
 * GPU_VENDOR_LABELS is passed in as a parameter for the same reason
 * formatCapacity is below: a const is not hoisted into this scope.
 */
const gpuLabels = new Function(`
  const GPU_VENDOR_LABELS = ${extractConstValue(appJs, 'GPU_VENDOR_LABELS')};
  ${extractDeclaration(appJs, 'gpuVendorName')}
  ${extractDeclaration(appJs, 'gpuMeterLabel')}
  ${extractDeclaration(appJs, 'gpuSourceLabel')}
  return { GPU_VENDOR_LABELS, gpuVendorName, gpuMeterLabel, gpuSourceLabel };
`)();
const { GPU_VENDOR_LABELS, gpuVendorName, gpuMeterLabel, gpuSourceLabel } = gpuLabels;

/**
 * The history panel's real metric table and the helpers around it, evaluated
 * in one scope. Assembled from the production source on purpose: a test that
 * carried its own copy of the descriptor table would keep passing after the
 * table changed underneath it.
 */
const history = new Function(`
  const METER_WARN_PCT = ${extractConstValue(appJs, 'METER_WARN_PCT')};
  const METER_CRIT_PCT = ${extractConstValue(appJs, 'METER_CRIT_PCT')};
  const TEMP_WARN_C = ${extractConstValue(appJs, 'TEMP_WARN_C')};
  const THROTTLE_FREQ_RATIO = ${extractConstValue(appJs, 'THROTTLE_FREQ_RATIO')};
  const THROTTLE_TEMP_C = ${extractConstValue(appJs, 'THROTTLE_TEMP_C')};
  const HISTORY_METRICS = ${extractConstValue(appJs, 'HISTORY_METRICS')};
  ${extractDeclaration(appJs, 'cpuPercent')}
  ${extractDeclaration(appJs, 'referenceFreqMHz')}
  ${extractDeclaration(appJs, 'hostTempC')}
  ${extractDeclaration(appJs, 'tempSourceLabel')}
  ${extractDeclaration(appJs, 'historyMetric')}
  ${extractDeclaration(appJs, 'historyValue')}
  return {
    historyValue, historyMetric, hostTempC, tempSourceLabel,
    HISTORY_METRICS, referenceFreqMHz,
    THROTTLE_FREQ_RATIO, THROTTLE_TEMP_C,
  };
`)();

console.log("\n=== Telemetry Polling Tests ===");
assert(/const TELEMETRY_POLL_MS = 2000;/.test(appJs), "host health refreshes every 2 seconds");
assert((appJs.match(/setInterval\(fetchTelemetry, TELEMETRY_POLL_MS\)/g) || []).length === 2,
  "initial and visibility-resume polling use the shared interval");
assert(/if \(telemetryFetchInFlight\) return;/.test(appJs), "slow telemetry requests do not overlap");

// renderTelemetry calls formatCapacity, formatUptime and updateLiveBadgeTip
// internally. Since function declarations inside a new Function body don't get
// hoisted to the wrapped scope, the two formatters are passed in as parameters
// and the tooltip updater is stubbed — it reads closure state (lastSnapshot,
// lastTelemetryAt) that this isolated scope does not have.
const formatCapacity = new Function('mb', formatCapacityBody);
const formatUptime = new Function('total', formatUptimeBody);
const renderTelemetry = new Function(
  'snap', 'el', 'formatUptime', 'updateLiveBadgeTip',
  'const formatCapacity = ' + formatCapacity + ';\n' +
  'const GPU_VENDOR_LABELS = ' + JSON.stringify(GPU_VENDOR_LABELS) + ';\n' +
  extractDeclaration(appJs, 'gpuVendorName') + '\n' +
  renderTelemetryBody
);

console.log("\n=== formatCapacity Tests (adaptive MB/GB/TB, base 1024) ===");
assert(formatCapacity(null) === "—", "null → em dash");
assert(formatCapacity(undefined) === "—", "undefined → em dash");
assert(formatCapacity(NaN) === "—", "NaN → em dash");
assert(formatCapacity(-5) === "—", "negative → em dash");
assert(formatCapacity(0) === "0 MB", "0 → 0 MB");
assert(formatCapacity(512) === "512 MB", "512 MB stays MB");
assert(formatCapacity(1024) === "1 GB", "1024 MB → 1 GB");
assert(formatCapacity(8000) === "7.8 GB", "8000 MB → 7.8 GB");
assert(formatCapacity(33000) === "32.2 GB", "33000 MB → 32.2 GB");
assert(formatCapacity(1048576) === "1 TB", "1048576 MB → 1 TB");
assert(formatCapacity(5 * 1048576) === "5 TB", "5 TB");

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
  telUpdated: makeEl(),
};

renderTelemetry({
  cpu: { temp_c: 65.5, load1: 0.42 },
  memory: { used_pct: 55.0, used_mb: 4400, total_mb: 8000 },
  disks: [{ mountpoint: "/", used_pct: 30.0, used_mb: 10000, total_mb: 33000 }],
  gpu: { temp_c: 70.0, util_pct: 25.0 },
  battery: { available: true, capacity_pct: 80, status: "Discharging" },
  uptime_s: 7320,
}, el, formatUptime, function () {});

assert(el.telCpu.textContent.includes("65.5°C"), "CPU shows temp: " + el.telCpu.textContent);
assert(el.telCpu.textContent.includes("load"), "CPU shows load: " + el.telCpu.textContent);
assert(el.telRam.textContent.includes("55.0%"), "RAM shows pct: " + el.telRam.textContent);
assert(el.telRam.textContent.includes("4.3 GB"), "RAM shows used capacity: " + el.telRam.textContent);
assert(el.telRam.textContent.includes("7.8 GB"), "RAM shows total capacity: " + el.telRam.textContent);
assert(el.telDisk.textContent.includes("30.0%"), "Disk shows pct: " + el.telDisk.textContent);
assert(el.telDisk.textContent.includes("/"), "Disk shows mountpoint: " + el.telDisk.textContent);
assert(el.telDisk.textContent.includes("9.8 GB"), "Disk shows used capacity: " + el.telDisk.textContent);
assert(el.telDisk.textContent.includes("32.2 GB"), "Disk shows total capacity: " + el.telDisk.textContent);
assert(el.telGpu.textContent.includes("70.0°C"), "GPU shows temp: " + el.telGpu.textContent);
assert(el.telGpu.textContent.includes("25%"), "GPU shows util: " + el.telGpu.textContent);
assert(el.telBatt.textContent.includes("80%"), "Battery shows pct: " + el.telBatt.textContent);
assert(el.telBatt.textContent.includes("Discharging"), "Battery shows status: " + el.telBatt.textContent);
assert(el.telUpdated.textContent === "2 h 2 min",
  "the badge shows the uptime as its two largest units: " + el.telUpdated.textContent);

renderTelemetry({
  cpu: { load1: 1.0 },
  memory: null,
  disks: [],
  gpu: null,
  battery: { available: false },
  uptime_s: 0,
}, el, formatUptime, function () {});
assert(el.telCpu.textContent.includes("load"), "CPU without temp still shows load");
assert(el.telRam.textContent === "—", "RAM missing → em dash");
assert(el.telDisk.textContent === "—", "Disks empty → em dash");
assert(el.telGpu.textContent === "—", "GPU missing → em dash");
assert(el.telBatt.textContent === "—", "Battery unavailable → em dash");

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
}, el, formatUptime, function () {});
assert(el.telCpu.textContent.includes("50.0°C"), "compact CPU temp: " + el.telCpu.textContent);
assert(el.telRam.textContent.includes("40.0%"), "compact RAM pct");
assert(el.telDisk.textContent.includes("/"), "compact mountpoint");
assert(el.telGpu.textContent.includes("60.0°C"), "compact GPU temp");
assert(el.telGpu.textContent.includes("10%"), "compact GPU util");
assert(el.telBatt.textContent.includes("75%"), "compact batt");
assert(el.telBatt.textContent.includes("Charging"), "compact batt status");

// Multiple disks: every mountpoint is listed, each with adaptive units.
renderTelemetry({
  memory: { used_pct: 50.0, used_mb: 16000, total_mb: 32000 },
  disks: [
    { mountpoint: "/", used_pct: 40.0, used_mb: 200000, total_mb: 500000 },
    { mountpoint: "/data", used_pct: 12.0, used_mb: 120000, total_mb: 1000000 },
  ],
  cpu: null, gpu: null, battery: { available: false }, uptime_s: 0,
}, el, formatUptime, function () {});
assert(el.telDisk.textContent.includes("/"), "multi-disk: root shown");
assert(el.telDisk.textContent.includes("/data"), "multi-disk: data mount shown");
assert(el.telDisk.textContent.includes("195.3 GB"), "multi-disk: / used 200000 MB → 195.3 GB");
assert(el.telDisk.textContent.includes("976.6 GB"), "multi-disk: /data total 1000000 MB → 976.6 GB");

console.log("\n=== formatUptime Tests (two largest units) ===");
assert(formatUptime(null) === "—", "null → em dash");
assert(formatUptime(NaN) === "—", "NaN → em dash");
assert(formatUptime(-1) === "—", "negative → em dash");
assert(formatUptime(0) === "0 min", "zero → 0 min");
assert(formatUptime(45 * 60) === "45 min", "under an hour → minutes alone");
assert(formatUptime(7320) === "2 h 2 min", "two hours → " + formatUptime(7320));
assert(formatUptime(3600) === "1 h 0 min", "exactly one hour is not a bare 1h");
assert(formatUptime(86400 * 3 + 3600 * 17) === "3 d 17 h", "three days → " + formatUptime(86400 * 3 + 3600 * 17));
assert(formatUptime(86400 * 45) === "1 mês 2 sem", "45 days decomposes instead of reading 1080h: " + formatUptime(86400 * 45));
assert(formatUptime(86400 * 30) === "1 mês 0 sem", "exactly a month → " + formatUptime(86400 * 30));
// The whole point of the format: at most two units, and "mês" is the only one
// that inflects to two words, so the count is over unit tokens and not spaces.
assert(/^(?:\d+ (?:mês|meses|sem|d|h|min) )?\d+ (?:mês|meses|sem|d|h|min)$/.test(formatUptime(86400 * 400)),
  "never more than two units: " + formatUptime(86400 * 400));

console.log("\n=== historyX Tests (placement against the served window) ===");
// historyX closes over nothing, so the whole declaration can be rebuilt here.
const historyX = new Function('fromUnix', 'toUnix', 'count',
  extractDeclaration(appJs, 'historyX') + '\nreturn historyX(fromUnix, toUnix, count);');
const HOUR = 3600, DAY = 86400;
// A window's ends must land on its edges, or the axis lies about coverage.
{
  const toX = historyX(1000, 1000 + 7 * DAY, 240);
  assert(toX(1000) === 0, "window start sits at the left edge");
  assert(toX(1000 + 7 * DAY) === 100, "window end sits at the right edge");
  assert(Math.abs(toX(1000 + DAY) - 100 / 7) < 1e-9, "one day into 7d is one seventh across");
}
// The regression this exists for: 24h and 7d are both 240 points, so placing by
// array index drew them identically and the window button looked dead. The same
// instant now sits where the window says it should, not where its slot is.
{
  const start = 1000;
  const x24 = historyX(start, start + DAY, 240);
  const x7d = historyX(start, start + 7 * DAY, 240);
  const twelveHoursBeforeTheEnd = start + 12 * HOUR;
  assert(Math.abs(x24(twelveHoursBeforeTheEnd) - 50) < 1e-6,
    "12h before the end is halfway across a 24h window");
  assert(Math.abs(x7d(twelveHoursBeforeTheEnd) - ((12 * HOUR / (7 * DAY)) * 100)) < 1e-6,
    "the same instant is near the right edge of a 7d window");
  // A series evenly spread over its own window lands on the same points either
  // way — which is exactly why index-based x hid the change between them.
  const even = Array.from({ length: 240 }, (_, i) => start + (i / 239) * DAY);
  assert(new Set(even.map((ts, i) => x24(ts, i).toFixed(4))).size === 240,
    "an evenly-spread 24h series covers the width, so only the window tells them apart");
  // A gap keeps its real width: a 90-minute hole is 6.25% of a 24h window, which
  // index-based x drew as one slot (0.42%) and so rendered as an invisible notch.
  const gapStart = start + 12 * HOUR, gapEnd = gapStart + 90 * 60;
  const holeWidth = x24(gapEnd) - x24(gapStart);
  assert(Math.abs(holeWidth - 6.25) < 1e-6,
    "a 90-minute gap occupies its real share of the window: " + holeWidth.toFixed(2) + "%");
  assert(holeWidth > (100 / 239) * 4,
    "the outage is several times wider than the single slot index-based x gave it");
}
// A host that has not been up for the whole window occupies only its own share.
{
  const toX = historyX(1000, 1000 + 7 * DAY, 100);
  const upTwoDaysAgo = 1000 + 5 * DAY;
  assert(Math.abs(toX(upTwoDaysAgo) - (5 / 7) * 100) < 1e-9,
    "two days of a seven-day window start five sevenths across, not at the left edge");
}
// Before any answer has landed there is no window; fall back to placement by
// index rather than collapsing every sample onto one x.
{
  const toX = historyX(0, 0, 5);
  assert(toX(0, 0) === 0 && toX(0, 4) === 100, "zero span falls back to the full width");
}

console.log("\n=== historyAxisLabel / historySpanLabel Tests ===");
const historyAxisLabel = new Function('unixSec', 'spanSec', historyAxisLabelBody);
const historySpanLabel = new Function('sec', historySpanLabelBody);
{
  const noon = new Date(2026, 0, 15, 14, 30).getTime() / 1000;
  assert(/^\d{2}:\d{2}$/.test(historyAxisLabel(noon, HOUR)), "a 1h window labels by clock time");
  assert(/^\d{2}\/\d{2} \d{2}:\d{2}$/.test(historyAxisLabel(noon, DAY)),
    "a 24h window needs the day as well as the hour");
  assert(/^\d{2}\/\d{2}$/.test(historyAxisLabel(noon, 7 * DAY)),
    "a 7d window drops the hour, which repeats seven times over");
}
assert(historySpanLabel(45 * 60) === "45 min", "sub-hour span → minutes");
assert(historySpanLabel(3 * HOUR) === "3 h", "hour span → hours");
assert(historySpanLabel(2 * DAY) === "2 d", "multi-day span → days");

console.log("\n=== History series tests ===");

// The history panel's real metric table and its helpers, evaluated together in
// the `history` scope above — this file keeps no hand-written copy of the table.
const { historyValue, historyMetric, hostTempC, tempSourceLabel, HISTORY_METRICS,
  referenceFreqMHz, THROTTLE_FREQ_RATIO, THROTTLE_TEMP_C } = history;
const downsample = new Function('points', 'maxPoints', downsampleBody);
// Both free variables of the body (`lastSnapshot` and the key) are parameters
// of the generated function, so one call returns the answer.
const reasonFor = new Function('lastSnapshot', 'key',
  'const hostTempC = ' + extractDeclaration(appJs, 'hostTempC') + ';\n' +
  'const GPU_VENDOR_LABELS = ' + JSON.stringify(GPU_VENDOR_LABELS) + ';\n' +
  extractDeclaration(appJs, 'gpuVendorName') + '\n' +
  extractDeclaration(appJs, 'missingMetricReason') +
  '\nreturn missingMetricReason(key);');
const historyErrorLabel = new Function('status', historyErrorLabelBody);
const historyStaleDaemonLabel = new Function(historyStaleDaemonLabelBody);

assert(historyValue({ cpu: { load1: 0.8 }, num_cpu: 4 }, 'cpu') === 20,
  "cpu: carga normalizada pelos núcleos (0.8/4 = 20%)");
assert(historyValue({ cpu: { load1: 1 }, num_cpu: 0 }, 'cpu') === null,
  "cpu: sem num_cpu não há percentual inventado");
assert(historyValue({ memory: { used_pct: 50 } }, 'ram') === 50, "ram: percentual direto");
assert(historyValue({ gpu: { util_pct: 22, temp_c: 60 } }, 'gpu') === 22,
  "gpu: a categoria GPU mede utilização, não temperatura");
assert(historyValue({ disks: [{ used_pct: 40 }, { used_pct: 60 }] }, 'disk') === 60,
  "disco: o mountpoint mais cheio representa a série");

console.log("\n=== History metric table (categoria de temperatura) ===");
assert(HISTORY_METRICS.map((m) => m.key).join(",") === "cpu,ram,disk,gpu,temp",
  "a tabela cobre CPU, memória, disco, GPU e temperatura: " + HISTORY_METRICS.map((m) => m.key).join(","));
// "Carga" was removed for drawing the same line as "CPU" — its 1-minute curve
// read exactly what cpuPercent reads. Asserted as absence because a test that
// describes a removed element stays green if nobody updates it.
assert(!HISTORY_METRICS.some((m) => m.key === "load"),
  "a métrica de carga não volta: ela duplicava a série de CPU");
assert(!/data-metric="load"/.test(indexHtml),
  "o seletor não oferece mais a aba de carga");
assert(/data-metric="cpu"/.test(indexHtml),
  "a aba de CPU permanece no seletor");
const temp = historyMetric("temp");
assert(temp.unit === "°C", "temperatura carrega a unidade °C, veio " + temp.unit);
assert(typeof temp.warn === "number" && temp.warn > 0 && temp.warn <= 100,
  "a linha de alerta da temperatura é uma temperatura: " + temp.warn);
assert(HISTORY_METRICS.every((m) => Array.isArray(m.domain) && m.domain[1] > m.domain[0]),
  "toda métrica declara um domínio de eixo com folga");
assert(HISTORY_METRICS.filter((m) => m.unit === "%").every((m) => m.domain[0] === 0 && m.domain[1] === 100),
  "as métricas de capacidade continuam no domínio 0..100");
assert(/data-metric="temp"/.test(indexHtml), "o seletor de métrica tem o botão de temperatura");
assert((indexHtml.match(/class="seg[^"]*" data-metric="/g) || []).length === HISTORY_METRICS.length,
  "o seletor do markup tem exatamente um botão por métrica da tabela");

console.log("\n=== historyValue: categoria de temperatura ===");
assert(historyValue({ cpu: { temp_c: 58 } }, 'temp') === 58,
  "temp: usa a temperatura do sensor da CPU");
assert(historyValue({ gpu: { temp_c: 61 } }, 'temp') === 61,
  "temp: cai para a GPU quando o host não expõe sensor de CPU");
assert(historyValue({ cpu: {}, gpu: { util_pct: 5 } }, 'temp') === null,
  "temp: host sem sensor nenhum não vira série");
assert(historyValue(null, 'temp') === null, "temp: snapshot ausente é null");
assert(historyMetric("inexistente").key === "cpu", "métrica desconhecida cai na primeira da tabela");
assert(tempSourceLabel({ cpu: { temp_c: 58 } }) === "temperatura da CPU",
  "a unidade nomeia a fonte: " + tempSourceLabel({ cpu: { temp_c: 58 } }));
assert(tempSourceLabel({ gpu: { temp_c: 61 } }) === "temperatura da GPU",
  "a unidade acompanha a fonte real: " + tempSourceLabel({ gpu: { temp_c: 61 } }));
assert(tempSourceLabel({}) === "temperatura", "sem fonte, a unidade não inventa uma");
assert(hostTempC({ cpu: { temp_c: 0 } }) === 0, "0 °C é leitura, não ausência");

const dense = Array.from({ length: 60480 }, (_, i) => [i, i % 100]);
assert(downsample(dense, 240).length === 240,
  "60k amostras reduzem ao que o desenho comporta");
assert(downsample([[1, 5], [2, 6]], 240).length === 2,
  "abaixo do cap a série sai intacta");

// missingMetricReason tells a host that never reports the metric apart from a
// window that happens to be empty — the difference between "GPU não existe
// aqui" and "o gráfico quebrou". The GPU case has three distinct answers now
// that the daemon looks at whatever card the host has: no card at all, a card
// that reports nothing, and a card with no utilization but a temperature.
assert(reasonFor({ cpu: { load1: 1 }, num_cpu: 4 }, 'cpu') === "",
  "cpu presente: nenhuma desculpa inventada");
assert(/não tem placa de GPU/.test(reasonFor({}, 'gpu')),
  "host sem card de GPU diz que não há placa: " + reasonFor({}, 'gpu'));
assert(!/nvidia/i.test(reasonFor({}, 'gpu')),
  "a mensagem não pode culpar a NVIDIA por uma GPU que o host não tem");
assert(/drm/.test(reasonFor({}, 'gpu')),
  "a ausência aponta para onde a coleta olha: " + reasonFor({}, 'gpu'));
assert(/AMD/.test(reasonFor({ gpu: { vendor: "amd" } }, 'gpu')),
  "card que não reporta nada é nomeada, não declarada ausente: " + reasonFor({ gpu: { vendor: "amd" } }, 'gpu'));
assert(/sem leitura|não expõe/.test(reasonFor({ gpu: { vendor: "intel" } }, 'gpu')),
  "GPU sem leituras explica o motivo: " + reasonFor({ gpu: { vendor: "intel" } }, 'gpu'));
assert(/temperatura/.test(reasonFor({ cpu: {}, gpu: {} }, 'temp')),
  "host sem sensor de temperatura explica o motivo: " + reasonFor({ cpu: {}, gpu: {} }, 'temp'));
assert(reasonFor({ cpu: { temp_c: 58 } }, 'temp') === "",
  "host com sensor não é julgado ausente");
assert(/aba Temp/.test(reasonFor({ gpu: { temp_c: 60 } }, 'gpu')),
  "GPU só com temperatura aponta para a aba que a mostra");
assert(reasonFor({ gpu: { util_pct: 5 } }, 'gpu') === "",
  "GPU com utilização não é tratada como ausente");
assert(reasonFor({ gpu: { vendor: "intel", util_pct: 5 } }, 'gpu') === "",
  "GPU Intel com utilização não é tratada como ausente");
assert(reasonFor(null, 'gpu') === "", "sem snapshot ainda: nada a concluir");

console.log("\n=== Rótulos de vendor da GPU ===");
assert(gpuVendorName("amd") === "AMD", "código amd → AMD");
assert(gpuVendorName("intel") === "Intel", "código intel → Intel");
assert(gpuVendorName("nvidia") === "NVIDIA", "código nvidia → NVIDIA");
assert(gpuVendorName("qualquer-coisa") === "GPU",
  "vendor desconhecido não vira um nome inventado");
assert(gpuVendorName("") === "", "daemon antigo sem vendor não ganha um nome");
assert(gpuMeterLabel({ vendor: "intel" }) === "GPU · Intel",
  "o medidor nomeia a placa: " + gpuMeterLabel({ vendor: "intel" }));
assert(gpuMeterLabel({}) === "GPU",
  "sem vendor o medidor continua dizendo GPU, não um palpite");
assert(gpuSourceLabel({ gpu: { vendor: "nvidia", util_pct: 10 } }) === "utilização da NVIDIA",
  "a unidade da série nomeia a placa: " + gpuSourceLabel({ gpu: { vendor: "nvidia" } }));
assert(gpuSourceLabel({ gpu: { util_pct: 10 } }) === "utilização da GPU",
  "série sem vendor continua genérica");
assert(gpuSourceLabel(null) === "utilização da GPU", "sem snapshot: unidade genérica");

console.log("\n=== historyErrorLabel ===");
assert(/limite/.test(historyErrorLabel(429)), "429 → limite de requisições");
assert(/indisponível/.test(historyErrorLabel(501)), "501 → histórico indisponível");
assert(/sessão/.test(historyErrorLabel(401)), "401 → sessão expirada");
assert(/HTTP 500/.test(historyErrorLabel(500)), "outro status → HTTP explícito");

console.log("\n=== fetchHistory: request shape and refresh gates ===");

async function makeHistoryFetch(respond) {
  const state = {
    windowSec: 604800, metric: "cpu", samples: null, inFlight: false,
    lastAttempt: 0, lastSuccess: 0, error: null,
  };
  const calls = [];
  // The body is async and new Function bodies are not, so the whole
  // declaration goes inside an async IIFE that hands the function back.
  const fetchHistory = await new Function('deps', `
    const { historyState, TELEMETRY_PATH, HISTORY_MAX_POINTS, HISTORY_RETRY_MS,
            HISTORY_REFRESH_MS, renderHistory, historyErrorLabel,
            historyStaleDaemonLabel, telemetryGet } = deps;
    return (async () => {
      ${extractDeclaration(appJs, 'fetchHistory')}
      return fetchHistory;
    })();
  `)({
    historyState: state,
    TELEMETRY_PATH: "/api/host/telemetry",
    HISTORY_MAX_POINTS: 240,
    HISTORY_RETRY_MS: 30000,
    HISTORY_REFRESH_MS: 300000,
    renderHistory: () => {},
    historyErrorLabel,
    historyStaleDaemonLabel,
    telemetryGet: (url) => { calls.push(url); return respond(url, calls); },
  });
  return { state, calls, fetchHistory };
}

const SAMPLE = { sampled_at: "2026-10-03T00:00:00Z", cpu: { load1: 1 }, num_cpu: 4, memory: { used_pct: 50 } };
const respondOk = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([SAMPLE]) });

// The default window is 7 days, which at the 10s collection cadence holds ~60k
// samples. Asking for all of them is what made the chart unusable: 25 MB per
// load and ~200 ms of main-thread parse, for pixels the chart never draws.
{
  const h = await makeHistoryFetch(respondOk);
  await h.fetchHistory();
  assert(h.calls.length === 1, "primeira carga: um request");
  const url = h.calls[0];
  assert(url.startsWith("/api/host/telemetry?from="), "usa ?from=: " + url);
  assert(url.includes("&to="), "usa ?to=: " + url);
  assert(url.includes("&points=240"), "pede só os pontos que desenha: " + url);
  assert(h.state.samples.length === 1, "guarda a série");
  assert(h.state.error === null, "carga bem-sucedida não deixa erro");
  assert(h.state.lastSuccess > 0, "marca a série como carregada");

  await h.fetchHistory();
  assert(h.calls.length === 1, "série fresca não recarrega a cada tick do poll");
}

// A failed load used to re-fire on every 2s tick, forever.
{
  const h = await makeHistoryFetch(() => Promise.resolve({ ok: false, status: 429 }));
  await h.fetchHistory();
  assert(/limite/.test(h.state.error), "erro do daemon vira status legível: " + h.state.error);
  assert(h.state.samples === null, "sem resposta, nenhum dado é inventado");
  for (let i = 0; i < 20; i++) await h.fetchHistory();
  assert(h.calls.length === 1,
    "20 ticks do poll de 2s não viram 20 requests de janela inteira");
  await h.fetchHistory(true);
  assert(h.calls.length === 2, "trocar de janela força a carga mesmo após falha");
}

// A daemon built before the range query ignores ?from= and answers with the
// single-snapshot object. That is a deployment fact, and the panel has to name
// it — otherwise the operator debugs the frontend for a daemon that can never
// answer the question.
{
  assert(/anterior ao histórico/.test(historyStaleDaemonLabel()),
    "a mensagem de daemon desatualizado diz o que fazer: " + historyStaleDaemonLabel());
  const h = await makeHistoryFetch(() => Promise.resolve({
    ok: true, status: 200, json: () => Promise.resolve({ cpu: { load1: 1 }, num_cpu: 4 }),
  }));
  await h.fetchHistory();
  assert(/anterior ao histórico/.test(h.state.error),
    "resposta objeto (daemon antigo) é reconhecida, não vira série: " + h.state.error);
  assert(h.state.samples === null, "nenhum dado é extraído de um objeto");
}

// A transient failure must not wipe a chart the user is reading.
{
  let n = 0;
  const h = await makeHistoryFetch(() => {
    n++;
    return n === 1 ? respondOk() : Promise.resolve({ ok: false, status: 500 });
  });
  await h.fetchHistory();
  const drawn = h.state.samples.length;
  await h.fetchHistory(true);
  assert(h.state.samples.length === drawn, "uma falha não apaga a série já carregada");
  assert(h.state.error !== null, "a falha fica registrada para a linha de status");
}

// The chart follows the live edge instead of freezing at page load.
{
  const h = await makeHistoryFetch(respondOk);
  await h.fetchHistory();
  // Both clocks have to age: the retry cooldown gates every attempt, and the
  // refresh cadence gates the ones that already succeeded.
  h.state.lastSuccess -= 299999;
  h.state.lastAttempt -= 299999;
  await h.fetchHistory();
  assert(h.calls.length === 1, "dentro de HISTORY_REFRESH_MS não recarrega");
  h.state.lastSuccess -= 2;
  h.state.lastAttempt -= 2;
  await h.fetchHistory();
  assert(h.calls.length === 2, "série envelhecida é recarregada pelo poll");
}

assert(/fetchHistory\(true\)/.test(appJs),
  "trocar a janela força a recarga mesmo com série já carregada");

/* ── Window switching while a request is open ──────────────────────────
 *
 * Every case above awaits each call before the next, so `inFlight` is never
 * true when a second one arrives — which is the one situation a window click
 * always lands in, since the live poll has a request open most of the time.
 * Dropping a forced call there is what left 1h/24h/7d repainting as selected
 * while the previous window stayed on screen, so these keep a response
 * pending on purpose and collide with it for real.
 */
console.log("\n=== Janela: troca com um request em voo ===");

/** `to - from` of a range URL, in seconds. Returns null for anything that is
 *  not a range URL, so a missing request reports a failed assertion instead of
 *  crashing the suite and hiding every case after it. */
function spanOf(url) {
  if (typeof url !== "string") return null;
  return Number(url.match(/&to=(\d+)/)[1]) - Number(url.match(/from=(\d+)/)[1]);
}
/** The `from=` of a range URL, tagged into the sample so the test can tell
 *  which window the series on screen actually came from. */
function fromOf(url) {
  if (typeof url !== "string") return null;
  return url.match(/from=(\d+)/)[1];
}

async function makeDeferredHistoryFetch(respond) {
  const state = {
    windowSec: 604800, metric: "cpu", samples: null, inFlight: false,
    pendingReload: false, lastAttempt: 0, lastSuccess: 0, error: null,
  };
  const calls = [];
  const pending = [];
  const fetchHistory = await new Function('deps', `
    const { historyState, TELEMETRY_PATH, HISTORY_MAX_POINTS, HISTORY_RETRY_MS,
            HISTORY_REFRESH_MS, renderHistory, historyErrorLabel,
            historyStaleDaemonLabel, telemetryGet } = deps;
    return (async () => {
      ${extractDeclaration(appJs, 'fetchHistory')}
      return fetchHistory;
    })();
  `)({
    historyState: state,
    TELEMETRY_PATH: "/api/host/telemetry",
    HISTORY_MAX_POINTS: 240,
    HISTORY_RETRY_MS: 30000,
    HISTORY_REFRESH_MS: 300000,
    renderHistory: () => {},
    historyErrorLabel,
    historyStaleDaemonLabel,
    // Each request parks until the test releases it, so a second call really
    // does arrive while the first is still open.
    telemetryGet: (url) => {
      calls.push(url);
      return new Promise((resolve) => {
        pending.push(() => resolve(respond ? respond(url) : {
          ok: true, status: 200,
          json: () => Promise.resolve([{ ...SAMPLE, _from: fromOf(url) }]),
        }));
      });
    },
  });
  // The queued reload is issued from the previous call's `finally`, so one
  // macrotask is enough for it to reach telemetryGet.
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { state, calls, pending, fetchHistory, flush };
}

// The button click that could not open its own request.
{
  const h = await makeDeferredHistoryFetch();
  h.fetchHistory(true);
  await h.flush();
  assert(h.state.inFlight, "o primeiro request fica em voo até o teste liberar");

  h.state.windowSec = 3600; // clique em 1h
  await h.fetchHistory(true);
  assert(h.state.pendingReload,
    "a troca de janela é lembrada em vez de descartada");

  h.pending[0](); // a resposta de 7d chega
  await h.flush();
  assert(h.calls.length === 2,
    "a troca dispara um request assim que o anterior termina (got " + h.calls.length + ")");
  assert(spanOf(h.calls[1]) === 3600,
    "o novo request cobre a janela de 1h: " + h.calls[1]);

  h.pending[1]();
  await h.flush();
  assert(h.state.samples && h.state.samples[0]._from === fromOf(h.calls[1]),
    "os dados em tela são os da janela selecionada");
}

// A response for a window the user already left.
{
  const h = await makeDeferredHistoryFetch();
  h.fetchHistory(true);
  await h.flush();

  h.state.windowSec = 3600; // clique em 1h
  await h.fetchHistory(true);
  h.pending[0](); // a resposta de 7d chega tarde
  await h.flush();
  assert(h.state.samples === null,
    "uma resposta de 7d não preenche a série quando a janela já é 1h");
  assert(h.state.windowSec === 3600, "a janela selecionada continua sendo 1h");
  assert(h.state.lastSuccess === 0,
    "a resposta obsoleta não marca a série como fresca: o poll segue livre para recarregar");
}

// A failure for a window the user already left is not this window's failure.
{
  const h = await makeDeferredHistoryFetch(() => ({ ok: false, status: 500 }));
  h.fetchHistory(true);
  await h.flush();
  h.state.windowSec = 3600;
  await h.fetchHistory(true);
  h.pending[0]();
  await h.flush();
  assert(h.state.error === null,
    "a falha de uma janela abandonada não aparece na linha de status da atual");
}

// The availability strip runs the same rule on its own route.
console.log("\n=== Disponibilidade: janela com um request em voo ===");

async function makeDeferredHostHistoryFetch() {
  const state = {
    windowSec: 86400, data: null, inFlight: false,
    pendingReload: false, lastAttempt: 0, lastSuccess: 0, error: null,
  };
  const calls = [];
  const pending = [];
  const fetchHostHistory = await new Function('deps', `
    const { hostHistoryState, HOST_HISTORY_PATH, AVAILABILITY_SLOTS, HISTORY_RETRY_MS,
            HOST_HISTORY_REFRESH_MS, renderAvailability, renderTunnelTimeline,
            hostHistoryErrorLabel, hostHistoryStaleDaemonLabel, telemetryGet } = deps;
    return (async () => {
      ${extractDeclaration(appJs, 'fetchHostHistory')}
      return fetchHostHistory;
    })();
  `)({
    hostHistoryState: state,
    HOST_HISTORY_PATH: "/api/host/history",
    AVAILABILITY_SLOTS: 60,
    HISTORY_RETRY_MS: 30000,
    HOST_HISTORY_REFRESH_MS: 120000,
    renderAvailability: () => {},
    renderTunnelTimeline: () => {},
    hostHistoryErrorLabel: (s) => "HTTP " + s,
    hostHistoryStaleDaemonLabel: () => "daemon antigo",
    telemetryGet: (url) => {
      calls.push(url);
      return new Promise((resolve) => {
        pending.push(() => resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            services: { frigate: [{ ts: fromOf(url), status: "up" }] },
            tunnel: [],
            from: Number(fromOf(url)),
            to: Number(url.match(/&to=(\d+)/)[1]),
          }),
        }));
      });
    },
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { state, calls, pending, fetchHostHistory, flush };
}

{
  const h = await makeDeferredHostHistoryFetch();
  h.fetchHostHistory(true);
  await h.flush();
  h.state.windowSec = 604800; // clique em 7d
  await h.fetchHostHistory(true);
  assert(h.state.pendingReload,
    "a troca de janela da disponibilidade também é lembrada");

  h.pending[0]();
  await h.flush();
  assert(h.calls.length === 2,
    "a troca dispara um request de /api/host/history (got " + h.calls.length + ")");
  assert(spanOf(h.calls[1]) === 604800,
    "o novo request cobre 7d: " + h.calls[1]);

  h.pending[1]();
  await h.flush();
  assert(h.state.data && h.state.data.to - h.state.data.from === 604800,
    "a faixa desenhada é a da janela selecionada");
}

assert(/pendingReload/.test(appJs),
  "os dois carregadores de janela têm uma recarga pendente");

console.log("\n=== Curvas secundárias (infraestrutura multi-série) ===");
// No metric declares `series` today: "Carga", the only one that did, drew the
// same line as "CPU". The renderer, the polylines and the legend stay because
// they key off `metric.series` — so these assert the machinery survives and
// stays correct for the next multi-curve metric, not that it is in use now.
assert(HISTORY_METRICS.every((m) => !m.series),
  "nenhuma métrica declara séries extras: o renderizador está ocioso, não quebrado");
assert(/histLine2/.test(appJs) && /histLine3/.test(appJs) && /drawSecondarySeries/.test(appJs),
  "as curvas secundárias têm polilinhas próprias e uma função que as desenha");
assert(/class="series-line series-line--soft" id="hist-line-2"/.test(indexHtml) &&
  /class="series-line series-line--soft" id="hist-line-3"/.test(indexHtml),
  "as polilinhas secundárias são marcadas como soft no markup");
assert(/\.series-line--soft\s*\{[^}]*stroke:\s*var\(--color-chart-\d\)/s.test(readFileSync(join(here, '..', 'style.css'), 'utf8')),
  "a curva soft usa um token de cor, não uma cor fixa");
// Switching metrics must clear them, or a disk chart would keep two curves
// drawn on an axis they have nothing to do with.
assert(/for \(const node of secondary\)[\s\S]*?setAttribute\("points", ""\)/.test(appJs),
  "as curvas secundárias são limpas a cada render, não só quando redesenhadas");
assert(/function renderHistoryLegend\(metric\)/.test(appJs) &&
  /series\.length < 2/.test(appJs),
  "a legenda aparece só para métrica com mais de uma curva");
assert(/id="hist-legend"/.test(indexHtml) && /id="hist-line-2"/.test(indexHtml),
  "a legenda e as linhas extras continuam no markup");

console.log("\n=== Detecção de throttling térmico ===");
assert(/function referenceFreqMHz\(samples\)/.test(appJs),
  "a referência de frequência vem do pico da janela carregada");
assert(referenceFreqMHz([{ cpu: { freq_mhz: 2000 } }, { cpu: { freq_mhz: 3400 } }]) === 3400,
  "a referência é a maior frequência da janela");
assert(referenceFreqMHz([{ cpu_freq_mhz: 800 }]) === 800,
  "o snapshot achatado (cpu_freq_mhz) também é lido");
assert(referenceFreqMHz([]) === null && referenceFreqMHz(null) === null,
  "sem amostras não há referência — e sem referência não há veredito");
assert(THROTTLE_FREQ_RATIO > 0 && THROTTLE_FREQ_RATIO < 1,
  "a folga de frequência é uma fração, não um número solto: " + THROTTLE_FREQ_RATIO);
assert(THROTTLE_TEMP_C > 0 && THROTTLE_TEMP_C < 100,
  "o gatilho de temperatura é uma temperatura: " + THROTTLE_TEMP_C);

const throttleBody = extractFunction(appJs, 'renderThrottleNote');
const throttle = new Function('cpu', 'el', 'historyState', 'referenceFreqMHz',
  'THROTTLE_FREQ_RATIO', 'THROTTLE_TEMP_C', throttleBody);
const mkNote = () => {
  const node = { classList: { add: (c) => { node.className = c; }, remove: (c) => { node.className = ''; } }, textContent: '' };
  return node;
};
const hotIdle = { className: '' };
// A low clock with a cool package is an idle CPU, not throttling — the
// failure mode that would make the warning worthless.
{
  const note = mkNote();
  throttle({ freq_mhz: 800, temp_c: 35 }, { telThrottle: note }, { samples: [{ cpu: { freq_mhz: 3400 } }] },
    referenceFreqMHz, THROTTLE_FREQ_RATIO, THROTTLE_TEMP_C);
  assert(note.className === 'hidden' && note.textContent === '',
    'frequência baixa com CPU fria é ociosidade, não throttling');
}
{
  const note = mkNote();
  throttle({ freq_mhz: 3400, temp_c: 82 }, { telThrottle: note }, { samples: [{ cpu: { freq_mhz: 3400 } }] },
    referenceFreqMHz, THROTTLE_FREQ_RATIO, THROTTLE_TEMP_C);
  assert(note.className === 'hidden',
    'frequência no pico com CPU quente não é throttling');
}
{
  const note = mkNote();
  throttle({ freq_mhz: 2200, temp_c: 85 }, { telThrottle: note }, { samples: [{ cpu: { freq_mhz: 3400 } }] },
    referenceFreqMHz, THROTTLE_FREQ_RATIO, THROTTLE_TEMP_C);
  assert(note.className !== 'hidden' && /throttling/.test(note.textContent),
    'frequência bem abaixo do pico com CPU quente é reportada: ' + note.textContent);
  assert(/possível/i.test(note.textContent),
    'o texto hedge: o dado é heurístico e não identifica a causa');
}
{
  const note = mkNote();
  throttle({ freq_mhz: 2200, temp_c: 85 }, { telThrottle: note }, { samples: [] },
    referenceFreqMHz, THROTTLE_FREQ_RATIO, THROTTLE_TEMP_C);
  assert(note.className === 'hidden',
    'sem referência na janela não se afirma throttling');
}
{
  const note = mkNote();
  throttle({ freq_mhz: 2200 }, { telThrottle: note }, { samples: [{ cpu: { freq_mhz: 3400 } }] },
    referenceFreqMHz, THROTTLE_FREQ_RATIO, THROTTLE_TEMP_C);
  assert(note.className === 'hidden',
    'sem sensor de temperatura não se afirma throttling');
}
void hotIdle;

console.log("\n=== Results: " + passed + " passed, " + failed + " failed ===");
if (failed > 0) process.exit(1);
