// Solo noticias (Just News): a Kino plugin with a screen of its own and a background job (apiVersion 14). Two tabs:
//
// - Noticias: a Google News feed (news.google.com RSS, no key) drawn as a grid of cards (one per row on a phone, two on a
//   medium window, three on a TV). It searches the person's own terms and, unless they switch it off, the titles of the
//   movies and series they watched most recently (kino.library), each narrowed to its kind ("Avatar" película). With no term
//   at all it reads nothing and shows an empty state, never Google's front page. Google's feed has no pictures, so (when the
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
// on saved fixtures).
//
// The state lives in Kino, never here: `screen` is a pure view of it, `screenEvent` answers with a patch. Every text the
// person reads has a Spanish base and an English twin (`textEn`, `labelEn`...), and Kino picks one by its language.
//
// This file is the entry of the source tree: it only re-exports the plugin's public surface from src/. The shipped
// plugin.js is generated from it by `npm run build` (esbuild, one readable ES module); never edit plugin.js by hand.
// The README's "How the code is organized" says which folder owns what.

export {
  parseArticleParams, batchExecuteRequest, parseBatchExecute, resolveHttps, headOf, parsePageMeta,
} from "./article/page.js";
export {
  ARTICLE_CHARS, ARTICLE_KEEP, ARTICLE_PAGE_CHARS, ARTICLES_KEY, extractArticle, keptArticles,
} from "./article/text.js";
export { CATEGORIES, guessCategory, buildCategoryPrompt, parseCategories, askAi } from "./categories/categories.js";
export { job } from "./exports/job.js";
export { screenEvent } from "./exports/screen-event.js";
export { screen } from "./exports/screen.js";
export { editionFor, googleNewsUrl, decodeArticleUrl, relatedOf, parseGoogleNews } from "./feed/google-news.js";
export { ADULT_DOMAINS, isAdult, isAdultUrl, adultRecord, matchTerm } from "./filter/adult.js";
export {
  MAX_TERMS, TERM_CHARS, MAX_URL, MAX_STORIES, MAX_CARDS, DESC_CHARS, META_TTL_MS, RETRY_MS, FREQUENCIES_MIN,
  STALE_AFTER_MIN, STEP_MAX_BYTES, READ_BYTES, utf8Bytes, budgetFor,
} from "./limits.js";
export { makeCache, makeSharedCache, KEYS, STORIES_MAX_CHARS } from "./store/cache.js";
export { storyId, validRecord, validStories, mergeWindow, fitSize } from "./store/stories.js";
export { cleanTerms, addTerm, buildTerms, qualifierFor, termQuery, batchQueries, pickBatches } from "./terms/terms.js";
export { watchedKey, watchedTitles, validWatched, watchedRoom } from "./terms/watched.js";
export { CARD_FLUSH, PAGE, PICTURE_CARDS, CARD_DESC_CHARS, categoryOptions } from "./ui/cards.js";
export { accentFor, initialOf } from "./ui/format.js";
export { TICK, RELOAD, HEADER_PADDING, BODY_PADDING, header } from "./ui/header.js";
export { decodeEntities, stripHtml } from "./util/html.js";
export { rfcTime, timeAgo } from "./util/time.js";
export { MANUAL_STEPS, MANUAL_GAP_MS, manualRefresh, refresh } from "./work/manual.js";
export { frequencyMs, feedKeyOf, isFresh } from "./work/schedule.js";
export { budgeted, stageOrder, metaFresh, pending } from "./work/stages.js";
export { classifyNow, step } from "./work/step.js";
