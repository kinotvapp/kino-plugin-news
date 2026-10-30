// Reading Google News (pure): the editions, the RSS address, the article link's own address, the feed's items.

import { MAX_URL } from "../limits.js";
import { clip, decodeEntities, stripHtml } from "../util/html.js";
import { rfcTime } from "../util/time.js";

const GOOGLE_NEWS = "https://news.google.com/rss";
export const MAX_ITEMS = 60; // stories read from one RSS answer

export const EDITIONS = {
  co: { hl: "es-419", gl: "CO", ceid: "CO:es-419" },
  us: { hl: "en-US", gl: "US", ceid: "US:en" },
};

/** The edition for Kino's language: English reads the US edition, anything else the Latin American Spanish one (Colombia). */
export function editionFor(lang) {
  return String(lang || "").startsWith("en") ? "us" : "co";
}

/** The feed's address: a search [q] (no q is the front page; the plugin never asks for it), in [edition] ("co" or "us"; anything else is "co"). */
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
