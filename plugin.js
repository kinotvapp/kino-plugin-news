// Solo noticias (Just News): a Kino plugin with a screen of its own and a background job (apiVersion 14). Two tabs:
//
// - Noticias: a Google News feed (news.google.com RSS, no key) drawn as a grid of cards (one per row on a phone, two on a
//   medium window, three on a TV). It searches the person's own terms and, only when they switch it on, the titles of the
//   movies and series they watched most recently (kino.library), each narrowed to its kind ("Avatar" película). With no term
//   at all it shows the top stories of the edition that matches Kino's language. Google's feed has no pictures, so (when the
//   person allows it) the plugin finds each story's page and reads its picture and description from the page's head; a
//   card without one shows a placeholder with the outlet's initial. A story opens in a pop-up with its text read from the
//   outlet's page and «Ver noticia», which opens the page in the browser after Kino asks the person.
// - Configuración: how often the news refresh, pictures and texts from the outlets, sorting with Kino's text AI (off by
//   default, «Clasificar ahora»), «Usar lo que he visto» and how many titles, the watched titles as removable rows with their
//   kind, the person's own terms (a pop-up adds one). Every change is saved at once.
//
// The work runs in small, budgeted steps through ONE pure function, `step(cache, fetch, settings, clock, budget, ask)`: Kino's
// scheduled job calls it in the background (runOn "preferPhone": the linked phone does it and the result syncs through
// kino.shared), and the screen calls it when it opens (only fetching what is stale) and on a timer while it is open. The
// runtime has no XML or HTML parser, so everything is read by the small pure functions below (exported so the kit tests them
// on saved samples).
//
// The state lives in Kino, never here: `screen` is a pure view of it, `screenEvent` answers with a patch. Every text the
// person reads has a Spanish base and an English twin (`textEn`, `labelEn`...), and Kino picks one by its language.

const GOOGLE_NEWS = "https://news.google.com/rss";
const MAX_ITEMS = 60; // stories read from one RSS answer
// ---------- reading Google News (pure functions) ----------

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", iexcl: "¡", iquest: "¿", middot: "·", deg: "°", euro: "€", copy: "©", reg: "®",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü", ccedil: "ç", agrave: "à", egrave: "è",
  atilde: "ã", otilde: "õ", acirc: "â", ecirc: "ê", ocirc: "ô",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Uuml: "Ü", Ccedil: "Ç",
};

/** Decodes HTML entities (&amp;, &#8217;, &#x2014;...); an unknown one stays as written. */
export function decodeEntities(s) {
  return String(s || "").replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,7});/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const known = ENTITIES[name] !== undefined ? ENTITIES[name] : ENTITIES[name.toLowerCase()];
    return known === undefined ? whole : known;
  });
}

/** Plain text: spaces collapsed, cut at [max] characters with an ellipsis. */
function clip(s, max) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** HTML to plain text: tags dropped, entities decoded, spaces collapsed. */
export function stripHtml(s) {
  return clip(decodeEntities(String(s || "").replace(/<[^>]*>/g, " ")), 2000);
}

const EDITIONS = {
  co: { hl: "es-419", gl: "CO", ceid: "CO:es-419" },
  us: { hl: "en-US", gl: "US", ceid: "US:en" },
};

/** The edition for Kino's language: English reads the US edition, anything else the Latin American Spanish one (Colombia). */
export function editionFor(lang) {
  return String(lang || "").startsWith("en") ? "us" : "co";
}

/** The feed's address: the top stories (no q) or a search [q], in [edition] ("co" or "us"; anything else is "co"). */
export function googleNewsUrl({ q = "", edition = "co" } = {}) {
  const e = EDITIONS[edition] || EDITIONS.co;
  const tail = "hl=" + e.hl + "&gl=" + e.gl + "&ceid=" + encodeURIComponent(e.ceid);
  const query = String(q || "").trim();
  if (query !== "") return GOOGLE_NEWS + "/search?q=" + encodeURIComponent(query.slice(0, MAX_URL)) + "&" + tail;
  return GOOGLE_NEWS + "?" + tail;
}

/** The raw text of the first <tag>…</tag> in [xml] (CDATA unwrapped, entities decoded once), else "". */
function tagText(xml, tag) {
  const m = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "i").exec(xml);
  if (!m) return "";
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(m[1]);
  return cdata ? cdata[1] : decodeEntities(m[1]);
}

const MONTHS_RFC = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Mon, 26 Oct 2026 23:43:01 GMT" as milliseconds since 1970 (UTC; a numeric zone like +0200 is applied), else 0. */
export function rfcTime(s) {
  const m = /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\s+([+-]\d{4}|[A-Za-z]+))?/.exec(String(s || ""));
  if (!m) return 0;
  const month = MONTHS_RFC.indexOf(m[2].toLowerCase());
  if (month < 0) return 0;
  let t = Date.UTC(Number(m[3]), month, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  if (m[7] && /^[+-]\d{4}$/.test(m[7])) {
    const sign = m[7][0] === "-" ? -1 : 1;
    t -= sign * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(3, 5))) * 60000;
  }
  return Number.isFinite(t) ? t : 0;
}

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** How long ago [ts] was at [now], in Spanish or English ("hace 5 min", "3 h ago"); a week or more: the date. */
export function timeAgo(ts, now, en) {
  if (!ts) return "";
  const min = Math.floor((now - ts) / 60000);
  if (min < 1) return en ? "just now" : "ahora";
  if (min < 60) return en ? min + " min ago" : "hace " + min + " min";
  const h = Math.floor(min / 60);
  if (h < 24) return en ? h + " h ago" : "hace " + h + " h";
  const d = Math.floor(h / 24);
  if (d < 7) return en ? (d === 1 ? "1 day ago" : d + " days ago") : (d === 1 ? "hace 1 día" : "hace " + d + " días");
  const date = new Date(ts);
  const mon = (en ? MONTHS_EN : MONTHS_ES)[date.getUTCMonth()];
  return en ? mon + " " + date.getUTCDate() + ", " + date.getUTCFullYear() : date.getUTCDate() + " " + mon + " " + date.getUTCFullYear();
}

/** Bytes of url-safe or plain base64 (padding optional) as a binary string; null when it is not base64. */
function base64Bytes(s) {
  const plain = s.replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]+=*$/.test(plain)) return null;
  try { return atob(plain + "===".slice((plain.length + 3) % 4)); } catch (e) { return null; }
}

/**
 * The publisher's address hidden in a Google News article link (news.google.com/rss/articles/<token>). The older tokens are
 * url-safe base64 of a small protobuf that holds the address as text; the newer ones (they decode to "AU_yqL…") are
 * opaque and only Google can resolve them: then null, and the screen keeps Google's own link.
 */
export function decodeArticleUrl(link) {
  const m = /\/rss\/articles\/([A-Za-z0-9_-]+)/.exec(String(link || ""));
  if (!m) return null;
  const bytes = base64Bytes(m[1]);
  if (bytes === null) return null;
  const at = bytes.search(/https?:\/\//);
  if (at < 0) return null;
  // The address runs until the first byte that cannot be in a URL (the next protobuf field starts there).
  const url = /^https?:\/\/[\x21-\x7e]+/.exec(bytes.slice(at));
  return url && url[0].length <= 1000 ? url[0] : null;
}

/**
 * The other outlets an item's description lists (Google's "full coverage": an <ol> of <li><a>title</a> <font>source</font>),
 * without the item's own entry: `[{ title, source }]`, at most [max].
 */
export function relatedOf(descriptionHtml, ownTitle, max = 3) {
  const out = [];
  const lis = String(descriptionHtml || "").match(/<li>[\s\S]*?<\/li>/gi) || [];
  for (const li of lis) {
    const a = /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(li);
    const font = /<font\b[^>]*>([\s\S]*?)<\/font>/i.exec(li);
    const title = clip(stripHtml(a ? a[1] : ""), 160);
    if (!title || (ownTitle && title.startsWith(ownTitle))) continue;
    out.push({ title, source: clip(stripHtml(font ? font[1] : ""), 60) });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The items of a Google News RSS document: `{ id, title, source, ts, link, url, related }`; `url` is the publisher's address
 * when Google's link carries it, else null. Items without an https link or with a repeated guid are dropped.
 */
export function parseGoogleNews(xml, max = MAX_ITEMS) {
  const out = [];
  const seen = new Set();
  const items = String(xml || "").match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const item of items) {
    if (out.length >= max) break;
    const link = tagText(item, "link").trim();
    const guid = tagText(item, "guid").trim() || link;
    let title = clip(tagText(item, "title"), 200);
    const source = clip(tagText(item, "source"), 60);
    // Google's titles end with " - <source>": the source has its own line.
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3)).trim();
    if (!title || !link.startsWith("https://") || seen.has(guid)) continue;
    seen.add(guid);
    out.push({
      id: "g" + out.length,
      title,
      source,
      ts: rfcTime(tagText(item, "pubDate")),
      link: link.slice(0, 1000),
      url: decodeArticleUrl(link),
      related: relatedOf(tagText(item, "description"), title),
    });
  }
  return out;
}

// ---------- the cache: one small adapter ----------
//
// Everything the plugin keeps goes through `cache.get(key)` / `cache.set(key, value)` (JSON values). The feed, the stories,
// the work state and the excluded titles live in kino.shared, so the device that does the work (a linked phone, by the job's
// runOn "preferPhone") hands the result to the others; without kino.shared (an older Kino, or a refused write) they fall back
// to kino.storage on this device. What comes back is checked like any outside input: another device, maybe another version
// of this plugin, wrote it.

/** The cache adapter over a `{ get, set }` string store (kino.storage): JSON in, JSON out; a value over [maxBytes] is refused. */
export function makeCache(store, maxBytes = 256 * 1024) {
  let written = 0;
  return {
    get(key) {
      try { return JSON.parse(store.get(key) || "null"); } catch (e) { return null; }
    },
    set(key, value) {
      const text = JSON.stringify(value);
      if (text.length > maxBytes) throw new Error("cache value over " + maxBytes + " bytes: " + key);
      written += text.length;
      store.set(key, text);
    },
    /** Characters written through this adapter so far. */
    written: () => written,
  };
}

/**
 * The cache adapter over kino.shared ([shared]: `{ get, set }` of JSON values), with [fallback] (a `makeCache`) for when it
 * is missing or refuses: a value is read from kino.shared, else from the fallback; a write goes to kino.shared, else to the
 * fallback. A value equal to the one last read or written is not written again (kino.shared counts writes a minute).
 */
export function makeSharedCache(shared, fallback) {
  const last = new Map();
  let written = 0;
  const usable = shared && typeof shared.get === "function" && typeof shared.set === "function";
  return {
    get(key) {
      let v = null;
      if (usable) { try { v = shared.get(key); } catch (e) { v = null; } }
      if (v === null || v === undefined) v = fallback.get(key);
      last.set(key, JSON.stringify(v));
      return v;
    },
    set(key, value) {
      const text = JSON.stringify(value);
      if (last.get(key) === text) return;
      if (text.length > 64 * 1024) throw new Error("shared value over 64 KB: " + key);
      last.set(key, text);
      written += text.length;
      if (usable) {
        try { shared.set(key, value); return; } catch (e) { /* not allowed, too large or too many writes: keep it here */ }
      }
      fallback.set(key, value);
    },
    written: () => written,
  };
}

