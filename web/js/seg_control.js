/* seg_control.js — wiring for a segmented button group (`1h / 24h / 7d`)
 *
 * A `.seg` group carries its value in a data attribute, and the two ways of
 * naming that attribute do not line up: the markup spells it
 * `data-avail-window`, a CSS attribute selector must match that same
 * hyphenated name, and `dataset` exposes it as the camelCase `availWindow`.
 *
 * Building the selector from one spelling while reading the value through the
 * other is the whole bug: `[data-availWindow]` matches nothing (the selector
 * engine lowercases it to `data-availwindow`, which is a *different* name from
 * `data-avail-window`, not a different case of the same one), so `closest()`
 * returns null, the click handler bails out, and the toggle is dead while the
 * button still repaints itself as selected.
 *
 * So the markup attribute is the single input and the camelCase `dataset` key
 * is derived from it by a function that can be tested, rather than being passed
 * alongside it at every call site where the two can drift apart.
 */

/** `data-avail-window` -> `availWindow`, as `dataset` spells it. */
export function datasetKeyFor(attr) {
  const name = String(attr).replace(/^data-/, "");
  return name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/**
 * The selector that matches a `.seg` carrying `attr`, e.g.
 * `data-avail-window` -> `.seg[data-avail-window]`.
 *
 * Takes the attribute verbatim. Lowercasing it here would be wrong: HTML
 * attribute names are case-insensitive but `data-availwindow` and
 * `data-avail-window` are distinct names, and only the latter exists.
 */
export function segSelector(attr) {
  return ".seg[" + attr + "]";
}

/**
 * Wire one segmented group to `apply`, which receives the clicked value.
 *
 * Exclusive selection is owned here rather than left to the caller, because a
 * group whose buttons can show two of themselves as selected reads as a
 * control that half-answered.
 *
 * @param {Element} group - the `.seg-group` container
 * @param {string} attr - the data attribute holding the value, e.g. `data-avail-window`
 * @param {(value:string) => void} apply
 */
export function wireSegGroup(group, attr, apply) {
  if (!group || typeof group.addEventListener !== "function") return;
  group.addEventListener("click", (event) => {
    const btn = event.target.closest(segSelector(attr));
    if (!btn || !group.contains(btn)) return;
    for (const other of group.querySelectorAll(".seg")) {
      other.classList.toggle("is-on", other === btn);
    }
    apply(btn.dataset[datasetKeyFor(attr)]);
  });
}