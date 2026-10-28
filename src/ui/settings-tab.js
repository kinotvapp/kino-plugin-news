// The Configuración tab: frequency, pictures and texts, the text AI, the watched titles and the person's own terms.

import { isAdult } from "../filter/adult.js";
import { MAX_TERMS, TERM_CHARS } from "../limits.js";
import { stored } from "../state/load.js";
import { validWatched, watchedKey, watchedRoom, watchedTitles } from "../terms/watched.js";
import { BODY_PADDING } from "./header.js";
import { isObj, str } from "../util/values.js";

/** Under a term or watched title the 18+ filter keeps out of the searches. */
const HIDDEN_NOTE = { type: "text", style: "caption", color: "warning", text: "Oculto por el filtro +18", textEn: "Hidden by the 18+ filter" };

/** A removable term: its text (and «Oculto por el filtro +18» when the filter keeps it out) and a «Quitar» button. */
function termRow(key, text, event, arg, hidden = false) {
  return {
    type: "row", key, gap: 8, align: "center",
    children: [
      hidden ? { type: "col", weight: 1, gap: 4, children: [{ type: "text", text, style: "p", maxLines: 2 }, HIDDEN_NOTE] } : { type: "text", text, style: "p", weight: 1, maxLines: 2 },
      { type: "button", variant: "text", label: "Quitar", labelEn: "Remove", onTap: { event, arg } },
    ],
  };
}

/** A watched work as a removable row: the title, its kind as a chip (the year beside it when the library has one). */
function watchedRow(key, w, hidden = false) {
  const kindEs = w.kind === "series" ? "Serie" : "Película";
  const kindEn = w.kind === "series" ? "Series" : "Movie";
  return {
    type: "row", key, gap: 8, align: "center",
    children: [
      hidden ? { type: "col", weight: 1, gap: 4, children: [{ type: "text", text: w.title, style: "p", maxLines: 2 }, HIDDEN_NOTE] } : { type: "text", text: w.title, style: "p", weight: 1, maxLines: 2 },
      { type: "badge", text: kindEs + (w.year ? " · " + w.year : ""), textEn: kindEn + (w.year ? " · " + w.year : "") },
      { type: "button", variant: "text", label: "Quitar", labelEn: "Remove", onTap: { event: "excludeWatched", arg: watchedKey(w) } },
    ],
  };
}

/** What the Configuración tab shows and checks: the stored settings and the watched titles that would be searched. */
export function settingsView(state, lang) {
  const s = stored(lang);
  const titles = Array.isArray(state.watched) ? validWatched(state.watched) : s.titles;
  const room = watchedRoom(s.libraryCount, s.terms.length);
  const watched = s.useLibrary ? watchedTitles(titles, room, [...s.excluded, ...s.terms]) : [];
  return { s, titles, watched, total: s.terms.length + watched.length, hidden: (t) => s.hideAdult && isAdult(t) };
}

export const ADD_POPUP = "addTerm";

