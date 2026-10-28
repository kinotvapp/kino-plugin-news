// The stored story: compact, no HTML, no pictures; its id, its checks, the merged window and its size.

import { CATEGORY_KEYS, guessCategory } from "../categories/categories.js";
import { adultRecord, isAdult, isAdultUrl } from "../filter/adult.js";
import { DESC_CHARS, MAX_STORIES } from "../limits.js";
import { STORIES_MAX_CHARS } from "./cache.js";
import { httpsOrNull, isObj, str, time } from "../util/values.js";

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
export function mergeWindow(stored, lists, max = MAX_STORIES, hideAdult = true) {
  const byId = new Map(stored.map((x) => [x.id, x]));
  const titles = new Set(stored.map((x) => x.t.toLowerCase().replace(/\s+/g, " ")));
  const out = hideAdult === false ? [...stored] : stored.filter((x) => !adultRecord(x));
  for (const item of lists.flat()) {
    // With the 18+ filter on, an adult headline, source or outlet never enters the window (nor the cache, nor the counts).
    if (hideAdult !== false && (isAdult(item.title) || isAdult(item.source) || isAdultUrl(item.url))) continue;
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
