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

const formatUptimeBody = extractFunction(appJs, 'formatUptime');
const formatCapacityBody = extractFunction(appJs, 'formatCapacity');
const renderTelemetryBody = extractFunction(appJs, 'renderTelemetry');
const downsampleBody = extractFunction(appJs, 'downsample');
const historyErrorLabelBody = extractFunction(appJs, 'historyErrorLabel');
const historyStaleDaemonLabelBody = extractFunction(appJs, 'historyStaleDaemonLabel');
const fetchHistoryBody = extractFunction(appJs, 'fetchHistory');
const indexHtml = readFileSync(join(here, '..', 'index.html'), 'utf8');

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
  ${extractDeclaration(appJs, 'loadPerCore')}
  ${extractDeclaration(appJs, 'referenceFreqMHz')}
  ${extractDeclaration(appJs, 'hostTempC')}
  ${extractDeclaration(appJs, 'tempSourceLabel')}
  ${extractDeclaration(appJs, 'historyMetric')}
  ${extractDeclaration(appJs, 'historyValue')}
  return {
    historyValue, historyMetric, hostTempC, tempSourceLabel,
    HISTORY_METRICS, loadPerCore, referenceFreqMHz,
    THROTTLE_FREQ_RATIO, THROTTLE_TEMP_C,
  };
