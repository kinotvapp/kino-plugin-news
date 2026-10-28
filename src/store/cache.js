// The cache: one small adapter over kino.shared, falling back to kino.storage, and the keys the plugin uses.

//
// Everything the plugin keeps goes through `cache.get(key)` / `cache.set(key, value)` (JSON values). The feed, the stories,
// the work state and the excluded titles live in kino.shared, so the device that does the work (a linked phone, by the job's
// runOn "preferPhone") hands the result to the others; without kino.shared (an older Kino, or a refused write) they fall back
// to kino.storage on this device. What comes back is checked like any outside input: another device, maybe another version
// of this plugin, wrote it.

/** The cache adapter over a `{ get, set }` string store (kino.storage): JSON in, JSON out; a value over [maxBytes] is refused. */
export function makeCache(store, maxBytes = 256 * 1024) {
  let written = 0;
  return {
    get(key) {
      try { return JSON.parse(store.get(key) || "null"); } catch (e) { return null; }
    },
    set(key, value) {
      const text = JSON.stringify(value);
      if (text.length > maxBytes) throw new Error("cache value over " + maxBytes + " bytes: " + key);
      written += text.length;
      store.set(key, text);
    },
    /** Characters written through this adapter so far. */
    written: () => written,
  };
}

/**
 * The cache adapter over kino.shared ([shared]: `{ get, set }` of JSON values), with [fallback] (a `makeCache`) for when it
 * is missing or refuses: a value is read from kino.shared, else from the fallback; a write goes to kino.shared, else to the
 * fallback. A value equal to the one last read or written is not written again (kino.shared counts writes a minute).
 */
export function makeSharedCache(shared, fallback) {
  const last = new Map();
  let written = 0;
  const usable = shared && typeof shared.get === "function" && typeof shared.set === "function";
  return {
    get(key) {
      let v = null;
      if (usable) { try { v = shared.get(key); } catch (e) { v = null; } }
      if (v === null || v === undefined) v = fallback.get(key);
      last.set(key, JSON.stringify(v));
      return v;
    },
    set(key, value) {
      const text = JSON.stringify(value);
      if (last.get(key) === text) return;
      if (text.length > 64 * 1024) throw new Error("shared value over 64 KB: " + key);
      last.set(key, text);
      written += text.length;
      if (usable) {
        try { shared.set(key, value); return; } catch (e) { /* not allowed, too large or too many writes: keep it here */ }
      }
      fallback.set(key, value);
    },
    written: () => written,
  };
}

/** The keys the plugin uses: in kino.shared (at most 4: feed, stories, work, excluded) and, on this device only, the rest. */
export const KEYS = { feed: "feed", stories: "stories", work: "work", excluded: "excluded", watched: "watched" };
/** The stories' value is kept under this many characters of JSON (kino.shared takes 64 KB a value). */
export const STORIES_MAX_CHARS = 60000;
