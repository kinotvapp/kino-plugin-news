// Reading the settings, the library and the storage (the screen's side, and the job's): what `step` takes.

import { editionFor } from "../feed/google-news.js";
import { matchTerm } from "../filter/adult.js";
import { budgetFor, MAX_CARDS, MAX_TERMS, STALE_AFTER_MIN } from "../limits.js";
import { KEYS, makeCache, makeSharedCache } from "../store/cache.js";
import { cleanTerms } from "../terms/terms.js";
import { validWatched, watchedTitles } from "../terms/watched.js";
import { step } from "../work/step.js";

/** This device's own store (the watched titles read last, the article texts). */
export const localOf = () => makeCache(kino.storage);
/** The cache `step` works on: kino.shared, falling back to kino.storage. */
export const cacheOf = () => makeSharedCache(typeof kino.shared === "object" ? kino.shared : null, localOf());
export const realClock = { now: () => Date.now(), sleep: (ms) => kino.sleep(Math.min(5000, Math.max(0, ms))) };
const isOn = (v, dflt) => (v === undefined || v === null ? dflt : v === true || v === "true");
const stringList = (v, max) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => x.slice(0, 200)).slice(0, max) : []);
/** The kind of device Kino says it is ("tv" or "phone"); a Kino without `kino.device` counts as a phone. */
export const deviceKind = () => (typeof kino.device === "string" && kino.device === "tv" ? "tv" : "phone");

/** The 18+ filter as stored now (on by default); only kino.config, no storage read. */
export const hideAdultNow = () => isOn(kino.config.get("hideAdult"), true);

/** The stored settings as `step` takes them (with the watched titles read last and the excluded ones). */
export function stored(lang) {
  const cache = cacheOf();
  return {
    edition: editionFor(lang),
    terms: cleanTerms(kino.config.get("terms")),
    useLibrary: isOn(kino.config.get("useLibrary"), false),
    loadMedia: isOn(kino.config.get("loadMedia"), true),
    useAi: isOn(kino.config.get("useAi"), false),
    // On by default: missing (a fresh install, an update from a version without it) counts as on.
    hideAdult: hideAdultNow(),
    libraryCount: Math.min(MAX_TERMS, Math.max(1, parseInt(kino.config.get("libraryCount"), 10) || 5)),
    frequencyMin: STALE_AFTER_MIN,
    titles: validWatched(localOf().get(KEYS.watched)),
    excluded: stringList(cache.get(KEYS.excluded), 200),
  };
}

/**
 * The watched titles (distinct, newest first, at most 50), read from kino.library and kept in the cache so a timer tick uses
 * the last list read. Only called from what the person does. `{ titles, denied }`; when Kino refuses, the stored list stays.
 */
export async function readWatched() {
  const cache = localOf();
  if (typeof kino.library !== "object") return { titles: validWatched(cache.get(KEYS.watched)), denied: false };
  try {
    const titles = watchedTitles(await kino.library.watched({ limit: 100 }), 100);
    cache.set(KEYS.watched, titles);
    return { titles, denied: false };
  } catch (e) {
    console.log("library not readable: " + (e && e.code ? e.code : e && e.message));
    return { titles: validWatched(cache.get(KEYS.watched)), denied: !!(e && e.code === "permission_denied") };
  }
}

/** A stored story as a card in the screen's state: no Google link (the pop-up reads the record), why it is here. */
export function cardOf(rec, terms, loadMedia) {
  const m = matchTerm(rec.t, terms);
  return {
    id: rec.id, title: rec.t, source: rec.s, ts: rec.p, cat: rec.c, term: m ? m.term : null, from: m ? m.from : null,
    image: loadMedia ? rec.i : null, desc: loadMedia ? rec.d : "",
  };
}

/** The feed for the screen from one `step`: `{ feed, changed }`. [personStarted]: the library may be read now. */
export async function loadFeed(lang, { force = false, personStarted = true } = {}) {
  const s = stored(lang);
  let denied = false;
  if (s.useLibrary && personStarted) {
    const w = await readWatched();
    s.titles = w.titles;
    denied = w.denied;
  }
  // No AI here: Kino answers it only in the job and after the person's own tap («Clasificar ahora»).
  const r = await step(cacheOf(), kino.fetch, { ...s, force }, realClock, budgetFor(deviceKind()), null);
  console.log("step: " + r.fetches + " requests, " + Math.round(r.bytes / 1024) + " KB, " + r.ms + " ms, " + r.stories.length + " stories, done " + JSON.stringify(r.done));
  return {
    feed: {
      items: r.stories.slice(0, MAX_CARDS).map((x) => cardOf(x, r.terms, s.loadMedia)), fetchedAt: r.fetchedAt,
      failed: r.failed && r.stories.length === 0, stale: r.failed && r.stories.length > 0, terms: r.terms.length, libraryDenied: denied,
    },
    changed: r.changed,
  };
}
