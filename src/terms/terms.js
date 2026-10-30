// The person's terms and the watched titles turned into Google News queries, batched and picked in turn (pure).

import { EDITIONS, googleNewsUrl } from "../feed/google-news.js";
import { isAdult } from "../filter/adult.js";
import { MAX_TERMS, MAX_URL } from "../limits.js";
import { validWatched, watchedRoom, watchedTitles } from "./watched.js";
import { termOf } from "../util/text.js";

/** The person's terms (records `{ term }` of the list setting, or plain strings): trimmed, cut at 40, distinct, at most 50. */
export function cleanTerms(raw) {
  const out = [];
  const seen = new Set();
  for (const e of Array.isArray(raw) ? raw : []) {
    const t = termOf(typeof e === "string" ? e : e && typeof e.term === "string" ? e.term : "");
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

/**
 * Adding [text] to the person's [terms] beside [watchedCount] watched titles: `{ terms }` with it at the end, or
 * `{ terms, error }` ("empty", "duplicate", "full": 50 in all) and the list unchanged.
 */
export function addTerm(terms, text, watchedCount = 0) {
  const list = cleanTerms(terms);
  const t = termOf(text);
  if (!t) return { terms: list, error: "empty" };
  if (list.some((x) => x.toLowerCase() === t.toLowerCase())) return { terms: list, error: "duplicate" };
  if (list.length + watchedCount >= MAX_TERMS) return { terms: list, error: "full" };
  return { terms: [...list, t] };
}

/**
 * Every search term of the feed: `[{ term, from: "term" | "watched" }]`, the person's own first, then (only when
 * [useLibrary] is on) the most recent watched [titles] not [excluded], as many as fit (50 in all). None means nothing is read.
 * With [hideAdult] (the default) a term or watched title that looks 18+ (`isAdult`) is left out: Google is never asked for it.
 */
export function buildTerms({ terms = [], titles = [], excluded = [], useLibrary = false, libraryCount = 5, hideAdult = true } = {}) {
  const out = [];
  const hide = hideAdult !== false;
  const own = cleanTerms(terms).filter((t) => !(hide && isAdult(t)));
  for (const t of own) out.push({ term: t, from: "term" });
  if (useLibrary) {
    const usable = validWatched(titles).filter((w) => !(hide && isAdult(w.title)));
    for (const w of watchedTitles(usable, watchedRoom(libraryCount, own.length), [...(Array.isArray(excluded) ? excluded : []), ...own])) {
      out.push({ term: w.title, from: "watched", kind: w.kind });
    }
  }
  return out;
}

/** The words that say "movie" and "series" to Google News, by the edition's language; others use the English ones. */
const QUALIFIERS = {
  es: { movie: "película", series: "serie" },
  en: { movie: "movie", series: "\"TV series\"" },
  pt: { movie: "filme", series: "série" },
  fr: { movie: "film", series: "série" },
};

/** The word that narrows a watched title to its kind in [edition]'s language ("" for an unknown kind). */
export function qualifierFor(edition, kind) {
  const e = EDITIONS[edition] || EDITIONS.co;
  const words = QUALIFIERS[e.hl.slice(0, 2).toLowerCase()] || QUALIFIERS.en;
  return words[kind] || "";
}

/**
 * One term as Google News reads it. The person's own term is used as written (its double quotes dropped, in quotes when it
 * has more than one word). A watched title is an exact phrase narrowed to its kind, in parentheses so the OR around it
 * keeps the AND inside: `("Avatar" película)`.
 */
export function termQuery(term, kind = null, edition = "co") {
  const t = termOf(term).replace(/"/g, "").trim();
  if (!t) return "";
  if (kind) {
    const q = qualifierFor(edition, kind);
    return q ? "(\"" + t + "\" " + q + ")" : "\"" + t + "\"";
  }
  return /\s/.test(t) ? "\"" + t + "\"" : t;
}

/** The terms packed into searches `a OR "b c" OR d`, each search's address (in [edition]) under [maxUrl]: `[{ q, terms }]`. */
export function batchQueries(terms, edition, maxUrl = MAX_URL) {
  const out = [];
  let current = null;
  for (const { term, from, kind } of terms) {
    const part = termQuery(term, from === "watched" ? kind : null, edition);
    if (!part) continue;
    if (current) {
      const q = current.q + " OR " + part;
      if (googleNewsUrl({ q, edition }).length <= maxUrl) {
        current.q = q;
        current.terms.push(term);
        continue;
      }
      out.push(current);
    }
    current = { q: part, terms: [term] };
  }
  if (current) out.push(current);
  return out;
}

/** The searches of this step: at most [max] batches from [cursor] on (wrapping); `{ chosen, next }`, next the cursor after them. */
export function pickBatches(batches, cursor, max = 10) {
  const n = batches.length;
  if (n <= max) return { chosen: batches.slice(), next: 0 };
  const start = ((Math.floor(Number(cursor)) || 0) % n + n) % n;
  const chosen = [];
  for (let i = 0; i < max; i++) chosen.push(batches[(start + i) % n]);
  return { chosen, next: (start + max) % n };
}
