// A story's text, read from the outlet's page when the person opens it, and the texts kept on this device (pure).

import { clip, stripHtml } from "../util/html.js";
import { isObj, time } from "../util/values.js";

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
