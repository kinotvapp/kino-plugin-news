// A story's page (pure): Google's article link to the outlet's address, then its picture and description.

import { DESC_CHARS } from "../limits.js";
import { clip, decodeEntities, stripHtml } from "../util/html.js";

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
