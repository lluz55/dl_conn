/* relay_rtt_history.js — a rolling window of per-relay round-trip times
 *
 * The tester already measures RTT on every probe, but only the newest value
 * survives. That answers "is this relay up right now" and nothing else: a
 * relay that has been drifting from 80 ms to 2 s looks identical to a steady
 * one until it finally times out. Keeping a short window turns the same
 * measurement into a trend, which is what actually tells you which relay to
 * keep.
 *
 * The history lives in localStorage because the measurement itself is made in
 * the browser — there is no daemon-side number to ask for. That also means it
 * is only as durable as the browser, and the UI never claims otherwise: the
 * sparkline is drawn from "what this browser has seen", not from a guarantee.
 */

const STORAGE_KEY = "dl_conn_relay_rtt";

/**
 * How many samples one relay keeps. Bounded because this is written on every
 * probe of every relay: at the default relay count and a test every few
 * minutes, an unbounded list would grow in localStorage until it started
 * failing to save.
 */
export const RTT_HISTORY_POINTS = 40;

/**
 * A failed probe is recorded too, but as a null rather than as a large
 * number. A missing sample leaves a gap in the sparkline, which reads as
 * "we could not reach it"; a fabricated 3500 ms would read as "it answered,
 * slowly", and the badge next to it already says OFFLINE.
 *
 * @param {number|null} rttMs
 */
function normalizeSample(rttMs) {
  return typeof rttMs === "number" && isFinite(rttMs) && rttMs >= 0
    ? Math.round(rttMs)
    : null;
}

export class RelayRttHistory {
  /**
   * @param {{storageKey?: string, points?: number, limit?: number}} [opts]
   */
  constructor({ storageKey = STORAGE_KEY, points = RTT_HISTORY_POINTS } = {}) {
    this.storageKey = storageKey;
    this.points = points;
    /** @type {Map<string, Array<number|null>>} */
    this._series = new Map();
    this._load();
  }

  _load() {
    let raw = null;
    try {
      raw = localStorage.getItem(this.storageKey);
    } catch {
      return; // storage unavailable: run in memory for this page view
    }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      for (const [url, samples] of Object.entries(parsed)) {
        if (!Array.isArray(samples)) continue;
        this._series.set(
          url,
          samples.map(normalizeSample).slice(-this.points)
        );
      }
    } catch {
      // Corrupt payload: start empty rather than refuse to load the page.
      this._series.clear();
    }
  }

  _save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(Object.fromEntries(this._series)));
    } catch {
      // Quota or private mode. The series still works for this page view; it
      // just will not survive a reload, which is better than throwing from a
      // background probe path.
    }
  }

  /**
   * Append one measurement for a relay.
   *
   * @param {string} url
   * @param {number|null} rttMs - null records a failed probe as a gap
   */
  record(url, rttMs) {
    if (!url) return;
    const sample = normalizeSample(rttMs);
    const series = this._series.get(url) || [];
    series.push(sample);
    // Trim from the front: the newest samples are the ones the reader is
    // looking at.
    if (series.length > this.points) series.splice(0, series.length - this.points);
    this._series.set(url, series);
    this._save();
  }

  /**
   * The stored samples for a relay, oldest first. Always a copy: callers draw
   * from it and must not be able to mutate the stored series.
   *
   * @returns {Array<number|null>}
   */
  get(url) {
    return [...(this._series.get(url) || [])];
  }

  /**
   * The samples that actually carry a number, for min/avg/last. A gap is not
   * a zero and must not be averaged in as one.
   *
   * @returns {number[]}
   */
  measured(url) {
    return this.get(url).filter((v) => v != null);
  }

  /** Forget one relay — called when a relay is removed, so its series does not
   * linger in storage for a relay the user no longer has. */
  forget(url) {
    if (this._series.delete(url)) this._save();
  }
}

/**
 * Build the `points` attribute for a sparkline of the given samples.
 *
 * The polyline is drawn on a 0..100 by 0..40 viewBox like the history chart,
 * so this returns SVG coordinates rather than pixel values. `ceiling` is the
 * value mapped to the top of the box; passing it explicitly means every relay
 * in a column is drawn against the same scale, which is the only way the
 * shapes can be compared with each other.
 *
 * Gaps break the path. Joining across a missing sample would draw a straight
 * line through a moment the relay was unreachable, and the line would read as
 * a measurement that was taken.
 *
 * @param {Array<number|null>} samples
 * @param {number} ceiling
 * @returns {string}
 */
export function sparklinePoints(samples, ceiling) {
  if (!Array.isArray(samples) || samples.length === 0) return "";
  const top = Math.max(1, ceiling);
  const step = samples.length > 1 ? 100 / (samples.length - 1) : 0;

  const segments = [];
  let current = [];
  samples.forEach((value, i) => {
    if (value == null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    const clamped = Math.max(0, Math.min(top, value));
    const x = (samples.length > 1 ? i * step : 100).toFixed(2);
    const y = (38 - (clamped / top) * 36).toFixed(2);
    current.push(x + "," + y);
  });
  if (current.length) segments.push(current);
  return segments.map((s) => s.join(" ")).join(" ");
}