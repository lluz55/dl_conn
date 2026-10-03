/**
 * api_client_tests.js — the SPA's token-redemption and step-up logic.
 *
 * Run with: node web/tests/api_client_tests.js
 *
 * The redemption path is now a hidden <form method="POST"> submit, not a
 * fetch(): the form submission is a top-level navigation so the Set-Cookie
 * on /auth lands in a first-party context (see js/api_client.js for why a
 * fetch() can't do that when the SPA isn't on the tunnel origin). These
 * tests assert what the form looks like — method, action, fields, target
 * — and skip the actual submit() call (which would navigate a real
 * browser, and in node there is no navigation to follow).
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

/**
 * Install a minimum stub of the DOM the redemption path uses. Node has no
 * DOM globals by default; the helpers here only touch createElement,
 * appendChild, querySelectorAll, submit(), and (when a new tab is opened)
 * window.open, so a hand-rolled stub is cheaper than pulling jsdom.
 *
 * Returns a `dispose` to restore the originals (none yet — the stub is
 * permanent for the test process) and the shared inspection handles:
 *  - `forms`: every <form> created during the test, so assertions can
 *    inspect what would have been submitted.
 *  - `openedWindows`: every (name, features) tuple the test fed into
 *    window.open, so the test can confirm a target="_blank" redemption
 *    pre-opens a window.
 */
function installDomStub() {
  const forms = [];
  const openedWindows = [];

  function makeInput() {
    return {
      type: "",
      name: "",
      value: "",
    };
  }

  function makeForm() {
    const children = [];
    return {
      method: "GET",
      action: "",
      target: "",
      style: {},
      appendChild(node) {
        children.push(node);
        return node;
      },
      querySelectorAll(selector) {
        if (selector !== "input") return [];
        return children.filter((c) => c && typeof c === "object" && "name" in c);
      },
    };
  }

  const body = {
    children: [],
    appendChild(node) {
      this.children.push(node);
      return node;
    },
  };

  globalThis.document = {
    createElement(tag) {
      const t = String(tag).toLowerCase();
      if (t === "form") {
        const f = makeForm();
        forms.push(f);
        return f;
      }
      if (t === "input") return makeInput();
      return {};
    },
    body,
  };

  // submit() would navigate in a real browser; in node there's no
  // navigation, so stub it.
  const FormProto = Object.getPrototypeOf(makeForm());
  FormProto.submit = function noop() {};

  globalThis.window = {
    open(url, name, features) {
      openedWindows.push({ url, name, features });
      // Real browsers return a WindowProxy; the helper ignores the return
      // value (it targets by name, not by reference), so returning null is
      // faithful to the test's needs.
      return null;
    },
  };

  return { forms, openedWindows };
}

const { forms, openedWindows } = installDomStub();

/** Records every call and answers with a scripted response (step-up only). */
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

