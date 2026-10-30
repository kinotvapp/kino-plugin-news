// The story cards and the grid they are drawn in (one per row on a phone, two on a medium window, three on a TV).

import { CATEGORIES } from "../categories/categories.js";
import { byline, pick, placeholder, whyOf } from "./format.js";
import { str } from "../util/values.js";

/** A card's share of the twelve columns: one per row on a phone (compact), two on a medium window, three on a TV. */
export const CARD_SPAN = { compact: 12, medium: 6, expanded: 4 };

/** Cards draw their picture edge to edge (`card.flush`: no card padding for the children, clipped to the card's shape). */
export const CARD_FLUSH = true;
export const STORY_POPUP = "story";

/** A story's picture with its placeholder as the fallback (no url, or one that does not load). */
export function pictureOf(story, en, radius = null) {
  return {
    type: "image", aspect: "16:9", alt: pick(story, "title", en), fallback: placeholder(story),
    ...(story.image ? { url: story.image } : {}), ...(radius ? { radius } : {}),
  };
}

/**
 * The cards drawn at first, and how many more each «Ver más» adds: the tree stays small (a TV box draws and checks every
 * node of it on each answer), and the rest of the feed waits in the state until the person asks for it.
 */
export const PAGE = 12;
/** Only the first cards carry a picture (two pages); the later ones are text cards, so a long page never loads 40 pictures. */
export const PICTURE_CARDS = 2 * PAGE;
/** A card's description in the state and the tree: three lines at most are shown, the pop-up reads the full record. */
export const CARD_DESC_CHARS = 140;

/** One story as a card: picture (or placeholder) on top, outlet and time, title, a short description, why it is here. */
export function storyCard(story, en, now, withPicture = true) {
  const desc = str(pick(story, "desc", en), CARD_DESC_CHARS);
  const why = whyOf(story, en);
  return {
    type: "card", key: "n" + story.id, variant: "outlined", radius: "medium", span: CARD_SPAN, ...(CARD_FLUSH && withPicture ? { flush: true } : {}),
    // The event reads the story; its answer opens the pop-up with the new body (an answer's ui).
    onTap: { event: "read", arg: story.id },
    children: [
      ...(withPicture ? [pictureOf(story, en)] : []),
      {
        type: "col", gap: 4, padding: 12,
        children: [
          { type: "text", text: byline(story, en, now), style: "caption", color: "secondary", maxLines: 1 },
          { type: "text", text: pick(story, "title", en), style: "h5", maxLines: 3 },
          ...(desc ? [{ type: "text", text: desc, style: "p", color: "muted", maxLines: 3 }] : []),
          ...(why ? [{ type: "text", text: why, style: "caption", color: "primary", maxLines: 1 }] : []),
        ],
      },
    ],
  };
}

export const storiesOf = (feed) => (feed && feed.items) || [];

/** The category tabs: «Todas» first, then each category that has stories (only those), with its count. */
export function categoryOptions(stories) {
  const counts = {};
  for (const s of stories) counts[s.cat || "other"] = (counts[s.cat || "other"] || 0) + 1;
  return [
    { value: "all", label: "Todas (" + stories.length + ")", labelEn: "All (" + stories.length + ")" },
    ...CATEGORIES.filter((c) => counts[c.value]).map((c) => ({ value: c.value, label: c.label + " (" + counts[c.value] + ")", labelEn: c.labelEn + " (" + counts[c.value] + ")" })),
  ];
}

/** The cards on the twelve columns; a line's cells stretch to its tallest (no `align`), so a line of cards is even. */
export function grid(children) {
  return { type: "row", wrap: true, gap: 12, children };
}
