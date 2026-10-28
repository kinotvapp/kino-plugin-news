// When the feed is due: the refresh frequency, the feed's key and whether it is still fresh (pure).

import { FREQUENCIES_MIN } from "../limits.js";
import { isObj } from "../util/values.js";

/** The minutes of the refresh setting as milliseconds (15 min to 24 h; anything else is 1 h). */
export function frequencyMs(minutes) {
  const m = Number(minutes);
  return (FREQUENCIES_MIN.includes(m) ? m : 60) * 60000;
}

/** What identifies a feed: the edition and the terms. Another edition or other terms make it stale at once. */
export function feedKeyOf(edition, terms) {
  return edition + "|" + terms.map((x) => (x.from === "watched" ? x.kind + ":" : "") + x.term.toLowerCase()).join("\n");
}

/** True when [feed] answers [key] and was fetched less than [everyMs] before [now] (a clock set back makes it stale). */
export function isFresh(feed, key, now, everyMs) {
  return isObj(feed) && feed.key === key && typeof feed.fetchedAt === "number" && now >= feed.fetchedAt && now - feed.fetchedAt < everyMs;
}
