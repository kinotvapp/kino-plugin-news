// Small view helpers: the language, the category's label, a card's byline and why it is there, its placeholder.

import { CATEGORIES } from "../categories/categories.js";
import { timeAgo } from "../util/time.js";

export const isEn = (lang) => String(lang || "").startsWith("en");
export const pick = (o, field, en) => (en && o[field + "En"]) || o[field];
export const categoryLabel = (c, en) => {
  const x = CATEGORIES.find((k) => k.value === c) || CATEGORIES[CATEGORIES.length - 1];
  return en ? x.labelEn : x.label;
};

/** The first line of a card: the outlet and how long ago. */
export function byline(story, en, now) {
  const who = story.source || "Google News";
  return [who, timeAgo(story.ts, now, en)].filter(Boolean).join(" · ");
}

/** Why a story is here: the watched title or the term it matches. */
export function whyOf(story, en) {
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
export function placeholder(story) {
  return {
    type: "col", align: "center", justify: "center", padding: 12,
    children: [{ type: "text", text: initialOf(story.source), style: "h1", color: accentFor(story.source) }],
  };
}