export function settingsTab(state, lang) {
  const { s, watched, total, hidden } = settingsView(state, lang);
  const section = (es, en) => ({ type: "text", text: es, textEn: en, style: "h4" });
  const note = (es, en, color = "muted") => ({ type: "text", style: "caption", color, text: es, textEn: en });
  const children = [
    note("Cada cambio se guarda al momento.", "Every change is saved right away."),
    section("Actualizar las noticias", "Refresh the news"),
    { type: "text", style: "p", text: "Se actualizan solas con el trabajo «Actualizar las noticias»: actívalo y elige cada cuánto en Ajustes ▸ Noticias.", textEn: "They refresh by themselves with the job “Refresh the news”: turn it on and pick how often in Settings ▸ News." },
    note("Al abrir esta pantalla se actualizan si tienen más de una hora.", "When this screen opens they refresh if they are over an hour old."),
    section("Imágenes y textos", "Pictures and texts"),
    { type: "toggle", key: "loadMedia", label: "Cargar imágenes y descripciones de los medios", labelEn: "Load pictures and descriptions from the outlets", value: s.loadMedia, onChange: "media" },
    note(
      "Para mostrarlas, tu aparato abre la página de cada noticia en el sitio del medio, poco a poco. Apagado: sin conexiones a los medios, tarjetas sin foto y solo el resumen de Google.",
      "To show them, your device opens each story's page on the outlet's site, a few at a time. Off: no connection to the outlets, cards without photos and only Google's summary.",
    ),
    section("Contenido +18", "18+ content"),
    // Kino's own settings form for this one setting: its manifest entry says "unlockWith": "adultCode", so switching it off
    // asks the device's 18+ code first (switching it on never does). The form draws the hint and its own Guardar.
    { type: "settings", key: "adultSettings", keys: ["hideAdult"] },
    note("Para apagarlo, Kino te pide su código de control parental; luego pulsa Guardar.", "To switch it off, Kino asks for its parental control code; then press Save."),
    section("Clasificar", "Sort into categories"),
    { type: "toggle", key: "useAi", label: "Clasificar con IA", labelEn: "Sort with AI", value: s.useAi, onChange: "ai" },
    note(
      "Si lo activas, los titulares (solo el texto del titular) se envían al servicio de IA de terceros que usa Kino para elegir su categoría, de 10 en 10, en segundo plano o cuando pulses «Clasificar ahora». Apagado: se clasifican por palabras clave en tu aparato.",
      "If you switch it on, the headlines (only the headline text) are sent to the third-party AI service Kino uses to pick their category, 10 at a time, in the background or when you press “Sort now”. Off: they are sorted by keywords on your device.",
      "warning",
    ),
    ...(s.useAi ? [{ type: "button", key: "classifyButton", variant: "secondary", icon: "magic", label: "Clasificar ahora", labelEn: "Sort now", onTap: "classifyNow" }] : []),
    section("Lo que has visto", "What you watched"),
    { type: "toggle", key: "useLibrary", label: "Usar lo que he visto", labelEn: "Use what I watched", value: s.useLibrary, onChange: "library" },
    note(
      "Si lo activas, los títulos de las películas y series que viste se envían a Google Noticias como términos de búsqueda.",
      "If you switch it on, the titles of the movies and series you watched are sent to Google News as search terms.",
      "warning",
    ),
  ];
  if (s.useLibrary) {
    const max = Math.max(1, MAX_TERMS - s.terms.length);
    children.push({ type: "stepper", key: "libraryCount", label: "Títulos recientes", labelEn: "Recent titles", min: 1, max, value: Math.min(s.libraryCount, max), onChange: "count" });
    if (state.libraryDenied) {
      children.push({ type: "banner", key: "settingsDenied", role: "warning", text: "Kino no deja a este plugin leer lo que viste.", textEn: "Kino does not let this plugin read what you watched." });
    } else if (watched.length === 0) {
      children.push({ type: "text", style: "p", color: "muted", text: "No hay títulos vistos para usar.", textEn: "No watched titles to use." });
    }
    watched.forEach((w, i) => children.push(watchedRow("w" + i, w, hidden(w.title))));
    if (s.excluded.length) {
      children.push({
        type: "row", gap: 8, align: "center",
        children: [
          { type: "text", style: "caption", color: "muted", weight: 1, text: s.excluded.length + " títulos quitados no se buscan.", textEn: s.excluded.length + " removed titles are not searched." },
          { type: "button", variant: "text", label: "Volver a usarlos", labelEn: "Use them again", onTap: "restoreWatched" },
        ],
      });
    }
  }
  children.push(section("Tus términos", "Your terms"));
  children.push(note(total + " de " + MAX_TERMS + " términos en total.", total + " of " + MAX_TERMS + " terms in all."));
  children.push({
    type: "button", key: "addTermButton", variant: "secondary", icon: "magic", label: "Agregar término", labelEn: "Add term",
    enabled: total < MAX_TERMS, onTap: { ui: [{ open: ADD_POPUP }] },
  });
  s.terms.forEach((t, i) => children.push(termRow("t" + i, t, "removeTerm", t, hidden(t))));
  if (isObj(state.settingsError)) children.push({ type: "banner", key: "settingsError", role: "error", text: str(state.settingsError.es, 200), textEn: str(state.settingsError.en, 200) });
  // The pop-up that adds a term. Kino checks the field (required, at most 40 characters) before the plugin sees it; the
  // plugin checks the rest (a repeated term, 50 in all) and says so inside the pop-up.
  children.push({
    type: "popup", key: ADD_POPUP, kind: "dialog", title: "Nuevo término", titleEn: "New term", onClose: "addDismissed",
    children: [{
      type: "form", key: "termForm", onSubmit: "addTerm", gap: 12,
      children: [
        {
          type: "textInput", key: "newTerm", label: "Término", labelEn: "Term", hint: "Por ejemplo: Dragon Ball", hintEn: "For example: Dragon Ball",
          maxLength: TERM_CHARS, required: true, errorText: "Escribe un término de hasta 40 letras", errorTextEn: "Type a term of up to 40 characters",
        },
        ...(isObj(state.addError) ? [{ type: "text", style: "caption", color: "error", text: str(state.addError.es, 200), textEn: str(state.addError.en, 200) }] : []),
        { type: "button", label: "Guardar", labelEn: "Save", submit: true },
      ],
    }],
    buttons: [{ label: "Cancelar", labelEn: "Cancel", event: "cancelAdd" }],
  });
  return { type: "scroll", key: "settingsBody", weight: 1, children: [{ type: "col", padding: BODY_PADDING, gap: 12, children }] };
}
