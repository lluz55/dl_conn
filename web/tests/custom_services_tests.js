/* custom_services_tests.js — production logic for custom local services */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CUSTOM_SERVICES_SCHEMA_VERSION,
  SAFE_SERVICE_ICONS,
  createCustomService,
  exportCustomServicesNix,
  exportCustomServicesYaml,
  mergeHostAndCustomServices,
  parseCustomServices,
  sanitizeServiceId,
  serializeCustomServices,
} from "../js/custom_services.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Parses an exported "services:" YAML fragment with the daemon's own
 * gopkg.in/yaml.v3 dependency (via `go run` against a `//go:build ignore`
 * helper — no new JS dependency), so the assertions below cover a real
 * parse rather than substring/regex matching. Requires `go` on PATH, which
 * the project's own gate (`nix develop && ... && node web/tests/*.js`)
 * guarantees.
 */
function runGoYamlFragmentParser(yamlText) {
  const dir = mkdtempSync(path.join(tmpdir(), "dlconn-yaml-"));
  try {
    const yamlPath = path.join(dir, "fragment.yaml");
    writeFileSync(yamlPath, yamlText, "utf8");
    const result = spawnSync("go", ["run", "web/tests/testdata/parse_yaml_fragment.go", yamlPath], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    if (result.error || result.status !== 0) {
      throw new Error("go run parse_yaml_fragment.go failed: " + (result.error ? result.error.message : result.stderr));
    }
    return JSON.parse(result.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Parses and evaluates an exported Nix list fragment with `nix-instantiate`
 * (available in the project's `nix develop` shell — no new dependency),
 * covering both syntax (`--parse`) and semantics (`--eval --strict`, which
 * forces every attribute so a subtly broken escape wouldn't just parse but
 * fail evaluation, or evaluate to the wrong string).
 */
function runNixInstantiateParse(nixText) {
  const dir = mkdtempSync(path.join(tmpdir(), "dlconn-nix-"));
  try {
    const nixPath = path.join(dir, "fragment.nix");
    writeFileSync(nixPath, nixText, "utf8");
    const parseResult = spawnSync("nix-instantiate", ["--parse", nixPath], { encoding: "utf8" });
    if (parseResult.error || parseResult.status !== 0) {
      throw new Error("nix-instantiate --parse failed: " + (parseResult.error ? parseResult.error.message : parseResult.stderr));
    }
    const evalResult = spawnSync(
      "nix-instantiate",
      ["--eval", "--json", "--strict", "--expr", "builtins.toJSON (import " + JSON.stringify(nixPath) + ")"],
      { encoding: "utf8" }
    );
    if (evalResult.error || evalResult.status !== 0) {
      throw new Error("nix-instantiate --eval failed: " + (evalResult.error ? evalResult.error.message : evalResult.stderr));
    }
    // --json wraps the already-JSON-encoded builtins.toJSON string result in
    // another layer of JSON encoding, so this needs two JSON.parse passes.
    return JSON.parse(JSON.parse(evalResult.stdout));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) {
    console.log("  ✓ " + name);
    passed++;
  } else {
    console.error("  ✗ " + name);
    failed++;
  }
}

console.log("\n=== Custom services tests ===");

check("IDs are normalized for permanent config", sanitizeServiceId("  Câmera / Sala  ") === "camera-sala");

const host = [{ id: "grafana", prefix: "/grafana", name: "Host Grafana" }];
const custom = createCustomService({
  name: "Grafana",
  description: "Painel \"principal\"\nseguro",
  port: "3000",
  icon: "dashboard",
  websocket: true,
  persisted: true,
}, host, []);
check("ID does not overwrite a configured host service", custom.configId === "grafana-2");
check("valid fields are normalized", custom.port === 3000 && custom.websocket && custom.persisted);

for (const port of [1023, 65536, 3000.5, "nope"]) {
  let rejected = false;
  try {
    createCustomService({ name: "Invalid", port, icon: "package" });
  } catch (_) {
    rejected = true;
  }
  check("invalid port is rejected: " + port, rejected);
}

let unsafeIconRejected = false;
try {
  createCustomService({ name: "Unsafe", port: 3000, icon: '<svg onload="alert(1)">' });
} catch (_) {
  unsafeIconRejected = true;
}
check("icons are restricted to the safe existing set", unsafeIconRejected && SAFE_SERVICE_ICONS.includes("dashboard"));

const temporary = createCustomService({ name: "Temp", port: 4000, icon: "terminal", persisted: false }, host, [custom]);
const stored = serializeCustomServices([custom, temporary]);
const parsed = parseCustomServices(stored);
check("dedicated schema carries an explicit version", JSON.parse(stored).version === CUSTOM_SERVICES_SCHEMA_VERSION);
check("only opt-in persisted entries survive reload", parsed.length === 1 && parsed[0].configId === "grafana-2" && parsed[0].persisted);
check("invalid or unknown storage schema fails closed", parseCustomServices('{"version":999,"services":[]}').length === 0 && parseCustomServices("bad").length === 0);

const merged = mergeHostAndCustomServices(host, [custom, temporary]);
check("host services remain unchanged and first", merged.services[0] === host[0] && merged.services.length === 3);
check("custom runtime route uses authenticated dynamic local path", merged.services[1].prefix === "/local/3000" && merged.services[1].custom);
const runtimeCollision = mergeHostAndCustomServices([{ id: "custom:temp", prefix: "/host" }], [temporary]);
check("runtime custom IDs cannot overwrite unusual host IDs", runtimeCollision.services[1].id !== "custom:temp");
check("custom health is explicitly unknown", merged.services.slice(1).every((service) => service.status === "unknown"));

// P1-1: "Local"/"Auth" sanitize to ids the daemon's own mux always owns
// (cmd/dl_conn/main.go registers "/auth" and "/local/" unconditionally).
// Merging an exported fragment with a colliding prefix panics the daemon on
// duplicate http.ServeMux registration, so these ids must never come out of
// createCustomService even with no host services declared at all.
check('"Local" name is reserved even with an empty host list', sanitizeServiceId("Local") === "local");
check('"Auth" name is reserved even with an empty host list', sanitizeServiceId("Auth") === "auth");
const localCollision = createCustomService({ name: "Local", port: 8080, icon: "server" }, [], []);
check('custom service named "Local" gets a disambiguated id, not "local"', localCollision.configId !== "local");
const authCollision = createCustomService({ name: "Auth", port: 8081, icon: "server" }, [], []);
check('custom service named "Auth" gets a disambiguated id, not "auth"', authCollision.configId !== "auth");
const localExportYaml = exportCustomServicesYaml([localCollision]);
check('exported prefix for "Local" never collides with the daemon\'s /local route', !localExportYaml.includes('prefix: "/local"') && !localExportYaml.includes('prefix: "/local/'));
const authExportYaml = exportCustomServicesYaml([authCollision]);
check('exported prefix for "Auth" never collides with the daemon\'s /auth route', !authExportYaml.includes('prefix: "/auth"'));

const tricky = createCustomService({
  name: 'Painel "${host}" \\backslash café ☕ 日本語',
  description: "linha 1\nlinha 2\\fim\ttab \"quoted\" 'single' ${nix_interp} 日本語",
  port: 8124,
  icon: "code",
  websocket: true,
}, [], []);
const yaml = exportCustomServicesYaml([tricky]);
check("YAML is a services-only merge fragment", yaml.startsWith("# dl_conn") && yaml.includes("\nservices:\n") && !yaml.includes("nostr:"));
check("YAML contains every canonical permanent field", ["id:", "name:", "icon:", "description:", "prefix:", "target:", "stripPrefix:", "websocket:"].every((field) => yaml.includes(field)));
check("YAML targets loopback and preserves websocket export intent", yaml.includes('target: "http://127.0.0.1:8124"') && yaml.includes("websocket: true"));

// P2-2: parse the exported YAML fragment with the daemon's own yaml.v3
// (not substring/regex matching), covering quotes, ${...} interpolation,
// backslashes, embedded newlines/tabs and unicode in name/description.
const yamlParsed = runGoYamlFragmentParser(yaml);
check("YAML fragment parses to exactly one service via yaml.v3", Array.isArray(yamlParsed) && yamlParsed.length === 1);
check("YAML round-trips the tricky name exactly (quotes/backslash/${}/unicode)", yamlParsed[0].Name === tricky.name);
check("YAML round-trips the tricky description exactly (newline/tab/quotes)", yamlParsed[0].Description === tricky.description);
check("YAML round-trips the other canonical fields", yamlParsed[0].ID === tricky.configId && yamlParsed[0].Prefix === "/" + tricky.configId && yamlParsed[0].Target === "http://127.0.0.1:8124" && yamlParsed[0].StripPrefix === true && yamlParsed[0].Websocket === true);

const nix = exportCustomServicesNix([tricky]);
check("Nix is a settings.services merge fragment", nix.includes("services.dl-conn.settings.services") && nix.trim().endsWith("]"));
check("Nix contains every canonical permanent field", ["id =", "name =", "icon =", "description =", "prefix =", "target =", "stripPrefix =", "websocket ="].every((field) => nix.includes(field)));

// P2-2: parse+evaluate the exported Nix fragment with nix-instantiate (not
// substring/regex matching). --eval --strict forces every attribute, so a
// broken escape fails evaluation or evaluates to the wrong string, not just
// "parses".
const nixParsed = runNixInstantiateParse(nix);
check("Nix fragment parses and evaluates to exactly one service", Array.isArray(nixParsed) && nixParsed.length === 1);
check("Nix round-trips the tricky name exactly (quotes/backslash/${}/unicode)", nixParsed[0].name === tricky.name);
check("Nix round-trips the tricky description exactly (newline/tab/quotes)", nixParsed[0].description === tricky.description);
check("Nix round-trips the other canonical fields", nixParsed[0].id === tricky.configId && nixParsed[0].prefix === "/" + tricky.configId && nixParsed[0].target === "http://127.0.0.1:8124" && nixParsed[0].stripPrefix === true && nixParsed[0].websocket === true);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed) process.exit(1);
