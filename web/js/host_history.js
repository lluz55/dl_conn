/* host_history.js — pure shaping for the two host-history series
 *
 * The daemon answers /api/host/history with service probe rounds and tunnel
 * incarnations. Turning either of those into something drawable is arithmetic
 * on timestamps, and it is the part most likely to quietly lie: a strip that
 * stretches a single recorded point across the whole window, or an
 * incarnation drawn as if it started at the window edge, both look correct and
 * say something untrue.
 *
 * So it lives here, with no DOM, where it can be tested directly.
 */

/** Probe outcomes, worst first. A bucket that was ever down is drawn down. */
export const SEG_UP = "up";
export const SEG_DOWN = "down";
export const SEG_UNKNOWN = "unknown";

/**
 * Lay a service's recorded probe points over `slots` cells spanning
 * [fromUnix, toUnix].
 *
 * Points are placed by their own timestamp, not by their position in the
 * array: the daemon's buckets are newest-per-bucket over the window, so the
 * index and the instant are the same thing only when nothing is missing —
 * and a host that was off for an hour returns far fewer points than it has
 * slots. Indexing them evenly would stretch that hour of silence across the
 * strip and show it as healthy.
 *
 * Cells no point falls into are unknown, never up. A strip that fills silence
 * with green is worse than an empty one: it is the one artefact that would
 * make an outage invisible.
 *
 * @param {Array<{ts:number,status:string}>} series
 * @param {number} fromUnix
 * @param {number} toUnix
 * @param {number} slots
 * @returns {string[]} exactly `slots` entries
 */
export function availabilityStrip(series, fromUnix, toUnix, slots) {
  if (!Array.isArray(series) || !series.length || slots <= 0) {
    return new Array(Math.max(0, slots)).fill(SEG_UNKNOWN);
  }
  const span = toUnix - fromUnix;
  if (span <= 0) return new Array(slots).fill(SEG_UNKNOWN);

  // null means "no point landed here yet", which is a different thing from a
  // point that recorded unknown. Pre-filling with unknown would make the
  // worst-wins comparison below reject every healthy reading — "up" ranks
  // below "unknown", so nothing could ever win its cell and the whole strip
  // would read as no data.
  const cells = new Array(slots).fill(null);
  const rank = (s) => (s === SEG_DOWN ? 2 : (s === SEG_UNKNOWN ? 1 : 0));

  for (const point of series) {
    if (!point || typeof point.ts !== "number") continue;
    if (point.ts < fromUnix || point.ts > toUnix) continue;
    // Floor so the last instant lands in the last cell rather than one past it.
    const idx = Math.min(slots - 1, Math.floor(((point.ts - fromUnix) / span) * slots));
    if (idx < 0) continue;
    if (cells[idx] === null || rank(point.status) > rank(cells[idx])) {
      cells[idx] = point.status;
    }
  }
  return cells.map((s) => (s === null ? SEG_UNKNOWN : s));
}

/**
 * The share of the window a service spent in each state, as a fraction of the
 * window's length.
 *
 * Only cells that actually carry a reading count. A window the host has not
 * been running for has no denominator, and dividing by the whole window would
 * report a 30% availability for a service that was simply never probed —
 * a number precise enough to be believed and wrong.
 *
 * @param {string[]} strip - from availabilityStrip
 * @returns {{up:number,down:number,unknown:number,known:number,percent:number|null}}
 *          percent is the share of *known* cells that were up, or null when
 *          nothing is known.
 */
export function availabilitySummary(strip) {
  const out = { up: 0, down: 0, unknown: 0, known: 0, percent: null };
  if (!Array.isArray(strip)) return out;
  for (const s of strip) {
    if (s === SEG_UP) { out.up++; out.known++; }
    else if (s === SEG_DOWN) { out.down++; out.known++; }
    else out.unknown++;
  }
  if (out.known > 0) out.percent = (out.up / out.known) * 100;
  return out;
}

/**
 * One incarnation drawn as a fraction of the window, clipped to it.
 *
 * Clipping the start is deliberate and is the whole reason this is not a
 * one-liner: an incarnation that began before the window really did begin
 * earlier, and pinning its left edge to the window boundary would invent a
 * rotation that never happened at that moment. The clip is a drawing
 * boundary, not a claim about the tunnel.
 *
 * The current incarnation has no end, so it runs to the window's right edge.
 *
 * @param {{started_at:number,ended_at:number|null}} inc
 * @param {number} fromUnix
 * @param {number} toUnix
 * @returns {{start:number,end:number,current:boolean}|null} null when it does
 *          not overlap the window at all.
 */
export function incarnationSpan(inc, fromUnix, toUnix) {
  if (!inc || typeof inc.started_at !== "number") return null;
  const span = toUnix - fromUnix;
  if (span <= 0) return null;

  const start = inc.started_at;
  const end = typeof inc.ended_at === "number" ? inc.ended_at : toUnix;
  // No overlap: it ended before the window opened, or starts after it closed.
  if (end < fromUnix || start > toUnix) return null;

  const frac = (v) => Math.max(0, Math.min(1, (v - fromUnix) / span));
  return {
    start: frac(start),
    end: frac(end),
    current: inc.ended_at == null,
  };
}

/**
 * How long each incarnation lasted, in seconds, for the tooltip.
 *
 * @param {{started_at:number,ended_at:number|null}} inc
 * @param {number} [nowUnix]
 * @returns {number}
 */
export function incarnationSeconds(inc, nowUnix) {
  if (!inc || typeof inc.started_at !== "number") return 0;
  const end = typeof inc.ended_at === "number" ? inc.ended_at : (nowUnix || Date.now() / 1000);
  return Math.max(0, Math.round(end - inc.started_at));
}