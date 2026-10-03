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

const formatUptimeBody = extractFunction(appJs, 'formatUptime');
const formatCapacityBody = extractFunction(appJs, 'formatCapacity');
const renderTelemetryBody = extractFunction(appJs, 'renderTelemetry');
const historyValueBody = extractFunction(appJs, 'historyValue');
const downsampleBody = extractFunction(appJs, 'downsample');
const historyErrorLabelBody = extractFunction(appJs, 'historyErrorLabel');
const missingMetricReasonBody = extractFunction(appJs, 'missingMetricReason');
const fetchHistoryBody = extractFunction(appJs, 'fetchHistory');

console.log("\n=== Telemetry Polling Tests ===");
assert(/const TELEMETRY_POLL_MS = 2000;/.test(appJs), "host health refreshes every 2 seconds");
assert((appJs.match(/setInterval\(fetchTelemetry, TELEMETRY_POLL_MS\)/g) || []).length === 2,
  "initial and visibility-resume polling use the shared interval");
assert(/if \(telemetryFetchInFlight\) return;/.test(appJs), "slow telemetry requests do not overlap");

// renderTelemetry calls formatUptime internally. Since function declarations
// inside a new Function body don't get hoisted to the wrapped scope, we
// inline the formatUptime body as a const at the top.
const formatUptime = new Function('total', formatUptimeBody);
const formatCapacity = new Function('mb', formatCapacityBody);
const renderTelemetry = new Function(
  'snap', 'el',
  'const formatUptime = ' + formatUptime + ';\n' +
  'const formatCapacity = ' + formatCapacity + ';\n' +
  renderTelemetryBody
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

// Multiple disks: every mountpoint is listed, each with adaptive units.
renderTelemetry({
  memory: { used_pct: 50.0, used_mb: 16000, total_mb: 32000 },
  disks: [
    { mountpoint: "/", used_pct: 40.0, used_mb: 200000, total_mb: 500000 },
    { mountpoint: "/data", used_pct: 12.0, used_mb: 120000, total_mb: 1000000 },
  ],
  cpu: null, gpu: null, battery: { available: false }, uptime_s: 0,
}, el);
assert(el.telDisk.textContent.includes("/"), "multi-disk: root shown");
assert(el.telDisk.textContent.includes("/data"), "multi-disk: data mount shown");
assert(el.telDisk.textContent.includes("195.3 GB"), "multi-disk: / used 200000 MB → 195.3 GB");
assert(el.telDisk.textContent.includes("976.6 GB"), "multi-disk: /data total 1000000 MB → 976.6 GB");

console.log("\n=== History series tests ===");

// Each of these bodies ends in a `return`, so the value built by new Function
// answers with exactly what the production function returns. cpuPercent is
// prepended as a declaration (not a parameter, which would shadow nothing and
// collide with nothing) because historyValue calls it.
const historyValue = new Function('snap', 'metric',
  'const cpuPercent = ' + extractDeclaration(appJs, 'cpuPercent') + ';\n' + historyValueBody);
const downsample = new Function('points', 'maxPoints', downsampleBody);
const missingMetricReason = new Function('lastSnapshot', 'key', missingMetricReasonBody);
const historyErrorLabel = new Function('status', historyErrorLabelBody);

assert(historyValue({ cpu: { load1: 0.8 }, num_cpu: 4 }, 'cpu') === 20,
  "cpu: carga normalizada pelos núcleos (0.8/4 = 20%)");
assert(historyValue({ cpu: { load1: 1 }, num_cpu: 0 }, 'cpu') === null,
  "cpu: sem num_cpu não há percentual inventado");
assert(historyValue({ memory: { used_pct: 50 } }, 'ram') === 50, "ram: percentual direto");
assert(historyValue({ gpu: { util_pct: 22, temp_c: 60 } }, 'gpu') === 22, "gpu: utilização");
assert(historyValue({ gpu: { temp_c: 60 } }, 'gpu') === null,
  "gpu: só temperatura não vira série em um eixo de 0..100%");
assert(historyValue({ disks: [{ used_pct: 40 }, { used_pct: 60 }] }, 'disk') === 60,
  "disco: o mountpoint mais cheio representa a série");

const dense = Array.from({ length: 60480 }, (_, i) => [i, i % 100]);
assert(downsample(dense, 240).length === 240,
  "60k amostras reduzem ao que o desenho comporta");
assert(downsample([[1, 5], [2, 6]], 240).length === 2,
  "abaixo do cap a série sai intacta");

// missingMetricReason tells a host that never reports the metric apart from a
// window that happens to be empty — the difference between "GPU não existe
// aqui" and "o gráfico quebrou".
const reasonFor = (snap, key) => missingMetricReason(snap, key);
assert(reasonFor({ cpu: { load1: 1 }, num_cpu: 4 }, 'cpu') === "",
  "cpu presente: nenhuma desculpa inventada");
assert(/nvidia-smi/.test(reasonFor({}, 'gpu')),
  "host sem GPU explica que a coleta usa nvidia-smi");
assert(/utilização/.test(reasonFor({ gpu: { temp_c: 60 } }, 'gpu')),
  "GPU só com temperatura explica por que não há série");
assert(reasonFor({ gpu: { util_pct: 5 } }, 'gpu') === "",
  "GPU com utilização não é tratada como ausente");
assert(reasonFor(null, 'gpu') === "", "sem snapshot ainda: nada a concluir");

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
            HISTORY_REFRESH_MS, renderHistory, historyErrorLabel, telemetryGet } = deps;
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

console.log("\n=== Results: " + passed + " passed, " + failed + " failed ===");
if (failed > 0) process.exit(1);
