// `screenEvent`: every tap, setting and timer answered with a patch (and the texts of its messages).

import { readStory } from "../article/read-story.js";
import { askAi } from "../categories/categories.js";
import { budgetFor, MAX_CARDS, MAX_TERMS } from "../limits.js";
import {
  cacheOf, cardOf, deviceKind, hideAdultNow, loadFeed, localOf, readWatched, realClock, stored,
} from "../state/load.js";
import { KEYS } from "../store/cache.js";
import { addTerm, buildTerms } from "../terms/terms.js";
import { watchedRoom, watchedTitles } from "../terms/watched.js";
import { PAGE, STORY_POPUP } from "../ui/cards.js";
import { MANUAL_AT_KEY } from "../ui/news-tab.js";
import { SAMPLE } from "../ui/samples.js";
import { ADD_POPUP, settingsView } from "../ui/settings-tab.js";
import { httpsOrNull, isObj, str } from "../util/values.js";
import { MANUAL_GAP_MS, manualRefresh } from "../work/manual.js";
import { classifyNow } from "../work/step.js";

/** A banner the person dismissed comes back with the next load (its key out of `state.ui.hidden`). */
function unhide(state, keys) {
  const ui = state.ui || {};
  const hidden = { ...(ui.hidden || {}) };
  for (const k of keys) hidden[k] = false;
  return { ui: { ...ui, hidden } };
}

const MESSAGES = {
  duplicate: { es: "Ese término ya está en la lista", en: "That term is already on the list" },
  full: { es: "Ya hay 50 términos: quita uno primero", en: "There are already 50 terms: remove one first" },
  empty: { es: "Escribe un término", en: "Type a term" },
  needOne: { es: "Necesitas al menos un término: agrega uno o mira algo primero", en: "You need at least one term: add one or watch something first" },
};
const SAVED = { text: "Guardado", textEn: "Saved", role: "success", ms: 2000 };

