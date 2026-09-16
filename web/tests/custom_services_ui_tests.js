/* custom_services_ui_tests.js — structural wiring and responsive UI guards */
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");

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

console.log("\n=== Custom services UI tests ===");
check("form includes required name and bounded port", /id="custom-service-name"[^>]*required/.test(html) && /id="custom-service-port"[^>]*min="1024"[^>]*max="65535"[^>]*required/.test(html));
check("description remains optional", /id="custom-service-description"[^>]*maxlength="240"/.test(html) && !/id="custom-service-description"[^>]*required/.test(html));
check("safe icon chooser is a select populated from production allowlist", /<select id="custom-service-icon"/.test(html) && app.includes("SAFE_SERVICE_ICONS.map"));
check("WebSocket and opt-in persistence are unchecked checkboxes", /type="checkbox" id="custom-service-websocket"/.test(html) && /type="checkbox" id="custom-service-persist"/.test(html) && !/id="custom-service-persist"[^>]*checked/.test(html));
check("HTTP-only temporary route limitation is visible", html.includes("é somente HTTP") && html.includes("WebSocket só será aplicada ao arquivo exportado"));
check("both export actions are present and wired", /id="btn-export-services-yaml"/.test(html) && /id="btn-export-services-nix"/.test(html) && app.includes('onExportCustomServices("yaml")') && app.includes('onExportCustomServices("nix")'));
check("host discovery merges rather than overwrites custom services", /state\.hostServices = data\.services \|\| \[\];\s*mergeServices\(\)/.test(app));
check("custom deletion is isolated by custom config ID", app.includes("function onDeleteCustomService(configId)") && app.includes("state.customServices.filter"));
check("custom cards explain unprobed state", app.includes("CUSTOM_SERVICE_STRINGS.unprobed") && app.includes("service-unprobed"));
check("custom service form is responsive", /@media\s*\(max-width:\s*639px\)[\s\S]*?\.custom-service-fields\s*\{[^}]*grid-template-columns:\s*1fr/.test(css));
check("CSP-safe UI introduces no inline styles", !/style\s*=/.test(html));

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed) process.exit(1);
