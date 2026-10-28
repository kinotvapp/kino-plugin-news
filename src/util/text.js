// Folding a text for matching (lower case, no accents) and trimming a search term (pure).

import { TERM_CHARS } from "../limits.js";

export const termOf = (raw) => String(raw || "").replace(/\s+/g, " ").trim().slice(0, TERM_CHARS).trim();

export const fold = (s) => {
  let t = String(s || "").toLowerCase();
  try { t = t.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) { /* no normalize: plain lowercase */ }
  return t;
};
