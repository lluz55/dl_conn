/* section_collapse.js — the state rules behind a collapsible card
 *
 * Collapsing a card hides its body and keeps the head, so the pills in the
 * head (relay summary, session state, service count) stay readable. What is
 * left after that is four decisions, and each of them is a place where a
 * hand-written per-card toggle can be subtly wrong in a way that still looks
 * like it works — so they live here, tested, and app.js only walks the DOM.
 */

/**
 * The state to move to when the toggle is pressed.
 *
 * The body's current class *is* the state, so the next state is its inverse.
 * Getting this backwards re-applies what is already on screen: the button
 * updates its own label and chevron, so it still animates, but the body never
 * opens or closes. That is why the relay card's collapse shipped as a control
 * that appeared to be wired and did nothing.
 *
 * @param {boolean} isHidden - whether the body currently carries `hidden`
 * @returns {boolean} the new collapsed state
 */
export function nextCollapsed(isHidden) {
  return !isHidden;
}

/**
 * The accessible labels for a toggle, in both states.
 *
 * `aria-label` and the tooltip (`data-tip`, drawn by CSS) must always say the
 * same thing: updating only the ARIA leaves a "Recolher" tooltip sitting on a
 * button that now only expands.
 *
 * @param {boolean} collapsed
 * @param {string} label - the section's name in the user-visible language
 * @returns {{collapse:string, expand:string}}
 */
export function collapseLabels(collapsed, label) {
  return {
    collapse: "Recolher " + label,
    expand: "Expandir " + label,
  };
}

/**
 * The single label for a toggle in its current state.
 *
 * @param {boolean} collapsed
 * @param {string} label
 * @returns {string}
 */
export function collapseLabel(collapsed, label) {
  return collapsed ? collapseLabels(collapsed, label).expand : collapseLabels(collapsed, label).collapse;
}

/**
 * Whether a stored preference means collapsed.
 *
 * Only the exact string "1" counts. Treating any truthy value as "collapsed"
 * would make a missing preference collapse every section on first load.
 *
 * @param {string|null} stored
 * @returns {boolean}
 */
export function storedCollapsed(stored) {
  return stored === "1";
}

/** The value written back to storage for a state. */
export function storedValue(collapsed) {
  return collapsed ? "1" : "0";
}