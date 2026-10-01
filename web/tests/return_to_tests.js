/* return_to_tests.js — expired-link return flow (?next= → /auth?redirect=) */

import {
  NEXT_PARAM,
  sanitizeNext,
  captureReturnTo,
  readReturnTo,
  clearReturnTo,
  buildResumeURL,
  describeTarget,
} from '../js/return_to.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log("  ✓ " + msg); }
  else { failed++; console.error("  ✗ FAIL: " + msg); }
}

/** Fresh in-memory stand-in for sessionStorage, per test group. */
function mockStorage() {
  const data = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

console.log("\n=== Return-to (expired link) Tests ===");

console.log("  [sanitizeNext — same-origin only]");
assert(sanitizeNext("/frigate/") === "/frigate/", "plain service path kept");
assert(sanitizeNext("/hass/?view=map") === "/hass/?view=map", "query preserved");
assert(sanitizeNext("/frigate/events#clip") === "/frigate/events#clip", "fragment preserved");
assert(sanitizeNext("/") === null, "root is the SPA itself, nothing to return to");
assert(sanitizeNext("") === null, "empty rejected");
assert(sanitizeNext(null) === null, "null rejected");
assert(sanitizeNext(undefined) === null, "undefined rejected");

// Every case below resolves to a foreign origin in a browser. `next` comes
// from a URL anyone can send, and it ends up in an href the user clicks.
assert(sanitizeNext("//evil.com") === null, "protocol-relative rejected");
assert(sanitizeNext("//evil.com/pwn") === null, "protocol-relative with path rejected");
assert(sanitizeNext("https://evil.com/pwn") === null, "absolute URL rejected");
assert(sanitizeNext("javascript:alert(1)") === null, "javascript: scheme rejected");
assert(sanitizeNext("/\\evil.com") === null, "backslash variant rejected");
assert(sanitizeNext("\\\\evil.com") === null, "backslash pair rejected");
assert(sanitizeNext("frigate/") === null, "relative path rejected");

console.log("  [capture / read / clear]");
{
  const store = mockStorage();
  const got = captureReturnTo("https://tunnel.example/?" + NEXT_PARAM + "=%2Ffrigate%2F", store);
  assert(got === "/frigate/", "captured from query string");
  assert(readReturnTo(store) === "/frigate/", "persisted for the login flow");

  // The login/unlock flow can reload the page; the destination has to
  // survive a visit with no query string at all.
  assert(captureReturnTo("https://tunnel.example/", store) === "/frigate/",
    "reload without ?next= still remembers");

  clearReturnTo(store);
  assert(readReturnTo(store) === null, "cleared after the trip is resumed");
}

{
  const store = mockStorage();
  assert(captureReturnTo("https://tunnel.example/", store) === null,
    "cold open has no destination");
  assert(captureReturnTo("https://tunnel.example/?" + NEXT_PARAM + "=//evil.com", store) === null,
    "hostile next never stored");
  assert(readReturnTo(store) === null, "hostile next left no trace in storage");
}

{
  // Storage can be absent or throwing (private mode); the flow must degrade
  // to "no memory", never to an exception that breaks app start-up.
  const throwing = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("denied"); },
    removeItem: () => { throw new Error("denied"); },
  };
  assert(captureReturnTo("https://tunnel.example/?" + NEXT_PARAM + "=%2Ffrigate%2F", throwing) === "/frigate/",
    "capture still returns the destination when storage refuses");
  assert(readReturnTo(throwing) === null, "read degrades to null when storage throws");
  clearReturnTo(throwing); // must not throw
  assert(true, "clear tolerates a throwing storage");
}

console.log("  [buildResumeURL]");
assert(
  buildResumeURL("https://t.example", "tok en+/", "/frigate/") ===
    "https://t.example/auth?token=tok%20en%2B%2F&redirect=%2Ffrigate%2F",
  "token and destination are percent-encoded"
);
assert(
  buildResumeURL("https://t.example/", "abc", "/hass/?view=map") ===
    "https://t.example/auth?token=abc&redirect=%2Fhass%2F%3Fview%3Dmap",
  "trailing slash on the tunnel URL does not double up"
);
assert(buildResumeURL("", "abc", "/frigate/") === null, "no tunnel URL → no link");
assert(buildResumeURL("https://t.example", "", "/frigate/") === null, "no token → no link");
assert(buildResumeURL("https://t.example", "abc", "//evil.com") === null,
  "hostile destination cannot be laundered into the resume link");

console.log("  [describeTarget]");
const services = [
  { id: "frigate", name: "Frigate", prefix: "/frigate" },
  { id: "hass", name: "Home Assistant", prefix: "/hass" },
  { id: "frigate-api", name: "Frigate API", prefix: "/frigate/api" },
];
assert(describeTarget("/frigate/", services) === "Frigate", "matched by prefix, shown by name");
assert(describeTarget("/frigate/api/config", services) === "Frigate API",
  "longest matching prefix wins");
assert(describeTarget("/unknown/path", services) === "/unknown/path",
  "unmatched path falls back to the path itself");
assert(describeTarget("/frigate/", null) === "/frigate/", "no service list is not an error");
assert(describeTarget("//evil.com", services) === null, "hostile target described as nothing");

console.log("\n=== Results: " + passed + " passed, " + failed + " failed ===");
if (failed > 0) process.exit(1);
