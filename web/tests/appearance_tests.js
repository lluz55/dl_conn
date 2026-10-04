/* appearance_tests.js — behavioural guards for the appearance sheet
 *
 * The sheet used to open, draw every control and accept clicks that changed
 * nothing: the handler built its selector by concatenating the camelCase
 * dataset key, so it looked for "[data-themeChoice]" while the markup ships
 * "data-theme-choice". Every click hit an early return.
 *
 * These tests extract the real setupAppearancePanel() from app.js and run it
 * against a minimal fake DOM, so they check what the browser would actually do
 * rather than pattern-matching the source text.
 */

import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) {
    passed++;
    console.log("  ✓ " + message);
  } else {
    failed++;
    console.error("  ✗ FAIL: " + message);
  }
}

/* ── fake DOM ──────────────────────────────────────────────────────────
   Faithful to the two behaviours this bug turned on:
     - a dataset key is the camelCase form of its kebab-case attribute
       (data-palette-choice  <->  dataset.paletteChoice)
     - closest("[data-x]") matches on the attribute name, not the key      */

function toCamel(attr) {
  return attr.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function makeEl(dataset = {}, parent = null) {
  const el = {
    dataset,
    parent,
    listeners: {},
    addEventListener(type, fn) {
      (el.listeners[type] ||= []).push(fn);
    },
    dispatch(type, event) {
      for (const fn of el.listeners[type] || []) fn(event);
    },
    // Like the real thing, both of these walk the ancestor chain.
    closest(selector) {
      const m = /^\[data-([a-z0-9-]+)\]$/.exec(selector);
      if (!m) return null;
      const wanted = toCamel(m[1]);
      for (let n = el; n; n = n.parent) if (wanted in n.dataset) return n;
      return null;
    },
    contains(node) {
      for (let n = node; n; n = n.parent) if (n === el) return true;
      return false;
    },
  };
  return el;
}

function makeGroup(choiceKey, values) {
  const group = makeEl();
  group.buttons = values.map((v) => {
    const button = makeEl({ [choiceKey]: v }, group);
    return { choice: v, el: button };
  });
  return group;
}

function makeStorage() {
  const map = new Map();
  return {
    map,
    setItem: (k, v) => map.set(k, String(v)),
    getItem: (k) => (map.has(k) ? map.get(k) : null),
  };
}

/** Slice a top-level `function name(...) { … }` out of the source. */
function extractFunction(source, name) {
  const start = source.indexOf("function " + name + "(");
  if (start === -1) throw new Error(name + " not found in app.js");
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error("unbalanced braces for " + name);
}

/**
 * Run the production setupAppearancePanel() and return the captured state:
 * the storage it wrote to, how often it re-applied, and the groups to click.
 */
function runAppearancePanel() {
  const localStorage = makeStorage();
  let applies = 0;
  const el = {
    appearancePanel: makeEl(),
    btnAppearance: makeEl(),
    btnAppearanceClose: makeEl(),
    themeGroup: makeGroup("themeChoice", ["light", "dark", "system"]),
    paletteGroup: makeGroup("paletteChoice", ["azure", "evergreen", "ember", "iris"]),
    densityGroup: makeGroup("densityChoice", ["compact", "comfortable"]),
  };
  const src = extractFunction(app, "setupAppearancePanel");
  const run = new Function(
    "wireDialog", "openDialog", "closeDialog", "el", "document", "localStorage", "applyAppearance",
    src + "\nreturn setupAppearancePanel();",
  );
  run(
    () => {},
    () => {},
    () => {},
    el,
    { addEventListener: () => {} },
    localStorage,
    () => { applies++; },
  );
  return { localStorage, applies: () => applies, el };
}

/** Click the option carrying `value` inside `group` and report what changed. */
function clickChoice(group, value) {
  const button = group.buttons.find((b) => b.choice === value).el;
  group.dispatch("click", { target: button });
  return button;
}

console.log("\n=== Appearance tests ===");

/* The real regression: a click must reach the storage write and re-apply. */
{
  const { localStorage, applies, el } = runAppearancePanel();

  assert(
    localStorage.getItem("dl_conn_theme") === null && applies() === 0,
    "wiring the panel on its own changes nothing",
  );

  clickChoice(el.themeGroup, "dark");
  assert(
    localStorage.getItem("dl_conn_theme") === "dark",
    'clicking "Escuro" persists dl_conn_theme=dark',
  );
  assert(applies() === 1, "the theme choice re-applies the appearance instead of only being stored");

  clickChoice(el.paletteGroup, "ember");
  assert(
    localStorage.getItem("dl_conn_palette") === "ember",
    'clicking the "Ember" palette persists dl_conn_palette=ember',
  );

  clickChoice(el.densityGroup, "compact");
  assert(
    localStorage.getItem("dl_conn_density") === "compact",
    'clicking "Compacta" persists dl_conn_density=compact',
  );
  assert(applies() === 3, "all three axes re-apply the appearance");
}

/* A click lands on the label inside the button, not the button itself. */
{
  const { localStorage, el } = runAppearancePanel();
  const button = el.paletteGroup.buttons.find((b) => b.choice === "iris").el;
  const label = makeEl({}, button); // the <span class="palette-name"> inside it
  el.paletteGroup.dispatch("click", { target: label });
  assert(
    localStorage.getItem("dl_conn_palette") === "iris",
    "clicking the label inside a palette button still selects that palette",
  );
}

/* A click on the sheet's own padding must not be treated as a choice. */
{
  const { localStorage, el } = runAppearancePanel();
  el.themeGroup.dispatch("click", { target: el.themeGroup });
  assert(
    localStorage.getItem("dl_conn_theme") === null,
    "clicking the group background selects nothing",
  );
}

/* Every data-* attribute the handler selects must exist in the markup, so the
   ids the sheet renders and the keys it reads cannot drift apart. */
{
  const bindings = [
    ["theme-group", "themeChoice", "dl_conn_theme"],
    ["palette-group", "paletteChoice", "dl_conn_palette"],
    ["density-group", "densityChoice", "dl_conn_density"],
  ];
  for (const [id, key] of bindings) {
    const start = html.indexOf('id="' + id + '"');
    const block = start === -1 ? "" : html.slice(start, html.indexOf("</div>", start));
    const attrs = new Set(block.match(/data-[a-z0-9-]+/g) || []);
    const kebab = "data-" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
    assert(attrs.has(kebab), `#${id} ships ${kebab}, the attribute the handler selects`);
  }
  assert(
    /<html lang="pt-BR" data-palette="azure" data-theme="light">/.test(html),
    "the served markup boots with a theme and palette, so there is never an unscoped frame",
  );
}

/* The apply path and its token contract. */
assert(
  /root\.setAttribute\("data-theme",\s*effectiveTheme\(preference\)\)/.test(app) &&
    /root\.setAttribute\("data-palette",\s*localStorage\.getItem\("dl_conn_palette"\)\s*\|\|\s*"azure"\)/.test(app),
  "applyAppearance writes data-theme and data-palette onto <html>, where the token blocks are scoped",
);
assert(
  /syncAppearanceControls\(\)/.test(app) &&
    /classList\.toggle\("is-on",\s*on\)/.test(app) &&
    /setAttribute\("aria-pressed",\s*on\s*\?\s*"true"\s*:\s*"false"\)/.test(app),
  "the sheet's controls reflect the live selection via .is-on and aria-pressed",
);
assert(
  /density === "compact" && coarsePointer\.matches/.test(app) &&
    /@media\s*\(pointer:\s*fine\)\s*\{\s*\[data-density="compact"\]/.test(css),
  "compact density is refused on coarse pointers in both JS and CSS",
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
