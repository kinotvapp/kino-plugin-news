// Categories: a keyword guess, and Kino's text AI (when the person turns it on) with its prompt and answer.

import { fold } from "../util/text.js";
import { isObj } from "../util/values.js";

export const CATEGORIES = [
  { value: "world", label: "Mundo", labelEn: "World" },
  { value: "politics", label: "Política", labelEn: "Politics" },
  { value: "business", label: "Economía", labelEn: "Business" },
  { value: "tech", label: "Tecnología", labelEn: "Technology" },
  { value: "science", label: "Ciencia", labelEn: "Science" },
  { value: "health", label: "Salud", labelEn: "Health" },
  { value: "sports", label: "Deportes", labelEn: "Sports" },
  { value: "entertainment", label: "Entretenimiento", labelEn: "Entertainment" },
  { value: "film", label: "Cine y TV", labelEn: "Film & TV" },
  { value: "other", label: "Otros", labelEn: "Other" },
];
export const CATEGORY_KEYS = CATEGORIES.map((c) => c.value);

// Most specific first: a film's box office is film, not business.
const KEYWORDS = [
  ["film", ["pelicula", "serie ", "series", "estreno", "taquilla", "netflix", "hbo", "disney", "anime", "trailer", "film", "movie", "episode", "episodio", "temporada", "season", "box office", "oscar", "cine", "actor", "actriz", "actress"]],
  ["sports", ["futbol", "gol ", "goles", "liga", "copa", "partido", "seleccion", "mundial", "balon de oro", "tenis", "nba", "nfl", "formula 1", "ciclismo", "beisbol", "football", "soccer", "tournament", "torneo", "olimpic", "olympic", "champions"]],
  ["tech", ["tecnologia", "inteligencia artificial", " ia ", " ai ", " app ", "iphone", "android", "google", "apple", "microsoft", "software", "ciberataque", "hacker", "smartphone", "openai", "technology", "startup", "videojuego", "video game", "consola"]],
  ["science", ["ciencia", "cientific", "investigadores", "estudio revela", "fisica", "quimica", "biologia", "science", "scientist", "researchers", "study finds"]],
  ["health", ["salud", "hospital", "vacuna", "virus", "medic", "enfermedad", "cancer", "covid", "dengue", "health", "vaccine", "disease", "doctor", "epidemia", "pandemia"]],
  ["business", ["economia", "dolar", "inflacion", "mercado", "bolsa", "empresa", "banco", "precio", "petroleo", "exportacion", "economy", "market", "stocks", "bank", "inflation", "price", "oil ", "business", "comercio", "aranceles", "tariff"]],
  ["politics", ["presidente", "gobierno", "congreso", "senado", "eleccion", "ministro", "fiscalia", "partido politico", "alcalde", "gobernador", "president", "government", "election", "senate", "minister", "parliament", "corte", "court"]],
  ["world", ["guerra", "onu", "ucrania", "rusia", "israel", "gaza", "china", "europa", "internacional", "war ", "united nations", "ukraine", "russia", "europe", "embajada", "migrantes", "migrants"]],
  ["entertainment", ["musica", "concierto", "cantante", "album", "festival", "farandula", "celebridad", "music", "concert", "singer", "celebrity", "reality", "premios", "awards", "influencer"]],
];

/** A category from the title's words (accents and case aside), the fallback while the AI is off, unavailable or wrong. */
export function guessCategory(title) {
  const t = " " + fold(title).replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ") + " ";
  for (const [category, words] of KEYWORDS) if (words.some((w) => t.includes(w))) return category;
  return "other";
}

/**
 * The question for the AI: `{ system, prompt }` with only `[{ id, title }]` (at most [max], titles at most 200 characters)
 * and the fixed category list; the answer must be JSON only, `[{ id, category }]`.
 */
export function buildCategoryPrompt(stories, max = 40, hideAdult = true) {
  const items = stories.slice(0, max).map((s) => ({ id: String(s.id), title: String(s.t !== undefined ? s.t : s.title).slice(0, 200) }));
  const keys = hideAdult === false ? CATEGORY_KEYS : [...CATEGORY_KEYS, "adult"];
  return {
    system: "You classify news headlines. Answer with JSON only: an array of {\"id\": string, \"category\": string}, one per headline, " +
      "using exactly one of these categories: " + keys.join(", ") + ". Use \"other\" when none fits." +
      (hideAdult === false ? "" : " Use \"adult\" for sexual, pornographic or otherwise 18+ content.") + " No prose, no code fences.",
    prompt: JSON.stringify(items),
  };
}

/**
 * The AI's answer read strictly: `{ [id]: category }` for the ids of [stories] only and known categories only (an unknown
 * one becomes "other"). JSON inside prose or code fences is found; anything unreadable gives `{}`. Never throws.
 */
export function parseCategories(text, stories, allowAdult = false) {
  const ids = new Set(stories.map((s) => String(s.id)));
  const s = String(text || "");
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start < 0 || end <= start) return {};
  let rows;
  try { rows = JSON.parse(s.slice(start, end + 1)); } catch (e) { return {}; }
  const out = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!isObj(r) || typeof r.id !== "string" || !ids.has(r.id) || out[r.id]) continue;
    const c = typeof r.category === "string" ? r.category.trim().toLowerCase() : "";
    out[r.id] = CATEGORY_KEYS.includes(c) || (allowAdult && c === "adult") ? c : "other";
  }
  return out;
}

/**
 * Kino's text AI (`kino.ai.ask`, capability "ai", the person's approval): one question, JSON asked for, the reply's text or
 * null (no AI on this Kino, refused, unavailable, rate limited, timed out). Kino only answers it inside the scheduled job or an
 * event that follows the person's tap («Clasificar ahora»), never on open or a timer tick. The reply is untrusted:
 * `parseCategories` keeps only known ids and categories.
 */
export async function askAi(prompt, system) {
  if (typeof kino === "undefined" || typeof kino.ai !== "object" || typeof kino.ai.ask !== "function") return null;
  const r = await kino.ai.ask({ prompt, system, json: true, maxChars: 1500 });
  return r && r.ok === true && typeof r.text === "string" ? r.text : null;
}