/** The keys the plugin uses: in kino.shared (at most 4: feed, stories, work, excluded) and, on this device only, the rest. */
export const KEYS = { feed: "feed", stories: "stories", work: "work", excluded: "excluded", watched: "watched" };
/** The stories' value is kept under this many characters of JSON (kino.shared takes 64 KB a value). */
export const STORIES_MAX_CHARS = 60000;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const httpsOrNull = (v, max = 1000) => (typeof v === "string" && /^https:\/\/[^\s]+$/i.test(v) && v.length <= max ? v : null);
const time = (v) => (Number.isFinite(v) && v > 0 ? v : 0);

// ---------- limits and pacing ----------

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
/** Every request gives up after this long, so a step always ends inside a screen call's 20 s. */
const PAGE_TIMEOUT_MS = 5000;
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

// ---------- the person's terms and what they watched (pure) ----------

const termOf = (raw) => String(raw || "").replace(/\s+/g, " ").trim().slice(0, TERM_CHARS).trim();

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

/**
 * Every search term of the feed: `[{ term, from: "term" | "watched" }]`, the person's own first, then (only when
 * [useLibrary] is on) the most recent watched [titles] not [excluded], as many as fit (50 in all). None means top stories.
 */
export function buildTerms({ terms = [], titles = [], excluded = [], useLibrary = false, libraryCount = 5 } = {}) {
  const out = [];
  const own = cleanTerms(terms);
  for (const t of own) out.push({ term: t, from: "term" });
  if (useLibrary) {
    for (const w of watchedTitles(validWatched(titles), watchedRoom(libraryCount, own.length), [...(Array.isArray(excluded) ? excluded : []), ...own])) {
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

/** The minutes of the refresh setting as milliseconds (15 min to 24 h; anything else is 1 h). */
export function frequencyMs(minutes) {
  const m = Number(minutes);
  return (FREQUENCIES_MIN.includes(m) ? m : 60) * 60000;
}

/** What identifies a feed: the edition and the terms. Another edition or other terms make it stale at once. */
export function feedKeyOf(edition, terms) {
  return edition + "|" + terms.map((x) => (x.from === "watched" ? x.kind + ":" : "") + x.term.toLowerCase()).join("\n");
}

/** True when [feed] answers [key] and was fetched less than [everyMs] before [now] (a clock set back makes it stale). */
export function isFresh(feed, key, now, everyMs) {
  return isObj(feed) && feed.key === key && typeof feed.fetchedAt === "number" && now >= feed.fetchedAt && now - feed.fetchedAt < everyMs;
}

const fold = (s) => {
  let t = String(s || "").toLowerCase();
  try { t = t.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) { /* no normalize: plain lowercase */ }
  return t;
};

/**
 * The term (`{ term, from }`) whose words all appear in [title], accents and case aside: the most specific (most words)
 * when several do, so a story about "Avatar: The Last Airbender" names the series, not the movie "Avatar"; else null.
 */
export function matchTerm(title, terms) {
  const t = fold(title);
  const bySpecific = [...terms].sort((a, b) => fold(b.term).split(/\s+/).length - fold(a.term).split(/\s+/).length);
  for (const x of bySpecific) {
    const words = fold(x.term).replace(/"/g, "").split(/\s+/).filter(Boolean);
    if (words.length && words.every((w) => t.includes(w))) return x;
  }
  return null;
}

/** A story's id: a short, stable hash of its Google link, so its data and category survive a new feed. */
export function storyId(link) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const ch of String(link)) {
    const c = ch.codePointAt(0);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x9e3779b1) >>> 0;
  }
  return "s" + h1.toString(36) + h2.toString(36);
}

// ---------- the stored story: compact, no HTML, no pictures ----------
//
// One record per story, short keys: id; t title; s source; p publication time (ms); g Google's article link, kept only
// until the outlet's address is known; u the outlet's address; i the picture's address; d the description (at most 240);
// c the category and a (1 when the AI chose it, else a keyword guess); r when the address was last looked for; m when the
// page was last read, ok whether it gave a picture or a description; q when the AI was last asked about it.

/** A parsed RSS item as a new stored record (an older Google token gives the outlet's address at once). */
function recordOf(item) {
  const u = item.url && /^https:/i.test(item.url) ? item.url : null;
  return { id: storyId(item.link), t: item.title, s: item.source || "", p: item.ts || 0, g: u ? null : item.link, u, i: null, d: "", c: guessCategory(item.title), a: 0, r: 0, m: 0, ok: false, q: 0 };
}

/** One stored record read back from the cache: only well-formed fields, or null. */
export function validRecord(x) {
  if (!isObj(x) || typeof x.id !== "string" || !/^s[0-9a-z]{2,20}$/.test(x.id) || typeof x.t !== "string" || !x.t.trim()) return null;
  const g = httpsOrNull(x.g, 1200);
  const u = httpsOrNull(x.u);
  if (!g && !u) return null;
  return {
    id: x.id, t: x.t.slice(0, 200), s: str(x.s, 60), p: time(x.p), g: u ? null : g, u, i: httpsOrNull(x.i), d: str(x.d, DESC_CHARS),
    c: CATEGORY_KEYS.includes(x.c) ? x.c : "other", a: x.a === 1 ? 1 : 0, r: time(x.r), m: time(x.m), ok: x.ok === true, q: time(x.q),
  };
}

/** The stored stories read back: valid records only, distinct ids, at most MAX_STORIES. */
export function validStories(raw) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(raw) ? raw.slice(0, MAX_STORIES * 2) : []) {
    const r = validRecord(x);
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
    if (out.length >= MAX_STORIES) break;
  }
  return out;
}

/**
 * The window after new search results: [stored] records and the parsed [lists] together (a story already known keeps its
 * record and its data; the same title from another outlet counts once), newest first, the newest [max] kept; the rest is
 * dropped with everything known about it.
 */
export function mergeWindow(stored, lists, max = MAX_STORIES) {
  const byId = new Map(stored.map((x) => [x.id, x]));
  const titles = new Set(stored.map((x) => x.t.toLowerCase().replace(/\s+/g, " ")));
  const out = [...stored];
  for (const item of lists.flat()) {
    const id = storyId(item.link);
    const t = item.title.toLowerCase().replace(/\s+/g, " ");
    if (byId.has(id) || titles.has(t)) continue;
    const rec = recordOf(item);
    byId.set(id, rec);
    titles.add(t);
    out.push(rec);
  }
  out.sort((a, b) => b.p - a.p);
  return fitSize(out.slice(0, max));
}

/** [stories] (newest first) without the oldest ones until their JSON fits STORIES_MAX_CHARS. */
export function fitSize(stories, maxChars = STORIES_MAX_CHARS) {
  const out = stories.slice();
  while (out.length && JSON.stringify(out).length > maxChars) out.pop();
  return out;
}

// ---------- categories: a keyword guess, and Kino's text AI when the person turns it on ----------

export const CATEGORIES = [
  { value: "world", label: "Mundo", labelEn: "World" },
  { value: "politics", label: "Política", labelEn: "Politics" },
  { value: "business", label: "Economía", labelEn: "Business" },
  { value: "tech", label: "Tecnología", labelEn: "Technology" },
  { value: "science", label: "Ciencia", labelEn: "Science" },
  { value: "health", label: "Salud", labelEn: "Health" },
  { value: "sports", label: "Deportes", labelEn: "Sports" },
  { value: "entertainment", label: "Entretenimiento", labelEn: "Entertainment" },
  { value: "film", label: "Cine y TV", labelEn: "Film & TV" },
  { value: "other", label: "Otros", labelEn: "Other" },
];
const CATEGORY_KEYS = CATEGORIES.map((c) => c.value);

// Most specific first: a film's box office is film, not business.
const KEYWORDS = [
  ["film", ["pelicula", "serie ", "series", "estreno", "taquilla", "netflix", "hbo", "disney", "anime", "trailer", "film", "movie", "episode", "episodio", "temporada", "season", "box office", "oscar", "cine", "actor", "actriz", "actress"]],
  ["sports", ["futbol", "gol ", "goles", "liga", "copa", "partido", "seleccion", "mundial", "balon de oro", "tenis", "nba", "nfl", "formula 1", "ciclismo", "beisbol", "football", "soccer", "tournament", "torneo", "olimpic", "olympic", "champions"]],
  ["tech", ["tecnologia", "inteligencia artificial", " ia ", " ai ", " app ", "iphone", "android", "google", "apple", "microsoft", "software", "ciberataque", "hacker", "smartphone", "openai", "technology", "startup", "videojuego", "video game", "consola"]],
  ["science", ["ciencia", "cientific", "investigadores", "estudio revela", "fisica", "quimica", "biologia", "science", "scientist", "researchers", "study finds"]],
  ["health", ["salud", "hospital", "vacuna", "virus", "medic", "enfermedad", "cancer", "covid", "dengue", "health", "vaccine", "disease", "doctor", "epidemia", "pandemia"]],
  ["business", ["economia", "dolar", "inflacion", "mercado", "bolsa", "empresa", "banco", "precio", "petroleo", "exportacion", "economy", "market", "stocks", "bank", "inflation", "price", "oil ", "business", "comercio", "aranceles", "tariff"]],
  ["politics", ["presidente", "gobierno", "congreso", "senado", "eleccion", "ministro", "fiscalia", "partido politico", "alcalde", "gobernador", "president", "government", "election", "senate", "minister", "parliament", "corte", "court"]],
  ["world", ["guerra", "onu", "ucrania", "rusia", "israel", "gaza", "china", "europa", "internacional", "war ", "united nations", "ukraine", "russia", "europe", "embajada", "migrantes", "migrants"]],
  ["entertainment", ["musica", "concierto", "cantante", "album", "festival", "farandula", "celebridad", "music", "concert", "singer", "celebrity", "reality", "premios", "awards", "influencer"]],
];

/** A category from the title's words (accents and case aside), the fallback while the AI is off, unavailable or wrong. */
export function guessCategory(title) {
  const t = " " + fold(title).replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ") + " ";
  for (const [category, words] of KEYWORDS) if (words.some((w) => t.includes(w))) return category;
  return "other";
}

/**
 * The question for the AI: `{ system, prompt }` with only `[{ id, title }]` (at most [max], titles at most 200 characters)
 * and the fixed category list; the answer must be JSON only, `[{ id, category }]`.
 */
export function buildCategoryPrompt(stories, max = 40) {
  const items = stories.slice(0, max).map((s) => ({ id: String(s.id), title: String(s.t !== undefined ? s.t : s.title).slice(0, 200) }));
  return {
    system: "You classify news headlines. Answer with JSON only: an array of {\"id\": string, \"category\": string}, one per headline, " +
      "using exactly one of these categories: " + CATEGORY_KEYS.join(", ") + ". Use \"other\" when none fits. No prose, no code fences.",
    prompt: JSON.stringify(items),
  };
}

/**
 * The AI's answer read strictly: `{ [id]: category }` for the ids of [stories] only and known categories only (an unknown
 * one becomes "other"). JSON inside prose or code fences is found; anything unreadable gives `{}`. Never throws.
 */
