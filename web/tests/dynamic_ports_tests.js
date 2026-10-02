import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const html = fs.readFileSync(path.join(root, "web/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "web/app.js"), "utf8");

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

console.log("\n=== Dynamic local port UI tests ===");
check("port input is bounded to non-privileged TCP ports", /id="local-port-input"[^>]*min="1024"[^>]*max="65535"/.test(html));
check("open button is wired", app.includes('el.btnOpenLocalPort.addEventListener("click", onOpenLocalPort)'));
check("open button is wired", app.includes('el.btnOpenLocalPort.addEventListener("click", onOpenLocalPort)'));
// The destination is the loopback service itself, and the one-time token is
// redeemed in a POST body first — it must not appear in a URL any more.
check("URL uses the authenticated same-origin redirect",
  app.includes('openService("/local/" + port + "/")'));
check("no token is placed in a URL", !app.includes('"/auth?token="'),
  "a one-time token in a URL leaks into history, access logs and Referer");
check("dynamic card appears only after discovery", app.includes('el.localPortSection.classList.remove("hidden")'));

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed) process.exit(1);
