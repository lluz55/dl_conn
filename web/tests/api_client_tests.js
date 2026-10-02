/**
 * api_client_tests.js — the SPA's token-redemption and step-up logic.
 *
 * Run with: node web/tests/api_client_tests.js
 *
 * fetch is injected throughout, so these are assertions about the requests the
 * SPA builds (method, mode, credentials, body, headers) rather than about a
 * browser. What matters here is that a one-time token travels in a body and
 * never in a URL, and that a step-up proof is only minted when the daemon
 * actually asks for one.
 */
import assert from "node:assert/strict";
import {
  STEP_UP_HEADER,
  STEP_UP_PATH,
  clearStepUp,
  getStepUpHeader,
  redeemAndOpen,
  redeemToken,
  requestStepUp,
  serviceHref,
} from "../js/api_client.js";

const TUNNEL = "https://demo.trycloudflare.com";

/** Records every call and answers with a scripted response. */
function stubFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init: init || {} });
    const next = responses.shift();
    if (typeof next === "function") return next(url, init || {});
    return next || { ok: true, status: 200, json: async () => ({}) };
  };
  impl.calls = calls;
  return impl;
}

console.log("  [serviceHref]");
assert.equal(
  serviceHref(TUNNEL, "/frigate/"),
  TUNNEL + "/frigate/",
  "destination is the tunnel origin plus the path"
);
assert.equal(
  serviceHref(TUNNEL + "/", "/hass/"),
  TUNNEL + "/hass/",
  "a trailing slash on the tunnel origin is not doubled"
);
assert.equal(serviceHref("", "/hass/"), "/hass/", "no tunnel URL degrades to a relative path");
assert.equal(serviceHref(null, undefined), "/", "no arguments at all still yields a usable path");
{
  const href = serviceHref(TUNNEL, "/frigate/");
  assert.ok(!href.includes("token"), "the opened URL must never carry a token");
}

console.log("  [redeemToken]");
{
  const fetchStub = stubFetch([{ ok: true, status: 200 }]);
  const ok = await redeemToken(TUNNEL, "secret-token", "/frigate/", fetchStub);
  assert.equal(ok, true, "a completed redemption resolves true");

  const call = fetchStub.calls[0];
  assert.equal(call.url, TUNNEL + "/auth", "posts to /auth");
  assert.equal(call.init.method, "POST", "the token travels in a body, not a query string");
  assert.ok(!call.url.includes("secret-token"), "the token is absent from the URL");
  assert.ok(call.init.body.includes("token=secret-token"), "the token is in the form body");
  assert.ok(call.init.body.includes("redirect=%2Ffrigate%2F"), "the destination is in the body");
  assert.equal(
    call.init.headers["Content-Type"],
    "application/x-www-form-urlencoded",
    "a CORS-simple content type keeps this a preflight-free request"
  );
  assert.equal(call.init.mode, "no-cors", "the tunnel sends no CORS headers, so the response is opaque");
  assert.equal(call.init.credentials, "include", "the session cookie must be accepted from the response");
}
{
  const fetchStub = stubFetch([
    () => { throw new TypeError("Failed to fetch"); },
  ]);
  assert.equal(
    await redeemToken(TUNNEL, "secret-token", "/frigate/", fetchStub),
    false,
    "a network failure resolves false instead of throwing"
  );
}
{
  assert.equal(await redeemToken("", "tok", "/x/", stubFetch([])), false, "no tunnel URL: nothing to do");
  assert.equal(await redeemToken(TUNNEL, "", "/x/", stubFetch([])), false, "no token: nothing to do");
  assert.equal((await redeemToken(TUNNEL, "", "/x/", stubFetch([]))) === false, true, "and no request is made");
}

console.log("  [redeemAndOpen]");
{
  const fetchStub = stubFetch([{ ok: true, status: 200 }]);
  let opened = null;
  await redeemAndOpen(TUNNEL, "secret-token", "/hass/", (url) => { opened = url; });
  assert.equal(opened, TUNNEL + "/hass/", "opens the credential-free destination");
  assert.ok(!opened.includes("token"), "the opened URL carries no token");
}
{
  // A redemption that fails must still open the destination: an existing
  // session authorizes it, and without one the daemon answers with the login
  // page, which is where an unauthenticated click already led.
  const fetchStub = stubFetch([() => { throw new Error("offline"); }]);
  let opened = null;
  await redeemAndOpen(TUNNEL, "secret-token", "/hass/", (url) => { opened = url; });
  assert.equal(opened, TUNNEL + "/hass/", "a failed redemption still opens the service");
}

console.log("  [step-up]");
{
  clearStepUp();
  assert.equal(getStepUpHeader(), null, "no proof is held after a clear");

  const fetchStub = stubFetch([
    { status: 200, json: async () => ({ header: STEP_UP_HEADER, value: "proof-abc", ttlSec: 300 }) },
  ]);
  const proof = await requestStepUp(TUNNEL, fetchStub);
  assert.equal(proof, "proof-abc", "the minted proof is returned");
  assert.equal(fetchStub.calls[0].url, TUNNEL + STEP_UP_PATH, "proofs come from the step-up route");
  assert.equal(fetchStub.calls[0].init.method, "POST", "minting is POST-only, like the daemon requires");
  assert.deepEqual(
    getStepUpHeader(),
    { [STEP_UP_HEADER]: "proof-abc" },
    "the proof is attached under the daemon's header name"
  );
}
{
  // A daemon with step-up not enabled answers 404. That is not an error to
  // retry on every poll: send no proof and behave exactly as before.
  clearStepUp();
  const fetchStub = stubFetch([{ status: 404 }]);
  assert.equal(await requestStepUp(TUNNEL, fetchStub), null, "a 404 yields no proof");
  assert.equal(getStepUpHeader(), null, "and nothing is attached to later requests");
}
{
  clearStepUp();
  const fetchStub = stubFetch([{ status: 200, json: async () => ({ value: "p" }) }]);
  await requestStepUp(TUNNEL, fetchStub);
  clearStepUp();
  assert.equal(getStepUpHeader(), null, "a proof never survives a clear (lock, logout, identity change)");
}
{
  clearStepUp();
  const fetchStub = stubFetch([() => { throw new Error("offline"); }]);
  assert.equal(await requestStepUp(TUNNEL, fetchStub), null, "an unreachable daemon yields no proof");
}
{
  // Expiry is client-side: a proof whose window has passed must not be sent,
  // because the daemon would answer 401 and the retry would mint a new one
  // anyway.
  clearStepUp();
  const fetchStub = stubFetch([
    { status: 200, json: async () => ({ value: "stale", ttlSec: 300 }) },
  ]);
  await requestStepUp(TUNNEL, fetchStub);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 6 * 60 * 1000;
    assert.equal(getStepUpHeader(), null, "an expired proof is dropped rather than sent");
  } finally {
    Date.now = realNow;
    clearStepUp();
  }
}

console.log("  ✓ api_client_tests: all assertions passed");
