// The tabs' row with the refresh button, the paddings, the timers.


/** The tap that refreshes: show «Actualizando…» at once, then the event that does the work (a press: Kino lets it fetch). */
export const REFRESH_TAP = { ui: [{ show: "refreshing" }], event: "refreshNow" };

const TABS = [
  { value: "news", label: "Noticias", labelEn: "News" },
  { value: "settings", label: "Configuración", labelEn: "Settings" },
];

/**
 * The timer that moves the work forward while the screen is open: every 10 s one `step` (a few spaced requests at most); it
 * does nothing when the feed is fresh and every story it may enrich is done.
 */
export const TICK = { ms: 10000, event: "tick" };
/** The reload after a settings change, armed only while Noticias shows an outdated feed. */
export const RELOAD = { ms: 1000, event: "reload" };

/**
 * The refresh button at the right end of the tabs' row, on both tabs: the circular arrow only (variant icon). Its label is
 * not drawn: it is what TalkBack reads and what the TV's focus announces; on a TV Kino draws its focus ring around it.
 */
const REFRESH_BUTTON = {
  type: "button", key: "refreshButton", icon: "refresh", label: "Actualizar ahora", labelEn: "Refresh now",
  variant: "icon", onTap: REFRESH_TAP,
};

/** Room under the header row in every size class, so the content scrolling under it never touches it (then a divider). */
export const HEADER_PADDING = { compact: { end: 8, bottom: 8 }, medium: { start: 8, end: 8, bottom: 8 }, expanded: { start: 16, end: 16, top: 8, bottom: 12 } };

/**
 * The tab bodies' padding, for the static layout only: the header stays outside their scroll, and the first heading starts
 * 12 dp (16 on a TV) under the header's divider. Kino's TV already scrolls a focused item into view with its own margin, so
 * this is not doubled for focus.
 */
export const BODY_PADDING = { compact: { start: 16, end: 16, top: 12, bottom: 16 }, medium: 16, expanded: { start: 24, end: 24, top: 16, bottom: 24 } };

/**
 * The header, the same on a phone and a TV: Kino's tab strip on the left (it takes the room left), then the refresh icon on the right. On a TV Left and Right walk the tabs and, past the last one, reach the refresh icon in
 * the same row (ui.md, TabBar); Down goes to the content.
 */
export function header(tab, feed = null, now = Date.now(), en = false) {
  const cluster = [REFRESH_BUTTON];
  return {
    type: "row", key: "header", gap: { compact: 8, expanded: 12 }, align: "center", padding: HEADER_PADDING,
    children: [{ type: "tabs", key: "tabs", tabs: TABS, value: tab, onChange: "pickTab", weight: 1 }, ...cluster],
  };
}
