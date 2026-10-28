// The Noticias tab: the feed's banners, the category filter, the grid, the pop-up.

import { CARD_SPAN, categoryOptions, grid, PAGE, PICTURE_CARDS, storiesOf, storyCard } from "./cards.js";
import { BODY_PADDING, REFRESH_TAP } from "./header.js";
import { storyPopup } from "./story-popup.js";

/** When the last manual refresh started, on this device (kino.storage): one every MANUAL_GAP_MS. */
export const MANUAL_AT_KEY = "manualRefreshAt";

export function newsTab(state, en, now) {
  const feed = state.feed;
  // No heading or hint over the cards: the header says when the news were updated, the cards say why they are here.
  const top = [];
  if (feed && feed.failed) {
    top.push({
      type: "banner", key: "feedFailed", role: "error", dismissible: true,
      title: "No se pudo cargar Google Noticias", titleEn: "Google News could not be loaded",
      text: "Mostramos noticias de ejemplo. Revisa tu conexión.", textEn: "Showing sample stories. Check your connection.",
      action: { label: "Reintentar", labelEn: "Retry", onTap: REFRESH_TAP },
    });
  }
  if (feed && feed.libraryDenied) {
    top.push({
      type: "banner", key: "libraryDenied", role: "warning", dismissible: true,
      text: "Kino no deja a este plugin leer lo que viste: actívalo en el ajuste del plugin.", textEn: "Kino does not let this plugin read what you watched: allow it in the plugin's settings.",
    });
  }
  const stories = storiesOf(feed);
  let body;
  if (!feed) body = [grid(Array.from({ length: 6 }, () => ({ type: "skeleton", shape: "card", span: CARD_SPAN })))];
  else if (stories.length === 0) {
    body = [{
      type: "emptyState", icon: "info", title: "Nada por aquí", titleEn: "Nothing here",
      text: "Google Noticias no trajo artículos para tus términos. Prueba con otros en Configuración.", textEn: "Google News returned no articles for your terms. Try others in Settings.",
    }];
  } else {
    const tabs = categoryOptions(stories);
    const cat = tabs.some((o) => o.value === state.cat) ? state.cat : "all";
    const inCat = cat === "all" ? stories : stories.filter((s) => (s.cat || "other") === cat);
    const count = Math.max(PAGE, Number.isInteger(state.shown) ? state.shown : PAGE);
    const shown = inCat.slice(0, count);
    body = [
      // Kino's tab strip, a second row under the screen's tabs (it scrolls sideways when the categories do not fit); a
      // small gap under it before the cards.
      { type: "tabs", key: "category", tabs, value: cat, onChange: "category", padding: { compact: { bottom: 4 }, expanded: { bottom: 8 } } },
      grid(shown.map((s, i) => storyCard(s, en, now, i < PICTURE_CARDS))),
      ...(inCat.length > shown.length ? [{
        type: "button", key: "moreButton", variant: "secondary", label: "Ver más (" + (inCat.length - shown.length) + ")",
        labelEn: "Show more (" + (inCat.length - shown.length) + ")", onTap: { event: "more", arg: String(count + PAGE) },
      }] : []),
      storyPopup(state, en, now),
    ];
  }
  return { type: "scroll", key: "newsBody", weight: 1, children: [{ type: "col", gap: 12, padding: BODY_PADDING, children: [...top, ...body] }] };
}