export function parseCategories(text, stories) {
  const ids = new Set(stories.map((s) => String(s.id)));
  const s = String(text || "");
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start < 0 || end <= start) return {};
  let rows;
  try { rows = JSON.parse(s.slice(start, end + 1)); } catch (e) { return {}; }
  const out = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!isObj(r) || typeof r.id !== "string" || !ids.has(r.id) || out[r.id]) continue;
    const c = typeof r.category === "string" ? r.category.trim().toLowerCase() : "";
    out[r.id] = CATEGORY_KEYS.includes(c) ? c : "other";
  }
  return out;
}

/**
 * Kino's text AI (`kino.ai.ask`, capability "ai", the person's approval): one question, JSON asked for, the reply's text or
 * null (no AI on this Kino, refused, unavailable, rate limited, timed out). Kino only answers it inside the scheduled job or an
 * event that follows the person's tap («Clasificar ahora»), never on open or a timer tick. The reply is untrusted:
 * `parseCategories` keeps only known ids and categories.
 */
export async function askAi(prompt, system) {
  if (typeof kino === "undefined" || typeof kino.ai !== "object" || typeof kino.ai.ask !== "function") return null;
  const r = await kino.ai.ask({ prompt, system, json: true, maxChars: 1500 });
  return r && r.ok === true && typeof r.text === "string" ? r.text : null;
}

// ---------- a story's page: Google's article link to the outlet's address, then its picture (pure) ----------

/**
 * The parameters Google's article page carries for its own resolver (unofficial, may change at any time): the article id,
 * a timestamp and a signature (`data-n-a-id`, `data-n-a-ts`, `data-n-a-sg`). Null when the page has none of them.
 */
export function parseArticleParams(html) {
  const s = String(html || "");
  const attr = (name) => {
    const m = new RegExp(name + "=\"([^\"]+)\"").exec(s);
    return m ? m[1] : null;
  };
  const id = attr("data-n-a-id");
  const ts = attr("data-n-a-ts");
  const sg = attr("data-n-a-sg");
  if (!id || !sg || !/^\d+$/.test(ts || "")) return null;
  return { id, ts: Number(ts), sg };
}

/** The request Google's own page makes to turn an article id into the outlet's address (the "Fbv4je" call, unofficial). */
export function batchExecuteRequest({ id, ts, sg }) {
  const inner = JSON.stringify([
    "garturlreq",
    [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    id, ts, sg,
  ]);
  return {
    url: "https://news.google.com/_/DotsSplashUi/data/batchexecute",
    form: { "f.req": JSON.stringify([[["Fbv4je", inner, null, "generic"]]]) },
  };
}

/** The outlet's address in the answer to [batchExecuteRequest] (`)]}'` then JSON lines), else null. */
export function parseBatchExecute(text) {
  const lines = String(text || "").replace(/^\)\]\}'\s*/, "").split("\n");
  for (const line of lines) {
    if (!line.trim().startsWith("[")) continue;
    let rows;
    try { rows = JSON.parse(line); } catch (e) { continue; }
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!Array.isArray(row) || row[0] !== "wrb.fr" || row[1] !== "Fbv4je" || typeof row[2] !== "string") continue;
      try {
        const inner = JSON.parse(row[2]);
        if (Array.isArray(inner) && inner[0] === "garturlres" && /^https?:\/\//.test(inner[1] || "")) return String(inner[1]).slice(0, 1000);
      } catch (e) { /* not this row */ }
    }
  }
  return null;
}

