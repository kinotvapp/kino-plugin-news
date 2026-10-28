// «Actualizar ahora»: a few `step`s in a row, spaced, and a gap before the next manual refresh.

import { budgetFor, PAGE_TIMEOUT_MS, READ_BYTES } from "../limits.js";
import { KEYS } from "../store/cache.js";
import { validStories } from "../store/stories.js";
import { step } from "./step.js";

/** A manual refresh: at most this many steps, at most one every MANUAL_GAP_MS. */
export const MANUAL_STEPS = 3;
export const MANUAL_GAP_MS = 30000;

/**
 * The person's «Actualizar ahora»: the same `step`, in the foreground, a few times in a row (MANUAL_STEPS at most), all of them
 * together within ONE step budget ([budget]: requests, bytes and time are shared, never more than one job run may read), the
 * feed forced on the first, never the AI. [lastAt] is when the last manual refresh started: within MANUAL_GAP_MS nothing runs
 * (`throttled`). It stops when a step changes nothing, or the feed cannot be read (the cache stays as it was). Answers
 * `{ throttled, failed, newCount, changed, stories, fetchedAt, steps, fetches, bytes }`; newCount compares the stories' ids
 * before and after.
 */
export async function manualRefresh(cache, fetch, settings, clock, budget = budgetFor("phone"), lastAt = 0) {
  const started = clock.now();
  if (lastAt && started >= lastAt && started - lastAt < MANUAL_GAP_MS) return { throttled: true };
  const b = { ...budgetFor("phone"), ...(budget || {}) };
  const before = new Set(validStories(cache.get(KEYS.stories)).map((x) => x.id));
  let bytes = 0;
  let fetches = 0;
  let steps = 0;
  let changed = false;
  let failed = false;
  let last = null;
  for (let i = 0; i < MANUAL_STEPS; i++) {
    const left = { maxBytes: b.maxBytes - bytes, maxMs: b.maxMs - (clock.now() - started), maxFetches: b.maxFetches - fetches };
    if (left.maxBytes < READ_BYTES.rss || left.maxFetches < 1 || left.maxMs < b.fetchGapMs + PAGE_TIMEOUT_MS) break;
    const r = await step(cache, fetch, { ...settings, force: i === 0 }, clock, { ...b, ...left }, null);
    steps++;
    bytes += r.bytes;
    fetches += r.fetches;
    last = r;
    if (i === 0 && r.failed) { failed = true; break; }
    if (!r.changed) break;
    changed = true;
  }
  const stories = last ? last.stories : validStories(cache.get(KEYS.stories));
  return {
    throttled: false, failed, changed, stories, fetchedAt: last ? last.fetchedAt : 0, terms: last ? last.terms : [], steps, fetches, bytes,
    newCount: stories.filter((x) => !before.has(x.id)).length,
  };
}

/** Kept for readers of the earlier example: the same as `step`. */
export const refresh = step;
