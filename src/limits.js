// Limits and pacing: how many terms, stories and cards, the sizes read, the refresh frequencies, the work budget.

/** All search terms together (watched titles and the person's own): 1 to 50. */
export const MAX_TERMS = 50;
export const TERM_CHARS = 40;
/** Google search addresses are kept under this length; terms are packed into OR searches up to it. */
export const MAX_URL = 1800;
/**
 * The stories kept: a rolling window of the newest 100 (by publication time). New ones push the oldest out, and the data
 * of a dropped story goes with it. One constant, here.
 */
export const MAX_STORIES = 100;
/** Cards on screen. */
export const MAX_CARDS = 40;
/** A story's description, at most. */
export const DESC_CHARS = 240;
export const META_TTL_MS = 24 * 3600000;
export const RETRY_MS = 3600000;
/** A page that gave nothing (slow, or it answered badly once) is read again after this, not after RETRY_MS: most are a hiccup. */
export const META_RETRY_MS = 10 * 60000;
/** Every request gives up after this long, so a step always ends inside a screen call's 20 s. */
export const PAGE_TIMEOUT_MS = 8000;
export const FREQUENCIES_MIN = [15, 30, 60, 180, 720, 1440];
/**
 * How old the news may be before the screen fetches them itself when it opens: the job's default period (manifest
 * jobs[0].everyMin). The person picks the job's real frequency in Kino's own row (Ajustes ▸ Noticias); the plugin cannot read
 * that choice, and there is no second frequency of its own.
 */
export const STALE_AFTER_MIN = 60;

/**
 * What a step may read in all: 1.6 MB, a margin under the 2 MB Kino gives a scheduled job's run (a run that crosses it is cut
 * and counts as failed). Every request asks for at most a known size (`maxBytes`), and starts only when that size still fits.
 */
export const STEP_MAX_BYTES = Math.floor(1.6 * 1024 * 1024);
/** The most each kind of answer is read up to: Google News RSS, a page's head, Google's resolver page and its answer, an article. */
export const READ_BYTES = { rss: 262144, head: 65536, resolverPage: 1000000, resolverAnswer: 16384, article: 262144 };

/** UTF-8 bytes of [text], as Kino counts a job's answers. */
export function utf8Bytes(text) {
  let n = 0;
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/**
 * How much one step may do on this kind of device. A phone (and anything else): batches of 10, the job budget (10
 * requests, 2 MB, 18 s), 400 ms between requests, 6 s between AI questions, every story enriched. A TV alone runs a lighter
 * profile: batches of 5, 5 requests, 1 MB, double spacing, pictures only for the first 8 cards, the AI only for the first 20 stories.
 */
export function budgetFor(device) {
  if (device === "tv") {
    return { batch: 5, maxFetches: 5, maxBytes: 1024 * 1024, maxMs: 18000, fetchGapMs: 800, askGapMs: 12000, enrichFirst: 8, aiFirst: 20, maxResolves: 1 };
  }
  return { batch: 10, maxFetches: 10, maxBytes: STEP_MAX_BYTES, maxMs: 18000, fetchGapMs: 400, askGapMs: 6000, enrichFirst: MAX_STORIES, aiFirst: MAX_STORIES, maxResolves: 2 };
}
