// The 18+ filter: a basic word list (whole words and phrases) and adult domains, on by default; matching a term.

import { fold } from "../util/text.js";
import { isObj } from "../util/values.js";

//
// Conservative on purpose: whole words and phrases (accents and case aside, punctuation as a space), in Spanish, English,
// Portuguese and French, plus the names of well-known adult sites and their domains. "sex" alone, "adult" alone, "erótico"
// alone, "escort" alone (a Ford Escort, a convoy's escort) and "XXX" after "Super Bowl" are NOT matched: the screen's own
// caption says it is a basic filter that may miss things.

/** Whole words (after folding) that mark a text as 18+. */
const ADULT_WORDS = [
  "porn", "porno", "pornos", "xxx", "nsfw", "+18", "18+", "hentai", "milf", "milfs", "bdsm", "sextape", "sextapes", "nudes",
  "camgirl", "camgirls", "striptease", "onlyfans", "fansly", "pornhub", "xvideos", "xnxx", "xhamster", "redtube", "youporn",
  "brazzers", "chaturbate", "stripchat", "spankbang", "livejasmin", "eporner", "prostitucion", "prostitution", "prostituicao",
  "prostituta", "prostitutas", "prostitute", "prostitutes", "prostituee", "prostituees", "orgia", "orgias", "orgy", "orgies",
  "masturbacion", "masturbation", "masturbacao",
];
/** Word starts (after folding) that mark a text as 18+: pornografía, pornographie, pornography, pornstar. */
const ADULT_STEMS = ["pornograf", "pornograph", "pornstar"];
/** Phrases (after folding, words separated by one space) that mark a text as 18+. */
const ADULT_PHRASES = [
  "sex tape", "sex tapes", "sex video", "sex videos", "video sexual", "videos sexuales", "video porno", "videos porno",
  "explicit sex", "sexually explicit", "sexo explicito", "sexe explicite", "contenido sexual explicito", "contenido para adultos",
  "contenido adulto", "adult content", "adult film", "adult films", "adult movie", "adult movies", "adult video", "adult videos",
  "adult site", "adult sites", "adult website", "adult entertainment", "adult star", "adult actress", "adult actor",
  "actriz porno", "actor porno", "cine para adultos", "pelicula para adultos", "peliculas para adultos", "erotico explicito",
  "erotica explicita", "escort service", "escort services", "escort agency", "escort girl", "escort girls", "escort de lujo",
  "escorts de lujo", "servicio de escort", "servicio de escorts", "servicios de escort", "servicios de escorts",
  "garota de programa", "garotas de programa", "filme adulto", "filmes adultos", "film pour adultes", "films pour adultes",
  "film porno", "strip club", "strip clubs", "club de striptease", "oral sex", "anal sex", "sexo oral", "sexo anal",
  "sexe oral", "sexe anal",
];
/** Well-known adult sites: a story whose outlet address is on one of them (or a subdomain) is dropped. */
export const ADULT_DOMAINS = [
  "pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com", "redtube.com", "youporn.com", "onlyfans.com", "fansly.com",
  "chaturbate.com", "stripchat.com", "brazzers.com", "spankbang.com", "beeg.com", "eporner.com", "livejasmin.com",
  "cam4.com", "motherless.com", "tnaflix.com",
];

/** [text] folded for the filter: lowercase, no accents, anything but letters, digits and "+" as one space, padded. */
function adultText(text) {
  // A percentage ("+18 %") is a number, not an age mark.
  const t = fold(text).replace(/[+-]?\d+(?:[.,]\d+)?\s?%/g, " ").replace(/[^a-z0-9+]+/g, " ").replace(/\b(adult[oa]s) mayores\b/g, "mayores").replace(/\s+/g, " ").trim();
  return " " + t + " ";
}

/** True when [text] (a title, a source's name, a description, a search term) looks 18+ by the word lists. Pure. */
export function isAdult(text) {
  if (typeof text !== "string" || !text.trim()) return false;
  const t = adultText(text);
  for (const w of ADULT_WORDS) {
    if (!t.includes(" " + w + " ")) continue;
    if (w === "xxx" && /( bowl| olimpiadas?| olympics?| edicion| edition) xxx /.test(t) && t.split(" xxx ").length === 2) continue;
    return true;
  }
  if (ADULT_STEMS.some((w) => t.includes(" " + w))) return true;
  return ADULT_PHRASES.some((ph) => t.includes(" " + ph + " "));
}

/** True when [url]'s host is one of ADULT_DOMAINS or under one. Pure. */
export function isAdultUrl(url) {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(String(url || ""));
  if (!m) return false;
  const host = m[1].toLowerCase().replace(/\.$/, "");
  return ADULT_DOMAINS.some((d) => host === d || host.endsWith("." + d));
}

/** A stored record (or a card) that the 18+ filter drops: its title, source, description or outlet, or the AI's "adult". */
export function adultRecord(r) {
  if (!isObj(r)) return false;
  return r.c === "adult" || isAdult(r.t !== undefined ? r.t : r.title) || isAdult(r.s !== undefined ? r.s : r.source) ||
    isAdult(r.d !== undefined ? r.d : r.desc) || isAdultUrl(r.u !== undefined ? r.u : r.url);
}

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
