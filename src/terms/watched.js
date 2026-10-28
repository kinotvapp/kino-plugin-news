// What the person watched (kino.library) as search terms: the titles, their kinds, which are excluded (pure).

import { MAX_TERMS } from "../limits.js";
import { termOf } from "../util/text.js";

/** The key of a watched title in the excluded list: its kind and its title ("series:avatar"). */
export const watchedKey = (w) => w.kind + ":" + termOf(w.title).toLowerCase();

/**
 * The distinct watched works of `kino.library.watched()` entries, newest first: `[{ title, kind, year? }]` (`kind` is
 * "movie" or "series", what the library gives; `year` only when it has one). The same title and kind once; the same title
 * watched as a movie and as a series twice. Left out: an entry in [excluded] ("kind:title" for a removed row, or a plain
 * title for one of the person's own terms, which covers both kinds). At most [count].
 */
export function watchedTitles(entries, count, excluded = []) {
  const n = Math.min(MAX_TERMS, Math.max(0, Math.floor(Number(count)) || 0));
  const out = [];
  const skip = new Set((Array.isArray(excluded) ? excluded : []).map((x) => String(x).toLowerCase()));
  const seen = new Set();
  for (const e of Array.isArray(entries) ? entries : []) {
    if (out.length >= n) break;
    if (!e || (e.kind !== "movie" && e.kind !== "series") || typeof e.title !== "string") continue;
    const t = termOf(e.title);
    if (!t) continue;
    const w = { title: t, kind: e.kind };
    if (Number.isInteger(e.year) && e.year > 1800 && e.year < 3000) w.year = e.year;
    const k = watchedKey(w);
    if (seen.has(k) || skip.has(k) || skip.has(t.toLowerCase())) continue;
    seen.add(k);
    out.push(w);
  }
  return out;
}

/** Watched works read back from the cache or the state (outside input): only well-formed ones; a plain string is a movie. */
export function validWatched(raw, max = 100) {
  const entries = (Array.isArray(raw) ? raw.slice(0, max * 2) : []).map((x) => (typeof x === "string" ? { title: x, kind: "movie" } : x));
  return watchedTitles(entries, max);
}

/** How many watched titles fit beside [customCount] terms of the person's own: [libraryCount] clamped to 1..50 and the total to 50. */
export function watchedRoom(libraryCount, customCount) {
  const asked = Math.min(MAX_TERMS, Math.max(1, Math.floor(Number(libraryCount)) || 5));
  return Math.max(0, Math.min(asked, MAX_TERMS - customCount));
}