/** [ref] (absolute, //host, /path or relative) against the page [base]; only https comes back, else null. */
export function resolveHttps(ref, base) {
  const r = decodeEntities(String(ref || "").trim());
  if (!r) return null;
  let out = null;
  if (/^https:\/\//i.test(r)) out = r;
  else if (/^\/\//.test(r)) out = "https:" + r;
  else if (/^[a-z][a-z0-9+.-]*:/i.test(r)) out = null;
  else {
    const m = /^(https:\/\/[^/?#]+)([^?#]*)/i.exec(String(base || ""));
    if (m) out = r.startsWith("/") ? m[1] + r : m[1] + m[2].replace(/[^/]*$/, "") + r;
  }
  return out && /^https:\/\/[^/\s]+\.[^/\s]+/i.test(out) && !/\s/.test(out) && out.length <= 1000 ? out : null;
}

/** The page up to the end of its head (or [max] characters): the part with the metadata; the rest is dropped at once. */
export function headOf(html, max = 65536) {
  const s = String(html || "").slice(0, max);
  const end = s.search(/<\/head\s*>/i);
  return end >= 0 ? s.slice(0, end) : s;
}

/**
 * What a page's head says about it: `{ image, description, title, site }` from Open Graph and Twitter cards (then the
 * plain description). Text is decoded, stripped and cut; a picture is resolved against [pageUrl] and kept only on https.
 */
export function parsePageMeta(html, pageUrl) {
  const metas = {};
  for (const tag of headOf(html).match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    for (const m of tag.matchAll(/([a-zA-Z_:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? "";
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (key && attrs.content !== undefined && metas[key] === undefined) metas[key] = attrs.content;
  }
  const first = (...keys) => keys.map((k) => metas[k]).find((v) => v !== undefined && String(v).trim() !== "");
  const text = (v, max) => (v === undefined ? "" : clip(stripHtml(v), max));
  let image = null;
  for (const k of ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src", "image"]) {
    image = metas[k] ? resolveHttps(metas[k], pageUrl) : null;
    if (image) break;
  }
  return {
    image,
    description: text(first("og:description", "twitter:description", "description"), DESC_CHARS),
    title: text(first("og:title", "twitter:title"), 200),
    site: text(first("og:site_name", "application-name"), 60),
  };
}

// ---------- the work queue: one step at a time, within a budget ----------

/**
 * A budget for one step: [b] (see `budgetFor`) against [clock] (`{ now(), sleep(ms) }`). `fetch` waits `fetchGapMs` after
 * the previous request (on the injected clock), counts each request and the size of each answer, and refuses (an error
 * with `budget: true`) once any limit is reached.
 */
export function budgeted(fetch, b, clock) {
  const limits = { ...budgetFor("phone"), ...(b || {}) };
  const started = clock.now();
  const u = { fetches: 0, bytes: 0, last: null, limits };
  u.elapsed = () => clock.now() - started;
  // A request may take PAGE_TIMEOUT_MS and read up to [size] bytes: it starts only when both still fit.
  u.canFetch = (size = READ_BYTES.rss) => u.fetches < limits.maxFetches && u.bytes + size <= limits.maxBytes && u.elapsed() + limits.fetchGapMs + PAGE_TIMEOUT_MS <= limits.maxMs;
  /** [opts].maxBytes is required in spirit: without one the RSS size is assumed and asked for. */
  u.fetch = async (url, opts) => {
    const o = { timeoutMs: PAGE_TIMEOUT_MS, maxBytes: READ_BYTES.rss, ...(opts || {}) };
    if (!u.canFetch(o.maxBytes)) throw Object.assign(new Error("over the step budget"), { budget: true });
    if (u.last !== null) {
      const wait = u.last + limits.fetchGapMs - clock.now();
      if (wait > 0) await clock.sleep(wait);
    }
    u.fetches++;
    u.last = clock.now();
    const r = await fetch(url, o);
    let body = await r.text();
    // A Kino older than maxBytes reads the whole answer: never keep more than asked for.
    if (body.length > o.maxBytes) body = body.slice(0, o.maxBytes);
    u.bytes += Math.min(utf8Bytes(body), o.maxBytes);
    return { ok: r.ok, status: r.status, text: body };
  };
  return u;
}

const STAGES = ["resolve", "meta", "categorize"];

/** The order of the stages in a step: each step starts one further along, so no stage waits behind another for long. */
export function stageOrder(turn) {
  const n = STAGES.length;
  const k = ((Math.floor(Number(turn)) || 0) % n + n) % n;
  return [...STAGES.slice(k), ...STAGES.slice(0, k)];
}

/** True while a story's page data may be used: a day when the page gave something, an hour when it did not. */
export function metaFresh(rec, now) {
  if (!rec.m || now < rec.m) return false;
  return now - rec.m < (rec.ok ? META_TTL_MS : RETRY_MS);
}

/**
 * The stories each stage would take now, in window order (the first cards first), at most `batch` each:
 * - resolve: no outlet address yet and not tried in the last hour, among the first `enrichFirst`;
 * - meta: an address and no page data that is still fresh, among the first `enrichFirst`;
 * - categorize: only guessed so far and not asked in the last hour, among the first `aiFirst`, when the AI is on.
 */
export function pending(stories, { loadMedia = true, useAi = false } = {}, b = budgetFor("phone"), now = 0) {
  const out = { resolve: [], meta: [], categorize: [] };
  stories.forEach((s, index) => {
    if (loadMedia && index < b.enrichFirst) {
      if (!s.u) {
        if ((!s.r || now - s.r >= RETRY_MS || now < s.r) && out.resolve.length < b.batch) out.resolve.push(s);
      } else if (!metaFresh(s, now) && out.meta.length < b.batch) out.meta.push(s);
    }
    if (useAi && index < b.aiFirst && s.a !== 1 && (!s.q || now - s.q >= RETRY_MS || now < s.q) && out.categorize.length < b.batch) out.categorize.push(s);
  });
  return out;
}

/** The outlet's address of a Google article [link] through Google's own resolver (two requests, unofficial), else null. */
async function resolveArticle(u, link, edition) {
  const e = EDITIONS[edition] || EDITIONS.co;
  const page = await u.fetch(link + (link.includes("?") ? "&" : "?") + "hl=" + e.hl + "&gl=" + e.gl + "&ceid=" + encodeURIComponent(e.ceid), { maxBytes: READ_BYTES.resolverPage, timeoutMs: PAGE_TIMEOUT_MS });
  // Only the three attributes are kept: the page itself is dropped at once.
  const params = page.ok ? parseArticleParams(page.text) : null;
  page.text = "";
  if (!params) return null;
  const req = batchExecuteRequest(params);
  const answer = await u.fetch(req.url, { method: "POST", body: { form: req.form }, maxBytes: READ_BYTES.resolverAnswer, timeoutMs: PAGE_TIMEOUT_MS });
  const url = answer.ok ? parseBatchExecute(answer.text) : null;
  return url && /^https:/i.test(url) ? url : null;
}

/**
 * Moves the news one step forward and stops within [budget]. [cache] is `makeCache(kino.storage)`, [fetch] is kino.fetch,
 * [settings] `{ edition, terms, titles, excluded, useLibrary, libraryCount, frequencyMin, loadMedia, useAi, force }`,
 * [clock] `{ now(), sleep(ms) }`, [budget] from `budgetFor(device)`, [ask] the AI adapter (`askAi` in the job when the person
 * turned the AI on; null on a screen's open or timer, where Kino refuses it). It reads nothing else (no kino.config, no
 * kino.library), so the job and the screen call it the same way, and it resumes where the last step stopped (everything is in
 * the cache).
 *
 * 1. The feed, when it is older than the frequency (or [force], or the terms changed): the terms packed into OR searches,
 *    at most `batch` of them; with more, each step takes the next ones (a cursor in the cache), so every term is searched
 *    over time. No term: the top stories. The results join the window of the newest 100 stories.
 * 2. Then one batch for each stage, in a rotating order, while the budget lasts: the outlet's address, the page's picture
 *    and description, the AI's category (one question of at most `batch` titles, at most one every `askGapMs`, counted as a
 *    request). What the
 *    budget does not reach waits for the next step.
 *
 * Answers `{ stories, fetchedAt, terms, changed, failed, fetches, bytes, ms, done: { resolve, meta, categorize } }`.
 */
/**
 * One question to the AI about [batch] (at most `b.batch` stories), counted as one of the step's requests: the stories it
 * answered for get its category (or "other" when it skipped one); without an answer the guesses stay and they are asked
 * again an hour later. Answers how many it categorized.
 */
async function askCategories(batch, ask, b, u, now) {
  const q = buildCategoryPrompt(batch, b.batch);
  u.fetches++;
  let answer = null;
  try { answer = await ask(q.prompt, q.system); } catch (e) { answer = null; }
  const got = answer === null ? {} : parseCategories(answer, batch);
  for (const rec of batch) {
    rec.q = now;
    if (answer !== null) { rec.c = got[rec.id] || "other"; rec.a = 1; }
  }
  return answer === null ? 0 : batch.length;
}

/**
 * Only the AI stage, for the person's «Clasificar ahora»: one question about the first stories the AI has not sorted yet
 * (the hour's wait for a refused or failed ask does not apply: the person asked). Answers `{ stories, done }`.
 */
export async function classifyNow(cache, clock, budget = budgetFor("phone"), ask = askAi) {
  const b = { ...budgetFor("phone"), ...(budget || {}) };
  const stories = validStories(cache.get(KEYS.stories));
  const batch = stories.slice(0, b.aiFirst).filter((x) => x.a !== 1).slice(0, b.batch);
  if (!batch.length || typeof ask !== "function") return { stories, done: 0 };
  const u = budgeted(() => Promise.reject(new Error("no requests here")), b, clock);
  const done = await askCategories(batch, ask, b, u, clock.now());
  cache.set(KEYS.stories, fitSize(stories));
  const workRaw = cache.get(KEYS.work);
  cache.set(KEYS.work, { turn: isObj(workRaw) && Number.isFinite(workRaw.turn) ? workRaw.turn : 0, lastAsk: clock.now() });
  return { stories, done };
}

export async function step(cache, fetch, settings, clock, budget = budgetFor("phone"), ask = null) {
  const s = settings || {};
  const b = { ...budgetFor("phone"), ...(budget || {}) };
  const edition = EDITIONS[s.edition] ? s.edition : "co";
  const terms = buildTerms(s);
  const key = feedKeyOf(edition, terms);
  const u = budgeted(fetch, b, clock);
  const now = clock.now();
  const feedRaw = cache.get(KEYS.feed);
  const feed = isObj(feedRaw) && typeof feedRaw.key === "string" ? feedRaw : null;
  const sameTerms = !!feed && feed.key === key;
  let stories = sameTerms ? validStories(cache.get(KEYS.stories)) : [];
  let fetchedAt = sameTerms && Number.isFinite(feed.fetchedAt) ? feed.fetchedAt : 0;
  const workRaw = cache.get(KEYS.work);
  const work = { turn: isObj(workRaw) && Number.isFinite(workRaw.turn) ? workRaw.turn : 0, lastAsk: isObj(workRaw) ? time(workRaw.lastAsk) : 0 };
  let changed = false;
  let failed = false;
  const done = { resolve: 0, meta: 0, categorize: 0 };
  // What is found is stored at once, after the feed and after each stage: a run Kino cuts keeps everything before it.
  const save = () => {
    stories = fitSize(stories);
    cache.set(KEYS.stories, stories);
    cache.set(KEYS.work, work);
  };

  // 1. The feed.
  if (s.force || !isFresh(feed, key, now, frequencyMs(s.frequencyMin))) {
    const all = terms.length ? batchQueries(terms, edition) : [{ q: "", terms: [] }];
    const { chosen, next } = pickBatches(all, sameTerms ? feed.cursor : 0, b.batch);
    const lists = [];
    for (const batch of chosen) {
      if (!u.canFetch(READ_BYTES.rss)) break;
      try {
        const r = await u.fetch(googleNewsUrl({ q: batch.q, edition }), { maxBytes: READ_BYTES.rss });
        if (r.ok) lists.push(parseGoogleNews(r.text, MAX_ITEMS));
      } catch (e) { /* this search failed: the others still count */ }
    }
    if (lists.length) {
      stories = mergeWindow(stories, lists);
      fetchedAt = now;
      changed = true;
      cache.set(KEYS.feed, { key, fetchedAt, cursor: next, batches: all.length });
      save();
    } else failed = true;
  }

  // 2. One batch per stage, while the budget lasts.
  const todo = pending(stories, { loadMedia: s.loadMedia !== false, useAi: s.useAi === true }, b, now);
  work.turn++;
  for (const stage of stageOrder(work.turn - 1)) {
    if (stage === "resolve") {
      let resolves = 0;
      for (const rec of todo.resolve) {
        const local = decodeArticleUrl(rec.g);
        // Google's resolver reads a big page: only a few a step, and only when a whole resolution still fits the budget.
        if (!local && (resolves >= b.maxResolves || !u.canFetch(READ_BYTES.resolverPage + READ_BYTES.resolverAnswer))) continue;
        try {
          if (!local) resolves++;
          const url = local || (await resolveArticle(u, rec.g, edition));
          rec.r = now;
          if (url && /^https:/i.test(url)) { rec.u = url.slice(0, 1000); rec.g = null; }
        } catch (e) {
          if (e && e.budget) break;
          rec.r = now;
        }
        done.resolve++;
      }
    } else if (stage === "meta") {
      for (const rec of todo.meta) {
        if (!u.canFetch(READ_BYTES.head) || !rec.u) break;
        try {
          // stopAt (Task 8u): Kino stops reading at the end of the head, so a server that ignores Range costs only the head.
          const page = await u.fetch(rec.u, { headers: { Range: "bytes=0-65535", Accept: "text/html" }, maxBytes: READ_BYTES.head, stopAt: "</head>", timeoutMs: PAGE_TIMEOUT_MS });
          if (!page.ok) throw new Error("the outlet answered " + page.status);
          const m = parsePageMeta(page.text, rec.u);
          page.text = "";
          rec.i = m.image;
          rec.d = m.description;
          if (!rec.s && m.site) rec.s = m.site;
          rec.ok = !!(m.image || m.description);
        } catch (e) {
          if (e && e.budget) break;
          rec.ok = false;
        }
        rec.m = now;
        done.meta++;
      }
    } else if (typeof ask === "function" && todo.categorize.length && now - work.lastAsk >= b.askGapMs && u.canFetch(0)) {
      done.categorize = await askCategories(todo.categorize, ask, b, u, now);
      work.lastAsk = now;
    }
    save();
  }
  if (done.resolve || done.meta || done.categorize) changed = true;
  save();
  return { stories, fetchedAt, terms, changed, failed, fetches: u.fetches, bytes: u.bytes, ms: u.elapsed(), done };
}

/** A manual refresh: at most this many steps, at most one every MANUAL_GAP_MS. */
export const MANUAL_STEPS = 3;
export const MANUAL_GAP_MS = 30000;

/**
 * The person's «Actualizar ahora»: the same `step`, in the foreground, a few times in a row (MANUAL_STEPS at most), all of them
 * together within ONE step budget ([budget]: requests, bytes and time are shared, never more than one job run may read), the
 * feed forced on the first, never the AI. [lastAt] is when the last manual refresh started: within MANUAL_GAP_MS nothing runs
 * (`throttled`). It stops when a step changes nothing, or the feed cannot be read (the cache stays as it was). Answers
 * `{ throttled, failed, newCount, changed, stories, fetchedAt, steps, fetches, bytes }`; newCount compares the stories' ids
 * before and after.
 */
export async function manualRefresh(cache, fetch, settings, clock, budget = budgetFor("phone"), lastAt = 0) {
  const started = clock.now();
  if (lastAt && started >= lastAt && started - lastAt < MANUAL_GAP_MS) return { throttled: true };
  const b = { ...budgetFor("phone"), ...(budget || {}) };
  const before = new Set(validStories(cache.get(KEYS.stories)).map((x) => x.id));
  let bytes = 0;
  let fetches = 0;
  let steps = 0;
  let changed = false;
  let failed = false;
  let last = null;
  for (let i = 0; i < MANUAL_STEPS; i++) {
    const left = { maxBytes: b.maxBytes - bytes, maxMs: b.maxMs - (clock.now() - started), maxFetches: b.maxFetches - fetches };
    if (left.maxBytes < READ_BYTES.rss || left.maxFetches < 1 || left.maxMs < b.fetchGapMs + PAGE_TIMEOUT_MS) break;
    const r = await step(cache, fetch, { ...settings, force: i === 0 }, clock, { ...b, ...left }, null);
    steps++;
    bytes += r.bytes;
    fetches += r.fetches;
    last = r;
    if (i === 0 && r.failed) { failed = true; break; }
    if (!r.changed) break;
    changed = true;
  }
  const stories = last ? last.stories : validStories(cache.get(KEYS.stories));
  return {
    throttled: false, failed, changed, stories, fetchedAt: last ? last.fetchedAt : 0, terms: last ? last.terms : [], steps, fetches, bytes,
    newCount: stories.filter((x) => !before.has(x.id)).length,
  };
}

/** Kept for readers of the earlier example: the same as `step`. */
export const refresh = step;
// ---------- a story's text, read from its page when the person opens it (pure) ----------

/** The article text kept per story, at most; and how many stories keep one (the newest opened). */
export const ARTICLE_CHARS = 6000;
export const ARTICLE_KEEP = 25;
/** How much of a page is read for its text. */
export const ARTICLE_PAGE_CHARS = 256 * 1024;
export const ARTICLES_KEY = "articles";

const BOILERPLATE = /(cookie|suscr[ií]b|subscrib|newsletter|bolet[ií]n|derechos reservados|all rights reserved|publicidad|advertisement|lee tambi[eé]n|lea tambi[eé]n|read more|read also|s[ií]guenos|follow us|comparte esta|share this|inicia sesi[oó]n|sign in|log in|acepta|accept all|t[eé]rminos y condiciones|terms of use|pol[ií]tica de privacidad|privacy policy|haz clic|click here|descarga la app|download the app|verifica tu (correo|email)|correo electr[oó]nico de verificaci[oó]n|bandeja de entrada|contrase[ñn]a|password|reg[ií]strate|fuente preferida|mantente informado|recibe las [uú]ltimas|stay informed|\{[a-z]+\})/i;
/** A byline or a date stamp ("PERIODISTA 26.10.2026 13:33 Actualizado: ..."): not the story. */
const STAMP = /(\d{1,2}[./]\d{1,2}[./]\d{2,4}\s+\d{1,2}:\d{2})|actualizado:|updated:/i;

/**
 * The main text of an article page, as plain paragraphs joined by blank lines, at most [max] characters ("" when none is
 * found). Tolerant on purpose: scripts, styles, navigation, headers, footers, asides, forms and pictures are dropped; the
 * paragraphs of the longest <article> are preferred, else the block of <p> with the most text; short lines and the usual
 * boilerplate (cookies, subscriptions, "read also") are left out. It is an extract: a paywall shows what the page shows.
 */
export function extractArticle(html, max = ARTICLE_CHARS) {
  let s = String(html || "").slice(0, ARTICLE_PAGE_CHARS);
  s = s.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|figure|iframe|template|button|select)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const paragraphsOf = (chunk) => (chunk.match(/<p\b[^>]*>[\s\S]*?<\/p\s*>/gi) || [])
    .map((p) => clip(stripHtml(p), 2000))
    .filter((t) => t.length >= 40 && !BOILERPLATE.test(t) && !STAMP.test(t));
  let paras = [];
  // A page cut at 256 KB may lose the closing tag: an <article> then runs to the end of what was read.
  const articles = s.match(/<article\b[\s\S]*?(?:<\/article\s*>|$)/gi) || [];
  for (const a of articles) {
    const p = paragraphsOf(a);
    if (p.join("").length > paras.join("").length) paras = p;
  }
  if (paras.join("").length < 200) {
    // No usable <article>: the block (between two closing div/section tags) whose paragraphs hold the most text.
    let best = [];
    for (const block of s.split(/<\/(?:div|section|main)\s*>/i)) {
      const p = paragraphsOf(block);
      if (p.join("").length > best.join("").length) best = p;
    }
    if (best.join("").length > paras.join("").length) paras = best;
  }
  const seen = new Set();
  const out = [];
  let total = 0;
  for (const p of paras) {
    if (seen.has(p)) continue;
    seen.add(p);
    if (total + p.length > max) {
      const room = max - total;
      if (room > 80) out.push(p.slice(0, room - 1).replace(/\s+\S*$/, "") + "…");
      break;
    }
    out.push(p);
    total += p.length + 2;
  }
  // Less than a few lines is a login box or a teaser, not the story: the description is better.
  return total >= 300 ? out.join("\n\n") : "";
}

/** The article texts kept (by story id, only stories still in the window, the [keep] newest), read back safely. */
export function keptArticles(raw, ids, keep = ARTICLE_KEEP) {
  const out = {};
  if (!isObj(raw)) return out;
  const rows = Object.keys(raw).filter((k) => ids.has(k) && isObj(raw[k]) && typeof raw[k].x === "string")
    .map((k) => [k, { x: raw[k].x.slice(0, ARTICLE_CHARS), at: time(raw[k].at) }])
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, keep);
  for (const [k, v] of rows) out[k] = v;
  return out;
}

// ---------- reading the settings, the library and the storage (the screen's side) ----------

/** This device's own store (the watched titles read last, the article texts). */
const localOf = () => makeCache(kino.storage);
/** The cache `step` works on: kino.shared, falling back to kino.storage. */
const cacheOf = () => makeSharedCache(typeof kino.shared === "object" ? kino.shared : null, localOf());
const realClock = { now: () => Date.now(), sleep: (ms) => kino.sleep(Math.min(5000, Math.max(0, ms))) };
const isOn = (v, dflt) => (v === undefined || v === null ? dflt : v === true || v === "true");
const stringList = (v, max) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => x.slice(0, 200)).slice(0, max) : []);
/** The kind of device Kino says it is ("tv" or "phone"); a Kino without `kino.device` counts as a phone. */
const deviceKind = () => (typeof kino.device === "string" && kino.device === "tv" ? "tv" : "phone");

/**
 * Watched titles for trying the plugin without a history in Kino: used instead of `kino.library` while the
 * «Títulos de ejemplo» switch is on, and said so on screen. Movies and series only.
 */
export const SAMPLE_WATCHED = [
  { title: "Avatar", kind: "movie", year: 2009 },
  { title: "Avatar: The Last Airbender", kind: "series", year: 2024 },
  { title: "Breaking Bad", kind: "series", year: 2008 },
  { title: "Dune", kind: "movie", year: 2021 },
  { title: "Stranger Things", kind: "series", year: 2016 },
  { title: "One Piece", kind: "series", year: 2023 },
  { title: "Dragon Ball", kind: "series", year: 1986 },
];

/** The stored settings as `step` takes them (with the watched titles read last and the excluded ones). */
function stored(lang) {
  const cache = cacheOf();
  return {
    edition: editionFor(lang),
    terms: cleanTerms(kino.config.get("terms")),
    useLibrary: isOn(kino.config.get("useLibrary"), false),
    loadMedia: isOn(kino.config.get("loadMedia"), true),
    useAi: isOn(kino.config.get("useAi"), false),
    sampleLibrary: isOn(kino.config.get("sampleLibrary"), false),
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
async function readWatched() {
  const cache = localOf();
  if (isOn(kino.config.get("sampleLibrary"), false)) {
    const titles = watchedTitles(SAMPLE_WATCHED, 100);
    cache.set(KEYS.watched, titles);
    return { titles, denied: false };
  }
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
function cardOf(rec, terms, loadMedia) {
  const m = matchTerm(rec.t, terms);
  return {
    id: rec.id, title: rec.t, source: rec.s, ts: rec.p, cat: rec.c, term: m ? m.term : null, from: m ? m.from : null,
    image: loadMedia ? rec.i : null, desc: loadMedia ? rec.d : "",
  };
}

/** The feed for the screen from one `step`: `{ feed, changed }`. [personStarted]: the library may be read now. */
async function loadFeed(lang, { force = false, personStarted = true } = {}) {
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

// ---------- the background job ----------

/**
 * Kino's scheduled job (manifest "jobs", capability "schedule", runOn "preferPhone"): one `step` with this device's budget
 * (a TV that runs it because no phone is linked takes the lighter one), the watched titles read fresh when the person uses
 * them, and the AI when they turned it on. What it finds goes to kino.shared, which the screen reads when it opens. Kino
 * never reads what it returns.
 */
export async function job(ctx) {
  const s = stored(kino.lang);
  if (s.useLibrary) {
    const w = await readWatched();
    s.titles = w.titles;
  }
  const r = await step(cacheOf(), kino.fetch, s, realClock, budgetFor(deviceKind()), s.useAi ? askAi : null);
  console.log("job " + (ctx && ctx.id) + " (" + (ctx && ctx.reason) + "): " + r.fetches + " requests, " + Math.round(r.bytes / 1024) + " KB, " + r.stories.length + " stories, done " + JSON.stringify(r.done));
}

// ---------- the sample stories ----------

// Shown, with the error banner, when Google News cannot be reached and nothing is cached. Made up, and said so on screen.
const SAMPLE = [
  {
    id: "1", sample: true, ts: Date.UTC(2026, 9, 1, 12), source: "Kino", cat: "film", term: "Avatar", from: "watched",
    title: "Noticia de ejemplo: así se ve una película que viste", titleEn: "Sample story: how a movie you watched looks here",
    desc: "Con «Usar lo que he visto», una película como Avatar busca noticias de «Avatar» película.",
    descEn: "With “Use what I watched”, a movie like Avatar searches for news about “Avatar” movie.",
  },
  {
    id: "2", sample: true, ts: Date.UTC(2026, 8, 24, 12), source: "Kino", cat: "film", term: "Breaking Bad", from: "watched",
    title: "Noticia de ejemplo: las series que viste traen sus noticias", titleEn: "Sample story: the series you watched bring their news",
    desc: "Breaking Bad o Stranger Things se buscan como serie, así no aparece una película con el mismo nombre.",
    descEn: "Breaking Bad or Stranger Things are searched as series, so a movie with the same name does not show up.",
  },
  {
    id: "3", sample: true, ts: Date.UTC(2026, 8, 10, 12), source: "Kino", cat: "film", term: "Dragon Ball", from: "term",
    title: "Noticia de ejemplo: tus propios términos, como «Dragon Ball»", titleEn: "Sample story: your own terms, like “Dragon Ball”",
    desc: "Agrega términos en Configuración: se buscan tal cual los escribes.",
    descEn: "Add terms in Settings: they are searched just as you type them.",
  },
];

// ---------- the view ----------

const isEn = (lang) => String(lang || "").startsWith("en");
const pick = (o, field, en) => (en && o[field + "En"]) || o[field];
const categoryLabel = (c, en) => {
  const x = CATEGORIES.find((k) => k.value === c) || CATEGORIES[CATEGORIES.length - 1];
  return en ? x.labelEn : x.label;
};

/** The first line of a card: the outlet (or "Noticia de ejemplo") and how long ago. */
function byline(story, en, now) {
  const who = story.sample ? (en ? "Sample story" : "Noticia de ejemplo") : story.source || "Google News";
  return [who, timeAgo(story.ts, now, en)].filter(Boolean).join(" · ");
}

/** Why a story is here: the watched title or the term it matches. */
function whyOf(story, en) {
  if (!story.term) return "";
  return story.from === "watched"
    ? (en ? "Because you watched “" + story.term + "”" : "Porque viste «" + story.term + "»")
    : (en ? "From your term “" + story.term + "”" : "Por tu término «" + story.term + "»");
}

const ACCENTS = ["primary", "secondary", "warning", "muted"];

/** The colour role of a source's placeholder: always the same for one source (a small hash of its name). */
export function accentFor(source) {
  let h = 0;
  for (const ch of String(source || "?")) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

/** The letter a placeholder shows: the source's first letter or digit, else "N". */
export function initialOf(source) {
  const m = /[\p{L}\p{N}]/u.exec(String(source || ""));
  return m ? m[0].toUpperCase() : "N";
}

/**
 * What an image shows when it has no picture or the picture fails (`image.fallback`): the outlet's initial in its colour and a
 * news mark, in the image's own 16:9 box, never a broken-image mark.
 */
function placeholder(story) {
  return {
    type: "col", align: "center", justify: "center", padding: 12,
    children: [{ type: "text", text: initialOf(story.source), style: "h1", color: accentFor(story.source) }],
  };
}

/** A card's share of the twelve columns: one per row on a phone (compact), two on a medium window, three on a TV. */
const CARD_SPAN = { compact: 12, medium: 6, expanded: 4 };

/** Cards draw their picture edge to edge (`card.flush`: no card padding for the children, clipped to the card's shape). */
export const CARD_FLUSH = true;
const STORY_POPUP = "story";

/** A story's picture with its placeholder as the fallback (no url, or one that does not load). */
function pictureOf(story, en, radius = null) {
  return {
    type: "image", aspect: "16:9", alt: pick(story, "title", en), fallback: placeholder(story),
    ...(story.image ? { url: story.image } : {}), ...(radius ? { radius } : {}),
  };
}

/**
 * The cards drawn at first, and how many more each «Ver más» adds: the tree stays small (a TV box draws and checks every
 * node of it on each answer), and the rest of the feed waits in the state until the person asks for it.
 */
export const PAGE = 12;
/** Only the first cards carry a picture (two pages); the later ones are text cards, so a long page never loads 40 pictures. */
export const PICTURE_CARDS = 2 * PAGE;
/** A card's description in the state and the tree: three lines at most are shown, the pop-up reads the full record. */
export const CARD_DESC_CHARS = 140;

/** One story as a card: picture (or placeholder) on top, outlet and time, title, a short description, why it is here. */
function storyCard(story, en, now, withPicture = true) {
  const desc = str(pick(story, "desc", en), CARD_DESC_CHARS);
  const why = whyOf(story, en);
  return {
    type: "card", key: "n" + story.id, variant: "outlined", radius: "medium", span: CARD_SPAN, ...(CARD_FLUSH && withPicture ? { flush: true } : {}),
    // The event reads the story; its answer opens the pop-up with the new body (an answer's ui).
    onTap: { event: "read", arg: story.id },
    children: [
      ...(withPicture ? [pictureOf(story, en)] : []),
      {
        type: "col", gap: 4, padding: 12,
        children: [
          { type: "text", text: byline(story, en, now), style: "caption", color: "secondary", maxLines: 1 },
          { type: "text", text: pick(story, "title", en), style: "h5", maxLines: 3 },
          ...(desc ? [{ type: "text", text: desc, style: "p", color: "muted", maxLines: 3 }] : []),
          ...(why ? [{ type: "text", text: why, style: "caption", color: "primary", maxLines: 1 }] : []),
        ],
      },
    ],
  };
}

const storiesOf = (feed) => (feed && feed.failed ? SAMPLE : (feed && feed.items) || []);

/** The category tabs: «Todas» first, then each category that has stories (only those), with its count. */
export function categoryOptions(stories) {
  const counts = {};
  for (const s of stories) counts[s.cat || "other"] = (counts[s.cat || "other"] || 0) + 1;
  return [
    { value: "all", label: "Todas (" + stories.length + ")", labelEn: "All (" + stories.length + ")" },
    ...CATEGORIES.filter((c) => counts[c.value]).map((c) => ({ value: c.value, label: c.label + " (" + counts[c.value] + ")", labelEn: c.labelEn + " (" + counts[c.value] + ")" })),
  ];
}

/** The cards on the twelve columns; a line's cells stretch to its tallest (no `align`), so a line of cards is even. */
function grid(children) {
  return { type: "row", wrap: true, gap: 12, children };
}

/** Text cut into paragraphs that fit a text node (2000 characters each). */
function paragraphs(text) {
  const out = [];
  for (const p of String(text || "").split(/\n{2,}/)) {
    for (let i = 0; i < p.length; i += 1900) out.push(p.slice(i, i + 1900));
  }
  return out.filter((p) => p.trim());
}

/**
 * The story pop-up, declared in the tree: all of it scrolls. The picture (or its placeholder), the title, outlet, time and
 * category, the text, «Ver noticia» (the browser, after Kino asks) and, on a TV, the address as a QR. Kino draws its close.
 * It shows `state.reading`; the `read` answer opens it with that body.
 */
function storyPopup(state, en, now) {
  const r = state.reading;
  const children = [];
  if (!isObj(r)) {
    children.push({ type: "skeleton", shape: "block", h: 160 });
    children.push({ type: "skeleton", shape: "line", lines: 6 });
    return { type: "popup", key: STORY_POPUP, kind: "dialog", children, onClose: "storyClosed" };
  }
  children.push(pictureOf(r, en, "small"));
  children.push({ type: "text", text: pick(r, "title", en), style: "h3" });
  children.push({
    type: "row", gap: 8, align: "center",
    children: [
      { type: "text", text: byline(r, en, now), style: "caption", color: "secondary", weight: 1 },
      { type: "badge", text: categoryLabel(r.cat, en) },
    ],
  });
  const why = whyOf(r, en);
  if (why) children.push({ type: "text", style: "caption", color: "primary", text: why });
  if (r.text) {
    children.push({ type: "text", style: "caption", color: "muted", text: "Extracto de la página del medio; puede estar incompleto (por ejemplo, si es de pago).", textEn: "An extract of the outlet's page; it may be partial (for example, behind a paywall)." });
    for (const p of paragraphs(r.text)) children.push({ type: "text", style: "p", text: p });
  } else if (pick(r, "desc", en)) {
    children.push({ type: "text", style: "p", text: pick(r, "desc", en) });
  } else {
    children.push({ type: "text", style: "p", color: "muted", text: "No pudimos leer el texto de esta noticia. Ábrela en el sitio del medio.", textEn: "We could not read this story's text. Open it on the outlet's site." });
  }
  // On a TV the address is also a QR (the TV's browser is the phone in the person's hand); a phone opens it with the button.
  if (r.target) {
    const tv = ["tv"];
    children.push({ type: "divider", devices: tv });
    children.push(r.outlet
      ? { type: "text", style: "p", devices: tv, text: "Escanea el código para leer el artículo en el sitio del medio.", textEn: "Scan the code to read the article on the outlet's site." }
      : {
        type: "text", style: "p", devices: tv,
        text: "Aún no tenemos la dirección del medio: el código abre el enlace de Google Noticias, que lleva al artículo.",
        textEn: "We do not have the outlet's address yet: the code opens the Google News link, which leads to the article.",
      });
    children.push({ type: "qr", devices: tv, value: r.target, size: "medium", label: r.outlet ? "Artículo" : "Google Noticias", labelEn: r.outlet ? "Article" : "Google News" });
  }
  const buttons = r.target ? [{ label: "Ver noticia", labelEn: "Open story", event: "openStory", arg: r.id, variant: "primary" }] : [];
  return { type: "popup", key: STORY_POPUP, kind: "dialog", children, buttons, onClose: "storyClosed" };
}

/** The tap that refreshes: show «Actualizando…» at once, then the event that does the work (a press: Kino lets it fetch). */
const REFRESH_TAP = { ui: [{ show: "refreshing" }], event: "refreshNow" };
/** When the last manual refresh started, on this device (kino.storage): one every MANUAL_GAP_MS. */
const MANUAL_AT_KEY = "manualRefreshAt";

function newsTab(state, en, now) {
  const feed = state.feed;
  // No heading or hint over the cards: the header says when the news were updated, the cards say why they are here.
  const top = [];
  if (feed && feed.failed) {
    top.push({
      type: "banner", key: "feedFailed", role: "error", dismissible: true,
      title: "No se pudo cargar Google Noticias", titleEn: "Google News could not be loaded",
      text: "Mostramos noticias de ejemplo. Revisa tu conexión.", textEn: "Showing sample stories. Check your connection.",
      action: { label: "Reintentar", labelEn: "Retry", onTap: REFRESH_TAP },
    });
  }
  if (feed && feed.libraryDenied) {
    top.push({
      type: "banner", key: "libraryDenied", role: "warning", dismissible: true,
      text: "Kino no deja a este plugin leer lo que viste: actívalo en el ajuste del plugin.", textEn: "Kino does not let this plugin read what you watched: allow it in the plugin's settings.",
    });
  }
  const stories = storiesOf(feed);
  let body;
  if (!feed) body = [grid(Array.from({ length: 6 }, () => ({ type: "skeleton", shape: "card", span: CARD_SPAN })))];
  else if (stories.length === 0) {
    body = [{
      type: "emptyState", icon: "info", title: "Nada por aquí", titleEn: "Nothing here",
      text: "Google Noticias no trajo artículos para tus términos. Prueba con otros en Configuración.", textEn: "Google News returned no articles for your terms. Try others in Settings.",
    }];
  } else {
    const tabs = categoryOptions(stories);
    const cat = tabs.some((o) => o.value === state.cat) ? state.cat : "all";
    const inCat = cat === "all" ? stories : stories.filter((s) => (s.cat || "other") === cat);
    const count = Math.max(PAGE, Number.isInteger(state.shown) ? state.shown : PAGE);
    const shown = inCat.slice(0, count);
    body = [
      // Kino's tab strip, a second row under the screen's tabs (it scrolls sideways when the categories do not fit); a
      // small gap under it before the cards.
      { type: "tabs", key: "category", tabs, value: cat, onChange: "category", padding: { compact: { bottom: 4 }, expanded: { bottom: 8 } } },
      grid(shown.map((s, i) => storyCard(s, en, now, i < PICTURE_CARDS))),
      ...(inCat.length > shown.length ? [{
        type: "button", key: "moreButton", variant: "secondary", label: "Ver más (" + (inCat.length - shown.length) + ")",
        labelEn: "Show more (" + (inCat.length - shown.length) + ")", onTap: { event: "more", arg: String(count + PAGE) },
      }] : []),
      storyPopup(state, en, now),
    ];
  }
  return { type: "scroll", key: "newsBody", weight: 1, children: [{ type: "col", gap: 12, padding: BODY_PADDING, children: [...top, ...body] }] };
}


/** A removable term: its text and a «Quitar» button. */
function termRow(key, text, event, arg) {
  return {
    type: "row", key, gap: 8, align: "center",
    children: [
      { type: "text", text, style: "p", weight: 1, maxLines: 2 },
      { type: "button", variant: "text", label: "Quitar", labelEn: "Remove", onTap: { event, arg } },
    ],
  };
}

/** A watched work as a removable row: the title, its kind as a chip (the year beside it when the library has one). */
function watchedRow(key, w) {
  const kindEs = w.kind === "series" ? "Serie" : "Película";
  const kindEn = w.kind === "series" ? "Series" : "Movie";
  return {
    type: "row", key, gap: 8, align: "center",
    children: [
      { type: "text", text: w.title, style: "p", weight: 1, maxLines: 2 },
      { type: "badge", text: kindEs + (w.year ? " · " + w.year : ""), textEn: kindEn + (w.year ? " · " + w.year : "") },
      { type: "button", variant: "text", label: "Quitar", labelEn: "Remove", onTap: { event: "excludeWatched", arg: watchedKey(w) } },
    ],
  };
}

/** What the Configuración tab shows and checks: the stored settings and the watched titles that would be searched. */
function settingsView(state, lang) {
  const s = stored(lang);
  const titles = Array.isArray(state.watched) ? validWatched(state.watched) : s.titles;
  const room = watchedRoom(s.libraryCount, s.terms.length);
  const watched = s.useLibrary ? watchedTitles(titles, room, [...s.excluded, ...s.terms]) : [];
  return { s, titles, watched, total: s.terms.length + watched.length };
}

const ADD_POPUP = "addTerm";

function settingsTab(state, lang) {
  const { s, watched, total } = settingsView(state, lang);
  const section = (es, en) => ({ type: "text", text: es, textEn: en, style: "h4" });
  const note = (es, en, color = "muted") => ({ type: "text", style: "caption", color, text: es, textEn: en });
  const children = [
    note("Cada cambio se guarda al momento.", "Every change is saved right away."),
    section("Actualizar las noticias", "Refresh the news"),
    { type: "text", style: "p", text: "Se actualizan solas con el trabajo «Actualizar las noticias»: actívalo y elige cada cuánto en Ajustes ▸ Noticias.", textEn: "They refresh by themselves with the job “Refresh the news”: turn it on and pick how often in Settings ▸ News." },
    note("Al abrir esta pantalla se actualizan si tienen más de una hora.", "When this screen opens they refresh if they are over an hour old."),
    section("Imágenes y textos", "Pictures and texts"),
    { type: "toggle", key: "loadMedia", label: "Cargar imágenes y descripciones de los medios", labelEn: "Load pictures and descriptions from the outlets", value: s.loadMedia, onChange: "media" },
    note(
      "Para mostrarlas, tu aparato abre la página de cada noticia en el sitio del medio, poco a poco. Apagado: sin conexiones a los medios, tarjetas sin foto y solo el resumen de Google.",
      "To show them, your device opens each story's page on the outlet's site, a few at a time. Off: no connection to the outlets, cards without photos and only Google's summary.",
    ),
    section("Clasificar", "Sort into categories"),
    { type: "toggle", key: "useAi", label: "Clasificar con IA", labelEn: "Sort with AI", value: s.useAi, onChange: "ai" },
    note(
      "Si lo activas, los titulares (solo el texto del titular) se envían al servicio de IA de terceros que usa Kino para elegir su categoría, de 10 en 10, en segundo plano o cuando pulses «Clasificar ahora». Apagado: se clasifican por palabras clave en tu aparato.",
      "If you switch it on, the headlines (only the headline text) are sent to the third-party AI service Kino uses to pick their category, 10 at a time, in the background or when you press “Sort now”. Off: they are sorted by keywords on your device.",
      "warning",
    ),
    ...(s.useAi ? [{ type: "button", key: "classifyButton", variant: "secondary", icon: "magic", label: "Clasificar ahora", labelEn: "Sort now", onTap: "classifyNow" }] : []),
    section("Lo que has visto", "What you watched"),
    { type: "toggle", key: "useLibrary", label: "Usar lo que he visto", labelEn: "Use what I watched", value: s.useLibrary, onChange: "library" },
    note(
      "Si lo activas, los títulos de las películas y series que viste se envían a Google Noticias como términos de búsqueda.",
      "If you switch it on, the titles of the movies and series you watched are sent to Google News as search terms.",
      "warning",
    ),
  ];
  children.push({ type: "toggle", key: "sampleLibrary", label: "Títulos de ejemplo", labelEn: "Sample titles", value: s.sampleLibrary, onChange: "sampleLibrary" });
  children.push(note(
    "Para probar sin historial: usa Avatar, Breaking Bad, Dune, Stranger Things, One Piece y Dragon Ball como si los hubieras visto. Nada sale de tu biblioteca.",
    "To try it without a history: uses Avatar, Breaking Bad, Dune, Stranger Things, One Piece and Dragon Ball as if you had watched them. Nothing comes from your library.",
  ));
  if (s.useLibrary) {
    const max = Math.max(1, MAX_TERMS - s.terms.length);
    children.push({ type: "stepper", key: "libraryCount", label: "Títulos recientes", labelEn: "Recent titles", min: 1, max, value: Math.min(s.libraryCount, max), onChange: "count" });
    if (state.libraryDenied) {
      children.push({ type: "banner", key: "settingsDenied", role: "warning", text: "Kino no deja a este plugin leer lo que viste.", textEn: "Kino does not let this plugin read what you watched." });
    } else if (watched.length === 0) {
      children.push({ type: "text", style: "p", color: "muted", text: "No hay títulos vistos para usar.", textEn: "No watched titles to use." });
    }
    watched.forEach((w, i) => children.push(watchedRow("w" + i, w)));
    if (s.excluded.length) {
      children.push({
        type: "row", gap: 8, align: "center",
        children: [
          { type: "text", style: "caption", color: "muted", weight: 1, text: s.excluded.length + " títulos quitados no se buscan.", textEn: s.excluded.length + " removed titles are not searched." },
          { type: "button", variant: "text", label: "Volver a usarlos", labelEn: "Use them again", onTap: "restoreWatched" },
        ],
      });
    }
  }
  children.push(section("Tus términos", "Your terms"));
  children.push(note(total + " de " + MAX_TERMS + " términos en total.", total + " of " + MAX_TERMS + " terms in all."));
  children.push({
    type: "button", key: "addTermButton", variant: "secondary", icon: "magic", label: "Agregar término", labelEn: "Add term",
    enabled: total < MAX_TERMS, onTap: { ui: [{ open: ADD_POPUP }] },
  });
  s.terms.forEach((t, i) => children.push(termRow("t" + i, t, "removeTerm", t)));
  if (isObj(state.settingsError)) children.push({ type: "banner", key: "settingsError", role: "error", text: str(state.settingsError.es, 200), textEn: str(state.settingsError.en, 200) });
  // The pop-up that adds a term. Kino checks the field (required, at most 40 characters) before the plugin sees it; the
  // plugin checks the rest (a repeated term, 50 in all) and says so inside the pop-up.
  children.push({
    type: "popup", key: ADD_POPUP, kind: "dialog", title: "Nuevo término", titleEn: "New term", onClose: "addDismissed",
    children: [{
      type: "form", key: "termForm", onSubmit: "addTerm", gap: 12,
      children: [
        {
          type: "textInput", key: "newTerm", label: "Término", labelEn: "Term", hint: "Por ejemplo: Dragon Ball", hintEn: "For example: Dragon Ball",
          maxLength: TERM_CHARS, required: true, errorText: "Escribe un término de hasta 40 letras", errorTextEn: "Type a term of up to 40 characters",
        },
        ...(isObj(state.addError) ? [{ type: "text", style: "caption", color: "error", text: str(state.addError.es, 200), textEn: str(state.addError.en, 200) }] : []),
        { type: "button", label: "Guardar", labelEn: "Save", submit: true },
      ],
    }],
    buttons: [{ label: "Cancelar", labelEn: "Cancel", event: "cancelAdd" }],
  });
  return { type: "scroll", key: "settingsBody", weight: 1, children: [{ type: "col", padding: BODY_PADDING, gap: 12, children }] };
}

const TABS = [
  { value: "news", label: "Noticias", labelEn: "News" },
  { value: "settings", label: "Configuración", labelEn: "Settings" },
];

/**
 * The timer that moves the work forward while the screen is open: every 10 s one `step` (a few spaced requests at most); it
 * does nothing when the feed is fresh and every story it may enrich is done.
 */
export const TICK = { ms: 10000, event: "tick" };
/** The reload after a settings change, armed only while Noticias shows an outdated feed. */
export const RELOAD = { ms: 1000, event: "reload" };

/**
 * The refresh button at the right end of the tabs' row, on both tabs: the circular arrow only (variant icon). Its label is
 * not drawn: it is what TalkBack reads and what the TV's focus announces; on a TV Kino draws its focus ring around it.
 */
const REFRESH_BUTTON = {
  type: "button", key: "refreshButton", icon: "refresh", label: "Actualizar ahora", labelEn: "Refresh now",
  variant: "icon", onTap: REFRESH_TAP,
};

/**
 * «Actualizado hace 12 min», right before the refresh icon: when the news were last fetched (the stored fetchedAt, worked
 * out again on every render). Without a connection (a stale or failed feed) it says so in the warning colour.
 */
export function updatedCaption(feed, now, en) {
  const ago = feed && feed.fetchedAt ? timeAgo(feed.fetchedAt, now, en) : "";
  const offline = !!(feed && (feed.stale || feed.failed));
  if (!ago && !offline) return null;
  const es = offline ? (ago ? "Sin conexión · actualizado " + ago : "Sin conexión") : "Actualizado " + ago;
  const enText = offline ? (ago ? "Offline · updated " + ago : "Offline") : "Updated " + ago;
  return { type: "text", key: "updatedAgo", style: "caption", color: offline ? "warning" : "muted", maxLines: 1, text: es, textEn: enText };
}

/**
 * The header: the tabs on the left, «Actualizar» on the right, in one row. On a phone it is Kino's tab strip (it takes the
 * room the button leaves). On a TV Kino keeps Left and Right inside a tab strip (Right on its last tab goes nowhere), so the
 * button could not be reached across; there the tabs are a row of buttons with the same event (`pickTab`), the picked one
 * filled, and Left and Right move tab, tab, «Actualizar»; Down goes to the content.
 */
/** Room under the header row in every size class, so the content scrolling under it never touches it (then a divider). */
export const HEADER_PADDING = { compact: { end: 8, bottom: 8 }, medium: { start: 8, end: 8, bottom: 8 }, expanded: { start: 16, end: 16, top: 8, bottom: 12 } };

/**
 * The tab bodies' padding: the header stays outside their scroll, and the first heading starts at least 12 dp (16 on a TV)
 * under the header's divider, never glued to the tabs.
 */
export const BODY_PADDING = { compact: { start: 16, end: 16, top: 12, bottom: 16 }, medium: 16, expanded: { start: 24, end: 24, top: 16, bottom: 24 } };

export function header(tab, device, feed = null, now = Date.now(), en = false) {
  const cluster = [updatedCaption(feed, now, en), REFRESH_BUTTON].filter(Boolean);
  if (device === "tv") {
    return {
      type: "row", key: "header", gap: 12, align: "center", padding: HEADER_PADDING,
      children: [
        ...TABS.map((t) => ({
          type: "button", key: "tab_" + t.value, label: t.label, labelEn: t.labelEn,
          variant: t.value === tab ? "primary" : "text", onTap: { event: "pickTab", arg: t.value },
        })),
        { type: "spacer", weight: 1 },
        ...cluster,
      ],
    };
  }
  return {
    type: "row", key: "header", gap: 8, align: "center", padding: HEADER_PADDING,
    children: [{ type: "tabs", key: "tabs", tabs: TABS, value: tab, onChange: "pickTab", weight: 1 }, ...cluster],
  };
}

export async function screen({ state, lang, device }) {
  const en = isEn(lang);
  const now = Date.now();
  const tab = state.tab === "settings" ? "settings" : "news";
  // Back on Noticias after a settings change: the tab switch itself stays a pure state change, and this one-second timer
  // does the reload right after the tab is drawn (once: its answer clears feedOutdated).
  const every = tab === "news" && state.feedOutdated ? [TICK, RELOAD] : TICK;
  return {
    type: "col", every,
    children: [
      header(tab, device, state.feed, now, en),
      { type: "divider", key: "headerLine" },
      // Shown at once by the refresh tap (Kino's own ui operation), hidden by the answer: under the header, on either tab.
      {
        type: "row", key: "refreshing", hidden: true, gap: 8, align: "center", padding: { left: 16, right: 16 },
        children: [{ type: "progress", label: "Actualizando…", labelEn: "Refreshing…", weight: 1 }, { type: "text", text: "Actualizando…", textEn: "Refreshing…", style: "caption", color: "muted" }],
      },
      tab === "settings" ? settingsTab(state, lang) : newsTab(state, en, now),
    ],
  };
}

// ---------- the events ----------

/** A banner the person dismissed comes back with the next load (its key out of `state.ui.hidden`). */
function unhide(state, keys) {
  const ui = state.ui || {};
  const hidden = { ...(ui.hidden || {}) };
  for (const k of keys) hidden[k] = false;
  return { ui: { ...ui, hidden } };
}

/**
 * The story the pop-up shows, read by the person's tap: its record, then (when pages may be read) its text from the
 * outlet's page, kept for the 25 stories opened last. One or three requests, on demand: never part of `step`.
 */
async function readStory(id, lang) {
  const cache = cacheOf();
  const s = stored(lang);
  const stories = validStories(cache.get(KEYS.stories));
  const rec = stories.find((x) => x.id === id);
  if (!rec) return null;
  const m = matchTerm(rec.t, buildTerms(s));
  const base = { id, title: rec.t, source: rec.s, ts: rec.p, cat: rec.c, term: m ? m.term : null, from: m ? m.from : null, image: s.loadMedia ? rec.i : null, desc: s.loadMedia ? rec.d : "" };
  let text = "";
  if (s.loadMedia) {
    const ids = new Set(stories.map((x) => x.id));
    const local = localOf();
    const kept = keptArticles(local.get(ARTICLES_KEY), ids);
    if (kept[id]) text = kept[id].x;
    else {
      const u = budgeted(kino.fetch, { ...budgetFor(deviceKind()), maxFetches: 3, maxBytes: STEP_MAX_BYTES }, realClock);
      try {
        if (!rec.u && rec.g) {
          const url = decodeArticleUrl(rec.g) || (await resolveArticle(u, rec.g, s.edition));
          rec.r = Date.now();
          if (url) { rec.u = url; rec.g = null; }
        }
        if (rec.u) {
          const page = await u.fetch(rec.u, { headers: { Accept: "text/html" }, maxBytes: READ_BYTES.article, timeoutMs: PAGE_TIMEOUT_MS });
          if (page.ok) {
            text = extractArticle(page.text);
            if (!rec.i || !rec.d) {
              const meta = parsePageMeta(page.text, rec.u);
              rec.i = rec.i || meta.image;
              rec.d = rec.d || meta.description;
              rec.ok = !!(rec.i || rec.d);
              rec.m = Date.now();
            }
          }
          page.text = "";
        }
      } catch (e) {
        console.log("story text failed: " + (e && e.message));
      }
      cache.set(KEYS.stories, fitSize(stories));
      if (text) local.set(ARTICLES_KEY, { ...kept, [id]: { x: text.slice(0, ARTICLE_CHARS), at: Date.now() } });
      base.image = s.loadMedia ? rec.i : null;
      base.desc = s.loadMedia ? rec.d : "";
    }
  }
  return { ...base, text, loading: false, outlet: rec.u || null, target: rec.u || rec.g || null };
}

const MESSAGES = {
  duplicate: { es: "Ese término ya está en la lista", en: "That term is already on the list" },
  full: { es: "Ya hay 50 términos: quita uno primero", en: "There are already 50 terms: remove one first" },
  empty: { es: "Escribe un término", en: "Type a term" },
  needOne: { es: "Necesitas al menos un término: agrega uno o mira algo primero", en: "You need at least one term: add one or watch something first" },
};
const SAVED = { text: "Guardado", textEn: "Saved", role: "success", ms: 2000 };

export async function screenEvent({ name, arg, value, state, lang }) {
  // After a settings change the feed reloads the next time Noticias shows (the feed key changed with the terms).
  const changed = { feedOutdated: true, settingsError: null };
  switch (name) {
    case "open": {
      // Every way in comes here first: one step (the cache when it is still fresh; the screen shows skeletons meanwhile).
      const { feed } = await loadFeed(lang);
      // What Configuración shows of the library comes from this read (the tab switch reads nothing).
      return { state: { feed, libraryDenied: feed.libraryDenied === true } };
    }
    case "tick": {
      // Every 10 s while the screen is open: one step of work. A tick never reads the library (only what the person does
      // may): it uses the titles read last.
      const r = await loadFeed(lang, { personStarted: false });
      return r.changed ? { state: { feed: r.feed } } : null;
    }
    case "refreshNow": {
      // «Actualizar ahora» (a person's tap; never from open or a tick): a few steps now, never the AI, at most one every 30 s.
      const hideLine = [{ hide: "refreshing" }];
      const local = localOf();
      const lastAt = Number(local.get(MANUAL_AT_KEY)) || 0;
      const nowMs = Date.now();
      if (lastAt && nowMs >= lastAt && nowMs - lastAt < MANUAL_GAP_MS) {
        return { ui: hideLine, toast: { text: "Espera un momento: acabas de actualizar", textEn: "Wait a moment: you just refreshed", role: "warning", ms: 2500 } };
      }
      local.set(MANUAL_AT_KEY, nowMs);
      const s = stored(lang);
      let denied = false;
      if (s.useLibrary) {
        const w = await readWatched();
        s.titles = w.titles;
        denied = w.denied;
      }
      const r = await manualRefresh(cacheOf(), kino.fetch, s, realClock, budgetFor(deviceKind()), 0);
      const terms = r.steps ? r.terms : buildTerms(s);
      console.log("manual refresh: " + r.steps + " steps, " + r.fetches + " requests, " + Math.round(r.bytes / 1024) + " KB, " + r.newCount + " new");
      const failed = r.failed && r.stories.length === 0;
      const feed = {
        items: r.stories.slice(0, MAX_CARDS).map((x) => cardOf(x, terms, s.loadMedia)), fetchedAt: r.fetchedAt || (state.feed && state.feed.fetchedAt) || 0,
        failed, stale: r.failed && r.stories.length > 0, terms: terms.length, libraryDenied: denied,
      };
      const toast = r.failed
        ? { text: "No se pudo actualizar: sin conexión con Google Noticias", textEn: "Could not refresh: no connection to Google News", role: "error" }
        : r.newCount > 0
          ? { text: r.newCount === 1 ? "Hay 1 noticia nueva" : "Hay " + r.newCount + " noticias nuevas", textEn: r.newCount === 1 ? "1 new story" : r.newCount + " new stories", role: "success", ms: 2500 }
          : r.changed
            ? { text: "Noticias al día", textEn: "News up to date", role: "success", ms: 2000 }
            : { text: "Sin novedades", textEn: "Nothing new", ms: 2000 };
      return { state: { feed, ...unhide(state, ["feedFailed"]) }, ui: hideLine, toast };
    }
    case "category": {
      // A pure state change: the first page of that category.
      const cat = typeof value === "string" ? value : Array.isArray(value) && typeof value[0] === "string" ? value[0] : null;
      return cat ? { state: { cat, shown: PAGE } } : null;
    }
    case "more": {
      // «Ver más»: the next page, from what the state already holds (no request, no storage).
      const n = Number(arg);
      return Number.isInteger(n) && n > 0 ? { state: { shown: Math.min(MAX_CARDS, n) }, focus: null } : null;
    }
    case "reload": {
      // The one-second timer armed when Noticias shows after a settings change: one step with the new settings.
      if (!state.feedOutdated) return null;
      const { feed } = await loadFeed(lang, { force: true, personStarted: false });
      return { state: { feed, feedOutdated: false, shown: PAGE, ...unhide(state, ["feedFailed"]) } };
    }
    case "read": {
      const sample = SAMPLE.find((x) => x.id === arg);
      // The answer's ui opens the pop-up once the tree with this story is drawn (never with the last one's body).
      if (sample && state.feed && state.feed.failed) return { state: { reading: { ...sample, text: "", loading: false, outlet: null, target: null } }, ui: [{ open: STORY_POPUP }] };
      const story = await readStory(String(arg || ""), lang);
      return story ? { state: { reading: story }, ui: [{ open: STORY_POPUP }] } : null;
    }
    case "storyClosed":
      return { state: { reading: null } };
    case "openStory": {
      // «Ver noticia»: the outlet's page (else Google's link) in the browser; Kino asks the person first (on a TV, a QR).
      const r = state.reading;
      if (!isObj(r) || r.id !== arg || !httpsOrNull(r.target, 2048)) return null;
      return { go: { url: { href: r.target, title: str(r.source || "Google News", 60) } }, state: { reading: null }, ui: [{ close: STORY_POPUP }] };
    }
    case "classifyNow": {
      // The person's tap: one question to the AI about the next 10 headlines it has not sorted (Kino refuses it elsewhere).
      const r = await classifyNow(cacheOf(), realClock, budgetFor(deviceKind()), askAi);
      const s = stored(lang);
      const feed = state.feed ? { ...state.feed, items: r.stories.slice(0, MAX_CARDS).map((x) => cardOf(x, buildTerms(s), s.loadMedia)) } : state.feed;
      return r.done
        ? { state: { feed }, toast: { text: r.done + " noticias clasificadas", textEn: r.done + " stories sorted", role: "success", ms: 2500 } }
        : { toast: { text: "La IA no respondió: quedan las categorías por palabras clave", textEn: "The AI did not answer: the keyword categories stay", role: "warning" } };
    }
    case "pickTab": {
      // A pure state change, never a request or a storage read or write: the tab shows what the state and the last reads
      // hold (the watched titles were read when the screen opened). After a settings change Noticias reloads by the
      // RELOAD timer, once drawn.
      const tab = typeof value === "string" ? value : arg;
      if (tab !== "settings" && tab !== "news") return null;
      return { state: tab === "settings" ? { tab, settingsError: null } : { tab, shown: PAGE } };
    }
    case "media":
      return { state: changed, config: { loadMedia: value === true }, toast: SAVED };
    case "ai":
      return { state: changed, config: { useAi: value === true }, toast: SAVED };
    case "sampleLibrary": {
      // The sample list is read at once; the stored setting may lag a moment behind this answer.
      const on = value === true;
      const titles = on ? watchedTitles(SAMPLE_WATCHED, 100) : [];
      if (on) cacheOf().set(KEYS.watched, titles);
      else if (typeof kino.library !== "object") cacheOf().set(KEYS.watched, []);
      return { state: { ...changed, watched: on ? titles : undefined }, config: { sampleLibrary: on }, toast: SAVED };
    }
    case "library": {
      const on = value === true;
      if (!on) return { state: changed, config: { useLibrary: false }, toast: SAVED };
      const w = await readWatched();
      const s = stored(lang);
      const usable = watchedTitles(w.titles, watchedRoom(s.libraryCount, s.terms.length), [...s.excluded, ...s.terms]);
      // At least one term: with nothing watched to use and no term of their own, the switch stays off.
      if (usable.length === 0 && s.terms.length === 0) {
        return { state: { watched: w.titles, libraryDenied: w.denied, settingsError: MESSAGES.needOne, inputs: { useLibrary: false } } };
      }
      return { state: { ...changed, watched: w.titles, libraryDenied: w.denied }, config: { useLibrary: true }, toast: SAVED };
    }
    case "count": {
      const s = stored(lang);
      const n = Math.max(1, Math.min(MAX_TERMS - s.terms.length, parseInt(value, 10) || 1));
      return { state: changed, config: { libraryCount: String(n) }, toast: SAVED };
    }
    case "excludeWatched": {
      const t = String(arg || "");
      const { s, watched } = settingsView(state, lang);
      if (!t || s.excluded.some((x) => x.toLowerCase() === t.toLowerCase())) return null;
      if (s.terms.length === 0 && watched.length <= 1) return { state: { settingsError: MESSAGES.needOne } };
      cacheOf().set(KEYS.excluded, [...s.excluded, t].slice(-200));
      return { state: changed, toast: SAVED };
    }
    case "restoreWatched":
      cacheOf().set(KEYS.excluded, []);
      return { state: changed, toast: SAVED };
    case "addTerm": {
      const text = value && typeof value === "object" ? value.newTerm : (state.inputs || {}).newTerm;
      const { s, watched } = settingsView(state, lang);
      const r = addTerm(s.terms, text, watched.length);
      if (r.error) return { state: { addError: MESSAGES[r.error] } };
      // The answer's ui closes the pop-up; focus goes back to the button that opened it.
      return {
        state: { ...changed, addError: null, inputs: { newTerm: "" } },
        config: { terms: r.terms.map((term) => ({ term })) },
        ui: [{ close: ADD_POPUP }],
        focus: "addTermButton",
        toast: SAVED,
      };
    }
    case "addDismissed":
      // Dismissed (Back, Kino's close): nothing left over for the next time.
      return { state: { addError: null, inputs: { newTerm: "" } } };
    case "cancelAdd":
      // «Cancelar»: closed, nothing left over for the next time; focus back on the button.
      return { state: { addError: null, inputs: { newTerm: "" } }, ui: [{ close: ADD_POPUP }], focus: "addTermButton" };
    case "removeTerm": {
      const t = String(arg || "").toLowerCase();
      const { s, watched } = settingsView(state, lang);
      const terms = s.terms.filter((x) => x.toLowerCase() !== t);
      if (terms.length === s.terms.length) return null;
      if (s.useLibrary && terms.length === 0 && watched.length === 0) return { state: { settingsError: MESSAGES.needOne } };
      return { state: changed, config: { terms: terms.map((term) => ({ term })) }, toast: SAVED };
    }
    default:
      return null;
  }
}