export async function screenEvent({ name, arg, value, state, lang }) {
  // After a settings change the feed reloads the next time Noticias shows (the feed key changed with the terms).
  const changed = { feedOutdated: true, settingsError: null };
  switch (name) {
    case "open": {
      // Every way in comes here first: one step (the cache when it is still fresh; the screen shows skeletons meanwhile).
      const { feed } = await loadFeed(lang);
      // What Configuración shows of the library comes from this read (the tab switch reads nothing).
      return { state: { feed, libraryDenied: feed.libraryDenied === true } };
    }
    case "tick": {
      // Every 10 s while the screen is open: one step of work. A tick never reads the library (only what the person does
      // may): it uses the titles read last.
      const r = await loadFeed(lang, { personStarted: false });
      return r.changed ? { state: { feed: r.feed } } : null;
    }
    case "refreshNow": {
      // «Actualizar ahora» (a person's tap; never from open or a tick): a few steps now, never the AI, at most one every 30 s.
      const hideLine = [{ hide: "refreshing" }];
      const local = localOf();
      const lastAt = Number(local.get(MANUAL_AT_KEY)) || 0;
      const nowMs = Date.now();
      if (lastAt && nowMs >= lastAt && nowMs - lastAt < MANUAL_GAP_MS) {
        return { ui: hideLine, toast: { text: "Espera un momento: acabas de actualizar", textEn: "Wait a moment: you just refreshed", role: "warning", ms: 2500 } };
      }
      local.set(MANUAL_AT_KEY, nowMs);
      const s = stored(lang);
      let denied = false;
      if (s.useLibrary) {
        const w = await readWatched();
        s.titles = w.titles;
        denied = w.denied;
      }
      const r = await manualRefresh(cacheOf(), kino.fetch, s, realClock, budgetFor(deviceKind()), 0);
      const terms = r.steps ? r.terms : buildTerms(s);
      console.log("manual refresh: " + r.steps + " steps, " + r.fetches + " requests, " + Math.round(r.bytes / 1024) + " KB, " + r.newCount + " new");
      const failed = r.failed && r.stories.length === 0;
      const feed = {
        items: r.stories.slice(0, MAX_CARDS).map((x) => cardOf(x, terms, s.loadMedia)), fetchedAt: r.fetchedAt || (state.feed && state.feed.fetchedAt) || 0,
        failed, stale: r.failed && r.stories.length > 0, terms: terms.length, libraryDenied: denied,
      };
      const toast = r.failed
        ? { text: "No se pudo actualizar: sin conexión con Google Noticias", textEn: "Could not refresh: no connection to Google News", role: "error" }
        : r.newCount > 0
          ? { text: r.newCount === 1 ? "Hay 1 noticia nueva" : "Hay " + r.newCount + " noticias nuevas", textEn: r.newCount === 1 ? "1 new story" : r.newCount + " new stories", role: "success", ms: 2500 }
          : r.changed
            ? { text: "Noticias al día", textEn: "News up to date", role: "success", ms: 2000 }
            : { text: "Sin novedades", textEn: "Nothing new", ms: 2000 };
      return { state: { feed, ...unhide(state, ["feedFailed"]) }, ui: hideLine, toast };
    }
    case "category": {
      // A pure state change: the first page of that category.
      const cat = typeof value === "string" ? value : Array.isArray(value) && typeof value[0] === "string" ? value[0] : null;
      return cat ? { state: { cat, shown: PAGE } } : null;
    }
    case "more": {
      // «Ver más»: the next page, from what the state already holds (no request, no storage).
      const n = Number(arg);
      return Number.isInteger(n) && n > 0 ? { state: { shown: Math.min(MAX_CARDS, n) }, focus: null } : null;
    }
    case "reload": {
      // The one-second timer armed when Noticias shows after a settings change: one step with the new settings.
      if (!state.feedOutdated) return null;
      const { feed } = await loadFeed(lang, { force: true, personStarted: false });
      return { state: { feed, feedOutdated: false, shown: PAGE, ...unhide(state, ["feedFailed"]) } };
    }
    case "read": {
      const sample = SAMPLE.find((x) => x.id === arg);
      // The answer's ui opens the pop-up once the tree with this story is drawn (never with the last one's body).
      if (sample && state.feed && state.feed.failed) return { state: { reading: { ...sample, text: "", loading: false, outlet: null, target: null } }, ui: [{ open: STORY_POPUP }] };
      const story = await readStory(String(arg || ""), lang);
      return story ? { state: { reading: story }, ui: [{ open: STORY_POPUP }] } : null;
    }
    case "storyClosed":
      return { state: { reading: null } };
    case "openStory": {
      // «Ver noticia»: the outlet's page (else Google's link) in the browser; Kino asks the person first (on a TV, a QR).
      const r = state.reading;
      if (!isObj(r) || r.id !== arg || !httpsOrNull(r.target, 2048)) return null;
      return { go: { url: { href: r.target, title: str(r.source || "Google News", 60) } }, state: { reading: null }, ui: [{ close: STORY_POPUP }] };
    }
    case "classifyNow": {
      // The person's tap: one question to the AI about the next 10 headlines it has not sorted (Kino refuses it elsewhere).
      const r = await classifyNow(cacheOf(), realClock, budgetFor(deviceKind()), askAi, stored(lang).hideAdult);
      const s = stored(lang);
      const feed = state.feed ? { ...state.feed, items: r.stories.slice(0, MAX_CARDS).map((x) => cardOf(x, buildTerms(s), s.loadMedia)) } : state.feed;
      return r.done
        ? { state: { feed }, toast: { text: r.done + " noticias clasificadas", textEn: r.done + " stories sorted", role: "success", ms: 2500 } }
        : { toast: { text: "La IA no respondió: quedan las categorías por palabras clave", textEn: "The AI did not answer: the keyword categories stay", role: "warning" } };
    }
    case "pickTab": {
      // A pure state change, never a request or a storage read or write: the tab shows what the state and the last reads
      // hold (the watched titles were read when the screen opened). After a settings change Noticias reloads by the
      // RELOAD timer, once drawn.
      const tab = typeof value === "string" ? value : arg;
      if (tab !== "settings" && tab !== "news") return null;
      // The 18+ filter is changed in Kino's settings node, which tells the plugin nothing: the filter Configuración opened
      // with is kept, and Noticias reloads when the person left it different.
      if (tab === "settings") return { state: { tab, settingsError: null, adultWas: hideAdultNow() } };
      const adultChanged = typeof state.adultWas === "boolean" && state.adultWas !== hideAdultNow();
      return { state: { tab, shown: PAGE, adultWas: null, ...(adultChanged ? { feedOutdated: true } : {}) } };
    }
    case "media":
      return { state: changed, config: { loadMedia: value === true }, toast: SAVED };
    case "ai":
      return { state: changed, config: { useAi: value === true }, toast: SAVED };
    case "library": {
      const on = value === true;
      if (!on) return { state: changed, config: { useLibrary: false }, toast: SAVED };
      const w = await readWatched();
      const s = stored(lang);
      const usable = watchedTitles(w.titles, watchedRoom(s.libraryCount, s.terms.length), [...s.excluded, ...s.terms]);
      // At least one term: with nothing watched to use and no term of their own, the switch stays off.
      if (usable.length === 0 && s.terms.length === 0) {
        return { state: { watched: w.titles, libraryDenied: w.denied, settingsError: MESSAGES.needOne, inputs: { useLibrary: false } } };
      }
      return { state: { ...changed, watched: w.titles, libraryDenied: w.denied }, config: { useLibrary: true }, toast: SAVED };
    }
    case "count": {
      const s = stored(lang);
      const n = Math.max(1, Math.min(MAX_TERMS - s.terms.length, parseInt(value, 10) || 1));
      return { state: changed, config: { libraryCount: String(n) }, toast: SAVED };
    }
    case "excludeWatched": {
      const t = String(arg || "");
      const { s, watched } = settingsView(state, lang);
      if (!t || s.excluded.some((x) => x.toLowerCase() === t.toLowerCase())) return null;
      if (s.terms.length === 0 && watched.length <= 1) return { state: { settingsError: MESSAGES.needOne } };
      cacheOf().set(KEYS.excluded, [...s.excluded, t].slice(-200));
      return { state: changed, toast: SAVED };
    }
    case "restoreWatched":
      cacheOf().set(KEYS.excluded, []);
      return { state: changed, toast: SAVED };
    case "addTerm": {
      const text = value && typeof value === "object" ? value.newTerm : (state.inputs || {}).newTerm;
      const { s, watched } = settingsView(state, lang);
      const r = addTerm(s.terms, text, watched.length);
      if (r.error) return { state: { addError: MESSAGES[r.error] } };
      // The answer's ui closes the pop-up; focus goes back to the button that opened it.
      return {
        state: { ...changed, addError: null, inputs: { newTerm: "" } },
        config: { terms: r.terms.map((term) => ({ term })) },
        ui: [{ close: ADD_POPUP }],
        focus: "addTermButton",
        toast: SAVED,
      };
    }
    case "addDismissed":
      // Dismissed (Back, Kino's close): nothing left over for the next time.
      return { state: { addError: null, inputs: { newTerm: "" } } };
    case "cancelAdd":
      // «Cancelar»: closed, nothing left over for the next time; focus back on the button.
      return { state: { addError: null, inputs: { newTerm: "" } }, ui: [{ close: ADD_POPUP }], focus: "addTermButton" };
    case "removeTerm": {
      const t = String(arg || "").toLowerCase();
      const { s, watched } = settingsView(state, lang);
      const terms = s.terms.filter((x) => x.toLowerCase() !== t);
      if (terms.length === s.terms.length) return null;
      if (s.useLibrary && terms.length === 0 && watched.length === 0) return { state: { settingsError: MESSAGES.needOne } };
      return { state: changed, config: { terms: terms.map((term) => ({ term })) }, toast: SAVED };
    }
    default:
      return null;
  }
}
