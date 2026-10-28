// The work queue's frame: a fetch within a budget, the stages in order, what is still pending.

import { budgetFor, META_TTL_MS, PAGE_TIMEOUT_MS, READ_BYTES, RETRY_MS, utf8Bytes } from "../limits.js";

/**
 * A budget for one step: [b] (see `budgetFor`) against [clock] (`{ now(), sleep(ms) }`). `fetch` waits `fetchGapMs` after
 * the previous request (on the injected clock), counts each request and the size of each answer, and refuses (an error
 * with `budget: true`) once any limit is reached.
 */
export function budgeted(fetch, b, clock) {
  const limits = { ...budgetFor("phone"), ...(b || {}) };
  const started = clock.now();
  const u = { fetches: 0, bytes: 0, last: null, limits };
  u.elapsed = () => clock.now() - started;
  // A request may take PAGE_TIMEOUT_MS and read up to [size] bytes: it starts only when both still fit.
  u.canFetch = (size = READ_BYTES.rss) => u.fetches < limits.maxFetches && u.bytes + size <= limits.maxBytes && u.elapsed() + limits.fetchGapMs + PAGE_TIMEOUT_MS <= limits.maxMs;
  /** [opts].maxBytes is required in spirit: without one the RSS size is assumed and asked for. */
  u.fetch = async (url, opts) => {
    const o = { timeoutMs: PAGE_TIMEOUT_MS, maxBytes: READ_BYTES.rss, ...(opts || {}) };
    if (!u.canFetch(o.maxBytes)) throw Object.assign(new Error("over the step budget"), { budget: true });
    if (u.last !== null) {
      const wait = u.last + limits.fetchGapMs - clock.now();
      if (wait > 0) await clock.sleep(wait);
    }
    u.fetches++;
    u.last = clock.now();
    const r = await fetch(url, o);
    let body = await r.text();
    // A Kino older than maxBytes reads the whole answer: never keep more than asked for.
    if (body.length > o.maxBytes) body = body.slice(0, o.maxBytes);
    u.bytes += Math.min(utf8Bytes(body), o.maxBytes);
    return { ok: r.ok, status: r.status, text: body };
  };
  return u;
}

const STAGES = ["resolve", "meta", "categorize"];

/** The order of the stages in a step: each step starts one further along, so no stage waits behind another for long. */
export function stageOrder(turn) {
  const n = STAGES.length;
  const k = ((Math.floor(Number(turn)) || 0) % n + n) % n;
  return [...STAGES.slice(k), ...STAGES.slice(0, k)];
}

/** True while a story's page data may be used: a day when the page gave something, an hour when it did not. */
export function metaFresh(rec, now) {
  if (!rec.m || now < rec.m) return false;
  return now - rec.m < (rec.ok ? META_TTL_MS : RETRY_MS);
}

/**
 * The stories each stage would take now, in window order (the first cards first), at most `batch` each:
 * - resolve: no outlet address yet and not tried in the last hour, among the first `enrichFirst`;
 * - meta: an address and no page data that is still fresh, among the first `enrichFirst`;
 * - categorize: only guessed so far and not asked in the last hour, among the first `aiFirst`, when the AI is on.
 */
export function pending(stories, { loadMedia = true, useAi = false } = {}, b = budgetFor("phone"), now = 0) {
  const out = { resolve: [], meta: [], categorize: [] };
  stories.forEach((s, index) => {
    if (loadMedia && index < b.enrichFirst) {
      if (!s.u) {
        if ((!s.r || now - s.r >= RETRY_MS || now < s.r) && out.resolve.length < b.batch) out.resolve.push(s);
      } else if (!metaFresh(s, now) && out.meta.length < b.batch) out.meta.push(s);
    }
    if (useAi && index < b.aiFirst && s.a !== 1 && (!s.q || now - s.q >= RETRY_MS || now < s.q) && out.categorize.length < b.batch) out.categorize.push(s);
  });
  return out;
}
