// HTML entities and tags to plain text, and clipping a text (pure).

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", iexcl: "¡", iquest: "¿", middot: "·", deg: "°", euro: "€", copy: "©", reg: "®",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü", ccedil: "ç", agrave: "à", egrave: "è",
  atilde: "ã", otilde: "õ", acirc: "â", ecirc: "ê", ocirc: "ô",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Uuml: "Ü", Ccedil: "Ç",
};

/** Decodes HTML entities (&amp;, &#8217;, &#x2014;...); an unknown one stays as written. */
export function decodeEntities(s) {
  return String(s || "").replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,7});/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const known = ENTITIES[name] !== undefined ? ENTITIES[name] : ENTITIES[name.toLowerCase()];
    return known === undefined ? whole : known;
  });
}

/** Plain text: spaces collapsed, cut at [max] characters with an ellipsis. */
export function clip(s, max) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** HTML to plain text: tags dropped, entities decoded, spaces collapsed. */
export function stripHtml(s) {
  return clip(decodeEntities(String(s || "").replace(/<[^>]*>/g, " ")), 2000);
}