console.log("  [redeemToken — form submission]");
{
  forms.length = 0;
  openedWindows.length = 0;
  const ok = redeemToken(TUNNEL, "secret-token", "/frigate/");
  assert.equal(ok, true, "submitting a valid form returns true");
  assert.equal(forms.length, 1, "one form is built");
  assert.equal(openedWindows.length, 0, "no window.open when no new tab is requested");

  const form = forms[0];
  assert.equal(form.method, "POST", "the token travels in a body, not a query string");
  assert.equal(form.action, TUNNEL + "/auth", "posts to /auth");
  assert.ok(!form.action.includes("secret-token"), "the action URL does not carry the token");
  assert.equal(form.target, "", "no target means the current tab navigates");
  assert.equal(form.style.position, "absolute", "off-screen position, not display:none");
  assert.equal(form.style.left, "-9999px");

  const fields = {};
  for (const input of form.querySelectorAll("input")) fields[input.name] = input.value;
  assert.equal(fields.token, "secret-token", "the token is in the form body");
  assert.equal(fields.redirect, "/frigate/", "the destination is in the form body");
}
{
  // A new tab is requested via target="_blank": the helper pre-opens an
  // about:blank window with a unique name (so the form submission can
  // target it), and the form's `target` ends up being that name, not the
  // literal "_blank" — that's the only way the submission reliably lands
  // on the window `window.open` opened instead of being swallowed by the
  // popup blocker (or spawning a sibling window).
  forms.length = 0;
  openedWindows.length = 0;
  const ok = redeemToken(TUNNEL, "secret-token", "/hass/", "_blank");
  assert.equal(ok, true);
  assert.equal(forms.length, 1);
  assert.equal(openedWindows.length, 1, "a window is pre-opened for the new tab");

  const opened = openedWindows[0];
  assert.equal(opened.url, "", "the pre-opened window is about:blank");
  assert.match(opened.name, /^dl_conn_/, "the pre-opened window has a generated name");
  assert.ok(
    opened.features && opened.features.includes("noopener") && opened.features.includes("noreferrer"),
    "no opener/noreferrer so the SPA can't poke the service's window"
  );

  const form = forms[0];
  assert.equal(form.method, "POST");
  assert.equal(form.action, TUNNEL + "/auth");
  assert.equal(form.target, opened.name, "the form targets the pre-opened window by name");
  const fields = {};
  for (const input of form.querySelectorAll("input")) fields[input.name] = input.value;
  assert.equal(fields.token, "secret-token");
  assert.equal(fields.redirect, "/hass/");
}
{
  // Two consecutive _blank calls must produce different window names, so the
  // two navigations don't collide on a single about:blank tab.
  openedWindows.length = 0;
  forms.length = 0;
  redeemToken(TUNNEL, "t1", "/a/", "_blank");
  const firstName = openedWindows[0].name;
  forms.length = 0;
  redeemToken(TUNNEL, "t2", "/b/", "_blank");
  const secondName = openedWindows[1].name;
  assert.notEqual(firstName, secondName, "consecutive new-tab calls open different tabs");
}
{
  // A trailing slash on the tunnel origin is not doubled in the action.
  forms.length = 0;
  openedWindows.length = 0;
  redeemToken(TUNNEL + "/", "tok", "/x/");
  assert.equal(forms[0].action, TUNNEL + "/auth", "action URL never doubles the slash");
}
{
  // No redirect is fine: the form still submits with just the token. The
  // daemon falls back to "/" for an empty redirect parameter (see
  // SafeRedirect), which is the SPA itself.
  forms.length = 0;
  openedWindows.length = 0;
  redeemToken(TUNNEL, "tok", "");
  const fields = {};
  for (const input of forms[0].querySelectorAll("input")) fields[input.name] = input.value;
  assert.equal(fields.token, "tok");
  assert.equal(fields.redirect, undefined, "no redirect field when none was supplied");
}
{
  assert.equal(redeemToken("", "tok", "/x/"), false, "no tunnel URL: nothing to do");
  assert.equal(redeemToken(TUNNEL, "", "/x/"), false, "no token: nothing to do");
}

console.log("  [redeemAndOpen — thin wrapper]");
{
  forms.length = 0;
  openedWindows.length = 0;
  const ok = redeemAndOpen(TUNNEL, "secret-token", "/hass/", "_blank");
  assert.equal(ok, true);
  assert.equal(forms.length, 1, "the helper builds the same form as redeemToken");
  assert.equal(openedWindows.length, 1, "and pre-opens a window for the new tab");
  assert.equal(forms[0].method, "POST");
  assert.equal(forms[0].action, TUNNEL + "/auth");
  assert.equal(forms[0].target, openedWindows[0].name);
}
{
  // Same tab when no target is supplied: no window is pre-opened, the
  // form's target is empty, the navigation lands here.
  forms.length = 0;
  openedWindows.length = 0;
  redeemAndOpen(TUNNEL, "secret-token", "/hass/");
  assert.equal(openedWindows.length, 0);
  assert.equal(forms[0].target, "", "no target defaults to the current window");
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
