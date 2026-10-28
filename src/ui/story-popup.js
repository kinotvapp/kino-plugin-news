// The story pop-up: its picture, its text in paragraphs and «Ver noticia».

import { pictureOf, STORY_POPUP } from "./cards.js";
import { byline, categoryLabel, pick, whyOf } from "./format.js";
import { isObj } from "../util/values.js";

/** Text cut into paragraphs that fit a text node (2000 characters each). */
function paragraphs(text) {
  const out = [];
  for (const p of String(text || "").split(/\n{2,}/)) {
    for (let i = 0; i < p.length; i += 1900) out.push(p.slice(i, i + 1900));
  }
  return out.filter((p) => p.trim());
}

/**
 * The story pop-up, declared in the tree: all of it scrolls. The picture (or its placeholder), the title, outlet, time and
 * category, the text, «Ver noticia» (the browser, after Kino asks) and, on a TV, the address as a QR. Kino draws its close.
 * It shows `state.reading`; the `read` answer opens it with that body.
 */
export function storyPopup(state, en, now) {
  const r = state.reading;
  const children = [];
  if (!isObj(r)) {
    children.push({ type: "skeleton", shape: "block", h: 160 });
    children.push({ type: "skeleton", shape: "line", lines: 6 });
    return { type: "popup", key: STORY_POPUP, kind: "dialog", children, onClose: "storyClosed" };
  }
  children.push(pictureOf(r, en, "small"));
  children.push({ type: "text", text: pick(r, "title", en), style: "h3" });
  children.push({
    type: "row", gap: 8, align: "center",
    children: [
      { type: "text", text: byline(r, en, now), style: "caption", color: "secondary", weight: 1 },
      { type: "badge", text: categoryLabel(r.cat, en) },
    ],
  });
  const why = whyOf(r, en);
  if (why) children.push({ type: "text", style: "caption", color: "primary", text: why });
  if (r.text) {
    children.push({ type: "text", style: "caption", color: "muted", text: "Extracto de la página del medio; puede estar incompleto (por ejemplo, si es de pago).", textEn: "An extract of the outlet's page; it may be partial (for example, behind a paywall)." });
    for (const p of paragraphs(r.text)) children.push({ type: "text", style: "p", text: p });
  } else if (pick(r, "desc", en)) {
    children.push({ type: "text", style: "p", text: pick(r, "desc", en) });
  } else {
    children.push({ type: "text", style: "p", color: "muted", text: "No pudimos leer el texto de esta noticia. Ábrela en el sitio del medio.", textEn: "We could not read this story's text. Open it on the outlet's site." });
  }
  // On a TV the address is also a QR (the TV's browser is the phone in the person's hand); a phone opens it with the button.
  if (r.target) {
    const tv = ["tv"];
    children.push({ type: "divider", devices: tv });
    children.push(r.outlet
      ? { type: "text", style: "p", devices: tv, text: "Escanea el código para leer el artículo en el sitio del medio.", textEn: "Scan the code to read the article on the outlet's site." }
      : {
        type: "text", style: "p", devices: tv,
        text: "Aún no tenemos la dirección del medio: el código abre el enlace de Google Noticias, que lleva al artículo.",
        textEn: "We do not have the outlet's address yet: the code opens the Google News link, which leads to the article.",
      });
    children.push({ type: "qr", devices: tv, value: r.target, size: "medium", label: r.outlet ? "Artículo" : "Google Noticias", labelEn: r.outlet ? "Article" : "Google News" });
  }
  const buttons = r.target ? [{ label: "Ver noticia", labelEn: "Open story", event: "openStory", arg: r.id, variant: "primary" }] : [];
  return { type: "popup", key: STORY_POPUP, kind: "dialog", children, buttons, onClose: "storyClosed" };
}
