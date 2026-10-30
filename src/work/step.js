// The work queue: `step`, one budgeted pass (feed, article links, pictures, categories) for the job and the screen.

import { batchExecuteRequest, parseArticleParams, parseBatchExecute, parsePageMeta } from "../article/page.js";
import { askAi, buildCategoryPrompt, parseCategories } from "../categories/categories.js";
import { decodeArticleUrl, EDITIONS, googleNewsUrl, MAX_ITEMS, parseGoogleNews } from "../feed/google-news.js";
import { adultRecord, isAdultUrl } from "../filter/adult.js";
import { budgetFor, MAX_STORIES, PAGE_TIMEOUT_MS, READ_BYTES } from "../limits.js";
import { KEYS } from "../store/cache.js";
import { fitSize, mergeWindow, validStories } from "../store/stories.js";
import { batchQueries, buildTerms, pickBatches } from "../terms/terms.js";
import { isObj, time } from "../util/values.js";
import { feedKeyOf, frequencyMs, isFresh } from "./schedule.js";
import { budgeted, pending, stageOrder } from "./stages.js";

/** The outlet's address of a Google article [link] through Google's own resolver (two requests, unofficial), else null. */
export async function resolveArticle(u, link, edition) {
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
 *    over time. No term: nothing is read. The results join the window of the newest 100 stories.
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
async function askCategories(batch, ask, b, u, now, hideAdult = true) {
  const q = buildCategoryPrompt(batch, b.batch, hideAdult);
  u.fetches++;
  let answer = null;
  try { answer = await ask(q.prompt, q.system); } catch (e) { answer = null; }
  // "adult" only with the filter on: those records are dropped at the next save, never shown as a category.
  const got = answer === null ? {} : parseCategories(answer, batch, hideAdult !== false);
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
export async function classifyNow(cache, clock, budget = budgetFor("phone"), ask = askAi, hideAdult = true) {
  const b = { ...budgetFor("phone"), ...(budget || {}) };
  let stories = validStories(cache.get(KEYS.stories));
  if (hideAdult !== false) stories = stories.filter((x) => !adultRecord(x));
  const batch = stories.slice(0, b.aiFirst).filter((x) => x.a !== 1).slice(0, b.batch);
  if (!batch.length || typeof ask !== "function") return { stories, done: 0 };
  const u = budgeted(() => Promise.reject(new Error("no requests here")), b, clock);
  const done = await askCategories(batch, ask, b, u, clock.now(), hideAdult);
  if (hideAdult !== false) stories = stories.filter((x) => !adultRecord(x));
  cache.set(KEYS.stories, fitSize(stories));
  const workRaw = cache.get(KEYS.work);
  cache.set(KEYS.work, { turn: isObj(workRaw) && Number.isFinite(workRaw.turn) ? workRaw.turn : 0, lastAsk: clock.now() });
  return { stories, done };
}

export async function step(cache, fetch, settings, clock, budget = budgetFor("phone"), ask = null) {
  const s = settings || {};
  const b = { ...budgetFor("phone"), ...(budget || {}) };
  const edition = EDITIONS[s.edition] ? s.edition : "co";
  // The 18+ filter is on unless the person switched it off; a feed read with it off has a key of its own.
  const hide = s.hideAdult !== false;
  const terms = buildTerms({ ...s, hideAdult: hide });
  const key = feedKeyOf(edition, terms) + (hide ? "" : "|18+");
  const u = budgeted(fetch, b, clock);
  const now = clock.now();
  const feedRaw = cache.get(KEYS.feed);
  const feed = isObj(feedRaw) && typeof feedRaw.key === "string" ? feedRaw : null;
  const sameTerms = !!feed && feed.key === key;
  let stories = sameTerms ? validStories(cache.get(KEYS.stories)) : [];
  if (hide) stories = stories.filter((x) => !adultRecord(x));
  let fetchedAt = sameTerms && Number.isFinite(feed.fetchedAt) ? feed.fetchedAt : 0;
  const workRaw = cache.get(KEYS.work);
  const work = { turn: isObj(workRaw) && Number.isFinite(workRaw.turn) ? workRaw.turn : 0, lastAsk: isObj(workRaw) ? time(workRaw.lastAsk) : 0 };
  let changed = false;
  let failed = false;
  const done = { resolve: 0, meta: 0, categorize: 0 };
  // What is found is stored at once, after the feed and after each stage: a run Kino cuts keeps everything before it.
  const save = () => {
    if (hide) stories = stories.filter((x) => !adultRecord(x));
    stories = fitSize(stories);
    cache.set(KEYS.stories, stories);
    cache.set(KEYS.work, work);
  };

  // 1. The feed.
  // No term, nothing to read: the news are only about what the person watched and their own topics, never Google's front page.
  if (terms.length > 0 && (s.force || !isFresh(feed, key, now, frequencyMs(s.frequencyMin)))) {
    const all = batchQueries(terms, edition);
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
      stories = mergeWindow(stories, lists, MAX_STORIES, hide);
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
          // An adult outlet: the record is dropped at the next save, its page never read.
          if (hide && isAdultUrl(rec.u)) rec.c = "adult";
        } catch (e) {
          if (e && e.budget) break;
          rec.r = now;
        }
        done.resolve++;
      }
    } else if (stage === "meta") {
      for (const rec of todo.meta) {
        if (!u.canFetch(READ_BYTES.head) || !rec.u) break;
        if (hide && adultRecord(rec)) continue;
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
      done.categorize = await askCategories(todo.categorize.filter((x) => !(hide && adultRecord(x))), ask, b, u, now, hide);
      work.lastAsk = now;
    }
    save();
  }
  if (done.resolve || done.meta || done.categorize) changed = true;
  save();
  return { stories, fetchedAt, terms, changed, failed, fetches: u.fetches, bytes: u.bytes, ms: u.elapsed(), done };
}
