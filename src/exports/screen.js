// `screen`: a pure view of what is stored, the Noticias or the Configuración tab.

import { isEn } from "../ui/format.js";
import { header, RELOAD, TICK } from "../ui/header.js";
import { newsTab } from "../ui/news-tab.js";
import { settingsTab } from "../ui/settings-tab.js";

export async function screen({ state, lang }) {
  const en = isEn(lang);
  const now = Date.now();
  const tab = state.tab === "settings" ? "settings" : "news";
  // Back on Noticias after a settings change: the tab switch itself stays a pure state change, and this one-second timer
  // does the reload right after the tab is drawn (once: its answer clears feedOutdated).
  const every = tab === "news" && state.feedOutdated ? [TICK, RELOAD] : TICK;
  return {
    type: "col", every,
    children: [
      header(tab, state.feed, now, en),
      { type: "divider", key: "headerLine" },
      // Shown at once by the refresh tap (Kino's own ui operation), hidden by the answer: under the header, on either tab.
      {
        type: "row", key: "refreshing", hidden: true, gap: 8, align: "center", padding: { left: 16, right: 16 },
        // One label only: Kino's progress bar draws its own label beside the bar (a sibling text would show it twice).
        children: [{ type: "progress", label: "Actualizando…", labelEn: "Refreshing…", weight: 1 }],
      },
      tab === "settings" ? settingsTab(state, lang) : newsTab(state, en, now),
    ],
  };
}
