// The story a pop-up shows, read on the person's tap: its record, then its text from the outlet's page.

import { parsePageMeta } from "./page.js";
import { ARTICLE_CHARS, ARTICLES_KEY, extractArticle, keptArticles } from "./text.js";
import { decodeArticleUrl } from "../feed/google-news.js";
import { adultRecord, isAdultUrl, matchTerm } from "../filter/adult.js";
import { budgetFor, PAGE_TIMEOUT_MS, READ_BYTES, STEP_MAX_BYTES } from "../limits.js";
import { cacheOf, deviceKind, localOf, realClock, stored } from "../state/load.js";
import { KEYS } from "../store/cache.js";
import { fitSize, validStories } from "../store/stories.js";
import { buildTerms } from "../terms/terms.js";
import { budgeted } from "../work/stages.js";
import { resolveArticle } from "../work/step.js";

/**
 * The story the pop-up shows, read by the person's tap: its record, then (when pages may be read) its text from the
 * outlet's page, kept for the 25 stories opened last. One or three requests, on demand: never part of `step`.
 */
export async function readStory(id, lang) {
  const cache = cacheOf();
  const s = stored(lang);
  const stories = validStories(cache.get(KEYS.stories));
  const rec = stories.find((x) => x.id === id);
  // A story the 18+ filter drops is never opened, and its page never read.
  if (!rec || (s.hideAdult && adultRecord(rec))) return null;
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
        if (s.hideAdult && isAdultUrl(rec.u)) {
          cache.set(KEYS.stories, fitSize(stories.filter((x) => x.id !== id)));
          return null;
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