`)();

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
assert(formatUptime(0) === "0 min", "0s → 0 min");
assert(formatUptime(60) === "1 min", "60s → 1 min");
assert(formatUptime(1234) === "20 min", "1234s → 20 min (a hora é a próxima unidade)");
assert(formatUptime(3600) === "1 h 0 min", "3600s → 1 h 0 min");
assert(formatUptime(3661) === "1 h 1 min", "3661s → 1 h 1 min");
// The whole point of the parse: hours alone made 45 days read as "1080h".
assert(formatUptime(86400) === "1 d 0 h", "1d → 1 d 0 h, não 24 h");
assert(formatUptime(90061) === "1 d 1 h", "90061s → 1 d 1 h, não 25 h");
assert(formatUptime(604800) === "1 sem 0 d", "1 semana exata → 1 sem 0 d");
assert(formatUptime(691200) === "1 sem 1 d", "8 dias → 1 sem 1 d");
assert(formatUptime(3888000) === "1 mês 2 sem", "45 dias → 1 mês 2 sem");
assert(formatUptime(7776000) === "3 meses 0 sem", "90 dias → 3 meses 0 sem (plural)");
assert(formatUptime(2592000) === "1 mês 0 sem", "30 dias → 1 mês 0 sem");
assert(formatUptime(30 * 24 * 3600 + 86400 * 3 + 3600 * 17) === "1 mês 0 sem",
  "1 mês 3 d 17 h colapsa nas duas maiores unidades, com a segunda zerada: " +
  formatUptime(30 * 24 * 3600 + 86400 * 3 + 3600 * 17));
assert(formatUptime(7320.7) === "2 h 2 min", "segundos fracionários não viram meia hora");
assert(formatUptime(null) === "—", "null → em dash");
assert(formatUptime(undefined) === "—", "undefined → em dash");
assert(formatUptime(NaN) === "—", "NaN → em dash");
assert(formatUptime(-60) === "—", "negativo → em dash");

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
assert(el.telUptime.textContent === "2 h 2 min", "Uptime formatted: " + el.telUptime.textContent);

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
assert(el.telUptime.textContent === "0 min", "Uptime 0 → 0 min");

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
assert(el.telUptime.textContent === "20 min", "compact uptime");

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

// The history panel's real metric table and its helpers, evaluated together in
// the `history` scope above — this file keeps no hand-written copy of the table.
const { historyValue, historyMetric, hostTempC, tempSourceLabel, HISTORY_METRICS,
  loadPerCore, referenceFreqMHz, THROTTLE_FREQ_RATIO, THROTTLE_TEMP_C } = history;
const downsample = new Function('points', 'maxPoints', downsampleBody);
// Both free variables of the body (`lastSnapshot` and the key) are parameters
// of the generated function, so one call returns the answer.
const reasonFor = new Function('lastSnapshot', 'key',
  'const hostTempC = ' + extractDeclaration(appJs, 'hostTempC') + ';\n' +
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
assert(HISTORY_METRICS.map((m) => m.key).join(",") === "cpu,load,ram,disk,gpu,temp",
  "a tabela cobre CPU, carga, memória, disco, GPU e temperatura: " + HISTORY_METRICS.map((m) => m.key).join(","));
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
// aqui" and "o gráfico quebrou".
assert(reasonFor({ cpu: { load1: 1 }, num_cpu: 4 }, 'cpu') === "",
  "cpu presente: nenhuma desculpa inventada");
assert(/nvidia-smi/.test(reasonFor({}, 'gpu')),
  "host sem GPU explica que a coleta usa nvidia-smi");
assert(/temperatura/.test(reasonFor({ cpu: {}, gpu: {} }, 'temp')),
  "host sem sensor de temperatura explica o motivo: " + reasonFor({ cpu: {}, gpu: {} }, 'temp'));
assert(reasonFor({ cpu: { temp_c: 58 } }, 'temp') === "",
  "host com sensor não é julgado ausente");
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

console.log("\n=== Carga por núcleo (métrica multi-série) ===");
const loadMetric = historyMetric('load');
assert(!!loadMetric, "a métrica de carga existe");
assert(loadMetric.unit === '%' && loadMetric.domain[0] === 0 && loadMetric.domain[1] === 100,
  "carga é uma porcentagem com domínio 0..100");
assert(Array.isArray(loadMetric.series) && loadMetric.series.length === 3,
  "carga desenha três curvas (1, 5 e 15 min)");
assert(loadMetric.series.map((s) => s.label).join(',') === '1 min,5 min,15 min',
  "as curvas da carga são as médias suavizadas do kernel: " + loadMetric.series.map((s) => s.label).join(','));
// value must stay the 1-minute curve so the stats row and the meter keep
// reading one well-defined number.
assert(loadMetric.value({ num_cpu: 4, cpu: { load1: 2, load5: 1, load15: 0.5 } }) === 50,
  "value da carga é a curva de 1 min");

const four = { num_cpu: 4, cpu: { load1: 2, load5: 1, load15: 0.5 } };
assert(loadPerCore(four, 1) === 50, "load1 normalizado: 2/4 = 50%");
assert(loadPerCore(four, 5) === 25, "load5 normalizado: 1/4 = 25%");
assert(loadPerCore(four, 15) === 12.5, "load15 normalizado: 0.5/4 = 12,5%");
assert(loadPerCore({ cpu: { load1: 2 } }, 1) === null,
  "sem contagem de núcleos não há denominador: a carga não vira porcentagem");
assert(loadPerCore({ num_cpu: 4, cpu: { load1: 2 } }, 15) === null,
  "uma janela ausente é ausente, não zero");
assert(loadPerCore({ num_cpu: 4, cpu_load1: 3 }, 1) === 75,
  "o snapshot achatado (cpu_load1) também é lido");
assert(loadPerCore(null, 1) === null, "snapshot ausente não quebra a extração");

assert(/histLine2/.test(appJs) && /histLine3/.test(appJs) && /drawSecondarySeries/.test(appJs),
  "as curvas secundárias têm polilinhas próprias e uma função que as desenha");
assert(/class="series-line series-line--soft" id="hist-line-2"/.test(indexHtml) &&
  /class="series-line series-line--soft" id="hist-line-3"/.test(indexHtml),
  "as polilinhas secundárias são marcadas como soft no markup");
assert(/\.series-line--soft\s*\{[^}]*stroke:\s*var\(--color-chart-\d\)/s.test(readFileSync(join(here, '..', 'style.css'), 'utf8')),
  "a curva soft usa um token de cor, não uma cor fixa");
// Switching metrics must clear them, or a disk chart would keep two load
// curves drawn on an axis they have nothing to do with.
assert(/for \(const node of secondary\)[\s\S]*?setAttribute\("points", ""\)/.test(appJs),
  "as curvas secundárias são limpas a cada render, não só quando redesenhadas");
assert(/function renderHistoryLegend\(metric\)/.test(appJs) &&
  /series\.length < 2/.test(appJs),
  "a legenda aparece só para métrica com mais de uma curva");
assert(/id="hist-legend"/.test(indexHtml) && /id="hist-line-2"/.test(indexHtml),
  "a legenda e as linhas extras existem no markup");
assert((indexHtml.match(/class="seg[^"]*" data-metric="load"/g) || []).length === 1,
  "a métrica de carga tem um botão no seletor");

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
