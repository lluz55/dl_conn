/* test.js — Prototype-only controller for test.html (redesign proposal).
   Everything is CSP-safe: no inline styles, style.width never touched —
   the countdown bar is an SVG <rect> updated via setAttribute, exactly
   like the production sparklines in app.js. */

const root = document.documentElement;
const $ = (id) => document.getElementById(id);

/* ── Theme (light/dark) ────────────────────────────────────────────
   Same mechanism as production app.js: an explicit data-theme on the
   root element. Persisted under a dl_conn_test_* key so the prototype
   never clashes with the real app's saved preference. */

const THEME_KEY = "dl_conn_tes…heme";
const PALETTE_KEY = "dl_conn_tes…ette";

function applyTheme(theme) {
  root.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  for (const btn of document.querySelectorAll("#theme-switch button")) {
    btn.setAttribute("aria-pressed", String(btn.dataset.theme === theme));
  }
  const icon = document.querySelector("#theme-toggle use");
  if (icon) icon.setAttribute("href", theme === "dark" ? "#i-sun" : "#i-moon");
}

function applyPalette(palette) {
  root.setAttribute("data-palette", palette);
  localStorage.setItem(PALETTE_KEY, palette);
  for (const btn of document.querySelectorAll("#palette-switch button")) {
    btn.setAttribute("aria-pressed", String(btn.dataset.palette === palette));
  }
}

/* Initial state: stored preference, else the OS one. */
applyPalette(localStorage.getItem(PALETTE_KEY) || "azure");
applyTheme(
  localStorage.getItem(THEME_KEY) ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
);

$("theme-switch").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-theme]");
  if (btn) applyTheme(btn.dataset.theme);
});
$("palette-switch").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-palette]");
  if (btn) applyPalette(btn.dataset.palette);
});
$("theme-toggle").addEventListener("click", () => {
  applyTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
});

/* ── Session countdown demo ────────────────────────────────────────
   Mirrors what SessionManager will feed in the real implementation:
   remaining = inactivityTimeout − idleTime, re-armed on activity. */

const rect = $("countdown-rect");
const text = $("countdown-text");
const wrap = $("countdown-wrap");
const kpi = $("kpi-session-countdown");
const sel = $("auto-lock-timeout");

let totalSec = 15 * 60;
let leftSec = 14 * 60 + 58;

function fmt(s) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ":" + String(r).padStart(2, "0");
}

function tick() {
  if (leftSec > 0) leftSec--;
  if (kpi) kpi.textContent = fmt(leftSec);
  if (sel.value === "0") {
    rect.setAttribute("width", "100");
    text.textContent = "sem bloqueio";
    return;
  }
  const pct = Math.max(0, (leftSec / totalSec) * 100);
  rect.setAttribute("width", pct.toFixed(2));
  text.textContent = fmt(leftSec);
  wrap.classList.toggle("is-warning", pct <= 20 && pct > 8);
  wrap.classList.toggle("is-danger", pct <= 8);
}
setInterval(tick, 1000);

sel.addEventListener("change", () => {
  const minutes = parseInt(sel.value, 10);
  totalSec = (minutes || 15) * 60;
  leftSec = totalSec;
  tick();
});

/* Interacting with the card "re-arms" the inactivity timer, like the
   production reset-on-activity behavior. */
for (const card of document.querySelectorAll(".session-card")) {
  card.addEventListener("pointerdown", () => {
    if (sel.value !== "0") { leftSec = totalSec; tick(); }
  });
}

/* ── Relay toggles (demo) ────────────────────────────────────────── */
for (const t of document.querySelectorAll(".relay-toggle")) {
  t.addEventListener("click", () => {
    const on = t.classList.toggle("on");
    t.setAttribute("aria-pressed", String(on));
  });
}

/* ── QR modal (demo of the overlay treatment) ────────────────────── */
const overlay = $("qr-overlay");
function openModal() { overlay.classList.remove("hidden"); }
function closeModal() { overlay.classList.add("hidden"); }
$("btn-scan-qr").addEventListener("click", openModal);
$("btn-open-demo-modal").addEventListener("click", openModal);
$("btn-qr-close").addEventListener("click", closeModal);
overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
