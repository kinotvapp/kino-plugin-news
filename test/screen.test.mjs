// Solo noticias run with Kino's Node kit (sdk/): the same `kino` API and sandbox as the app, its answers read by
// the kit's screen validator (the app's PluginScreenOutput rules). Nothing here reaches the network: Google News, Google's
// resolver and the outlets' pages are saved, made-up samples (fixtures/) served by fake fetches, and the clock is injected.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createKino } from "../sdk/kino-shim.mjs";
import { createSharedDevices } from "../sdk/shared.mjs";
import { jobBudget, jobContext, jobKino, runJob } from "../sdk/job.mjs";
import { loadPlugin } from "../sdk/sandbox.mjs";
import { validate } from "../sdk/validate.mjs";
import { contract, requiredExports, validateManifest } from "../sdk/contract.mjs";
import { checkScreenAnswer, checkScreenTree, childNodes, fakeScreenContext, fakeScreenEvent } from "../sdk/screen.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "..");
const FIX = (name) => readFileSync(join(HERE, "fixtures", name), "utf8");
const MANIFEST_TEXT = readFileSync(join(DIR, "kino-plugin.json"), "utf8");
const MANIFEST = JSON.parse(MANIFEST_TEXT);
const RUN = join(HERE, "..", "sdk", "run.mjs");
const RSS = FIX("google-news-sample.xml");
const plain = (v) => JSON.parse(JSON.stringify(v));
const quiet = { log() {}, info() {}, warn() {}, error() {} };
const OPTS = { allowSeries: false, settings: MANIFEST.settings };

const OPAQUE = "https://news.google.com/rss/articles/CBMilgFBVV95cUxNeS1kaG9ncUFodHNvQmJRaGxQN1RXdXkwRlVIclN3MUJIQjBld2h6WGRVLVoybWY3TW0wa3YySEMzVDdOVWFvYnl1UW9WZVdkeGNEMU5NX0pYS3EzUmRBZXJURDVLZkdJYk12WXJRWnJ5R3loaFhLSFFJdnhOczMzZmdMa2o3MnhmUWRSVTBtbzFIR3hXLVE?oc=5";
const OLD = "https://news.google.com/rss/articles/CBMiOGh0dHBzOi8vd3d3LmV4YW1wbGUub3JnL2NpbmUvMjAxOS8wNS9hdmF0YXItc2VjdWVsYS5odG1s0gEA?oc=5";
const PUBLISHER = "https://www.example.org/cine/2019/05/avatar-secuela.html";
const RESOLVED = "https://www.diario.example/cine/2026/10/26/avatar-fuego-y-ceniza";
const PICTURE = "https://www.diario.example/fotos/2026/avatar-3.jpg?w=1200&h=675";
/** The watched titles the owner's examples use (movies and series). */
const WATCHED = [
  { title: "Avatar", kind: "movie", year: 2009 }, { title: "Avatar: The Last Airbender", kind: "series", year: 2024 },
  { title: "Breaking Bad", kind: "series", year: 2008 }, { title: "Dune", kind: "movie", year: 2021 },
  { title: "Stranger Things", kind: "series", year: 2016 }, { title: "One Piece", kind: "series", year: 2023 },
  { title: "Dragon Ball", kind: "series", year: 1986 },
].map((w, i) => ({ ...w, watchedAtMs: Date.UTC(2026, 9, 20 - i) }));

let shared = null;
/** The plugin loaded once for its pure functions. */
async function P() {
  if (!shared) {
    const { kino } = createKino(MANIFEST, { lang: "es-CO" });
    shared = (await loadPlugin(join(DIR, "plugin.js"), kino, { console: quiet })).plugin;
  }
  return shared;
}

/** A string store like kino.storage, in memory. */
const memStore = () => {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, String(v)), map: m };
};

/** An injected clock: `now` moves only when `sleep` is called or a fetch takes time. */
function fakeClock(start = Date.UTC(2026, 9, 27, 12)) {
  const c = { t: start, sleeps: [] };
  c.now = () => c.t;
  c.sleep = async (ms) => { c.sleeps.push(ms); c.t += ms; };
  return c;
}

/**
 * A fake network: Google News RSS (the sample, or [rss]), Google's article page and resolver, and the outlets' pages (the
 * article fixture by default). Every request is recorded with the clock's time; each takes [costMs] of the clock.
 */
function fakeNet({ rss = RSS, rssStatus = 200, page = FIX("publisher-article.html"), clock = null, costMs = 0, resolver = FIX("batchexecute-answer.txt") } = {}) {
  const seen = [];
  const fetch = async (url, opts = {}) => {
    const u = String(url);
    seen.push({ url: u, method: (opts && opts.method) || "GET", at: clock ? clock.t : 0, headers: (opts && opts.headers) || {} });
    if (clock) clock.t += costMs;
    let status = 200;
    let body = "";
    if (u.includes("/_/DotsSplashUi/")) body = resolver;
    else if (u.includes("news.google.com/rss/articles/")) body = FIX("google-article-page.html");
    else if (u.startsWith("https://news.google.com/rss")) { status = rssStatus; body = typeof rss === "function" ? rss(u) : rss; }
    else body = page;
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
  return { fetch, seen };
}

/** RSS with [n] items, the newest first, each an opaque Google link of its own. */
function rssOf(n, { from = 0, base = Date.UTC(2026, 9, 26, 12) } = {}) {
  const items = Array.from({ length: n }, (_, k) => {
    const i = from + k;
    const ts = new Date(base - i * 60000).toUTCString();
    return `<item><title>Estreno número ${i} de la semana en cines - Medio ${i % 7}</title><link>${OPAQUE.replace("CBM", "CBM" + i + "x")}</link><guid>${i}</guid><pubDate>${ts}</pubDate><source url="https://m${i % 7}.example">Medio ${i % 7}</source></item>`;
  });
  return `<rss><channel>${items.join("")}</channel></rss>`;
}

/** The plugin in the kit with a fake network for its screen events. */
async function rig({ net = {}, config = {}, lang = "es-CO", device = "phone", library = undefined, shared = undefined, ai = undefined, storageFile = null } = {}) {
  const n = fakeNet(net);
  const fetchImpl = async (url, init) => {
    const r = await n.fetch(url, init);
    return new Response(await r.text(), { status: r.status, headers: { "content-type": "text/html; charset=utf-8" } });
  };
  const { kino } = createKino(MANIFEST, { config: { terms: [{ term: "Dune" }], ...config }, fetchImpl, lang, device, libraryFixture: library, shared, ai, storageFile });
  const { plugin } = await loadPlugin(join(DIR, "plugin.js"), kino, { console: quiet });
  return { plugin, kino, seen: n.seen };
}

/** The tree Kino keeps of `screen(context)`, asserting nothing was dropped. */
async function tree(plugin, state, over = {}) {
  const ctx = fakeScreenContext({ ...over, state: { ...fakeScreenContext().state, ...state } });
  const r = checkScreenTree(await plugin.screen(ctx), ctx.lang, undefined, OPTS);
  assert.deepEqual(r.dropped, [], "nothing dropped");
  assert.ok(r.tree, "a valid root");
  return r.tree;
}

async function answer(plugin, name, { arg, value, state = {}, lang = "es" } = {}) {
  const s = { ...fakeScreenContext().state, ...state };
  const raw = await plugin.screenEvent(fakeScreenEvent(name, { arg, value, state: s, lang }));
  if (raw === null) return null;
  const r = checkScreenAnswer(raw, lang, OPTS);
  assert.deepEqual(r.dropped, [], "nothing dropped from the answer");
  return r.answer;
}

const all = (n) => [n, ...childNodes(n).flatMap(all)];
const ofType = (n, type) => all(n).filter((x) => x.type === type);
const cards = (t) => ofType(t, "card").filter((c) => /^n/.test(c.key));
const settingsBase = { edition: "co", terms: ["Dune"], titles: [], excluded: [], useLibrary: false, libraryCount: 5, frequencyMin: 60, loadMedia: true, useAi: false };

// ---------- the manifest ----------

test("the manifest: screen, library, a preferPhone job, shared results, the AI; Google News declared, any public host by consent", async () => {
  const m = validateManifest(MANIFEST_TEXT);
  assert.equal(m.ok, true, m.message);
  assert.equal(MANIFEST.apiVersion, contract.manifest.screen.apiVersion);
  assert.deepEqual(MANIFEST.capabilities, ["screen", "library", "schedule", "shared", "ai"]);
  assert.deepEqual(MANIFEST.jobs, [{ id: "refresh", label: { es: "Actualizar las noticias", en: "Refresh the news" }, everyMin: 60, everyOptions: [15, 30, 60, 180, 720, 1440], runOn: "preferPhone" }]);
  assert.equal(MANIFEST.jobs[0].everyMin, 60);
  const { plugin: pf } = await rig();
  assert.equal(pf.STALE_AFTER_MIN, MANIFEST.jobs[0].everyMin, "one frequency: the job's (Kino's row); the screen's staleness is its default");
  assert.deepEqual(MANIFEST.hosts, ["news.google.com"]);
  assert.equal(MANIFEST.fetchHosts, "any");
  assert.deepEqual(MANIFEST.settings.map((s) => s.key), ["loadMedia", "useAi", "useLibrary", "hideAdult", "libraryCount", "terms"]);
  assert.equal(MANIFEST.settings.find((s) => s.key === "useLibrary").default, true);
  assert.equal(MANIFEST.settings.find((s) => s.key === "useAi").default, false);
  assert.equal(MANIFEST.settings.find((s) => s.key === "loadMedia").default, true);
  const { plugin } = await rig();
  for (const e of requiredExports(m.manifest.capabilities, m.manifest.settings, m.manifest)) assert.equal(typeof plugin[e], "function", e);
  assert.equal(typeof plugin.job, "function");
  const v = await validate(DIR);
  assert.equal(v.ok, true, v.problems.join("\n"));
});
// ---------- reading Google News ----------

test("parseGoogleNews, decodeArticleUrl and the text helpers on the saved sample", async () => {
  const p = await P();
  const items = plain(p.parseGoogleNews(RSS));
  assert.deepEqual(items.map((i) => i.title), ["Avatar: Fuego y Ceniza confirma su fecha de estreno", "Breaking Bad cumple años y su elenco se reúne", "Cine & series: “Dune” vuelve a los cines"]);
  assert.deepEqual(items.map((i) => i.url), [null, PUBLISHER, null]);
  assert.equal(p.decodeArticleUrl(OLD), PUBLISHER);
  assert.equal(p.decodeArticleUrl(OPAQUE), null);
  assert.equal(p.rfcTime("Sat, 4 May 2019 10:00:00 +0200"), Date.UTC(2019, 4, 4, 8));
  const now = Date.UTC(2026, 9, 27, 12);
  assert.equal(p.timeAgo(now - 5 * 60000, now, false), "hace 5 min");
  assert.equal(p.timeAgo(now - 3 * 86400000, now, true), "3 days ago");
  assert.equal(p.decodeEntities("Pel&iacute;culas &amp; &laquo;se&ntilde;ales&raquo; &#8217; &bogus;"), "Películas & «señales» ’ &bogus;");
  assert.equal(p.googleNewsUrl({ q: "a & b", edition: "us" }), "https://news.google.com/rss/search?q=a%20%26%20b&hl=en-US&gl=US&ceid=US%3Aen");
  assert.equal(p.editionFor("en-GB"), "us");
  assert.equal(p.editionFor("es"), "co");
});

// ---------- terms: the person's, the watched ones, qualified by kind ----------

test("terms: clean, add (empty, duplicate, 50 in all), watched works by kind, the total clamped at 50", async () => {
  const p = await P();
  assert.deepEqual(plain(p.cleanTerms([{ term: "  Dragon   Ball " }, "dragon ball", "", "x".repeat(60)])), ["Dragon Ball", "x".repeat(40)]);
  assert.equal(p.addTerm(["A"], "  ").error, "empty");
  assert.equal(p.addTerm(["Dragon Ball"], "dragon BALL").error, "duplicate");
  assert.equal(p.addTerm(Array.from({ length: 45 }, (_, i) => "t" + i), "nuevo", 5).error, "full");
  assert.deepEqual(plain(p.addTerm(["A"], "B").terms), ["A", "B"]);
  const watched = [
    { title: "Avatar", kind: "movie", year: 2009 }, { title: "Avatar", kind: "movie" }, { title: "Avatar", kind: "series" },
    { title: "Breaking Bad", kind: "series", year: 2008 }, { title: "Otro", kind: "episode" }, { title: "Dune", kind: "movie" },
  ];
  assert.deepEqual(plain(p.watchedTitles(watched, 10)), [
    { title: "Avatar", kind: "movie", year: 2009 }, { title: "Avatar", kind: "series" }, { title: "Breaking Bad", kind: "series", year: 2008 }, { title: "Dune", kind: "movie" },
  ]);
  // A removed row excludes that kind only; one of the person's own terms covers both kinds.
  assert.deepEqual(plain(p.watchedTitles(watched, 10, ["series:avatar"])).map((w) => w.kind + ":" + w.title), ["movie:Avatar", "series:Breaking Bad", "movie:Dune"]);
  assert.deepEqual(plain(p.watchedTitles(watched, 10, ["Avatar"])).map((w) => w.title), ["Breaking Bad", "Dune"]);
  assert.equal(p.watchedRoom(50, 40), 10);
  assert.equal(p.watchedRoom(0, 0), 5, "unset: 5");
  assert.equal(p.watchedRoom(1, 0), 1);
  assert.equal(p.watchedRoom(5, 50), 0);
  const many = Array.from({ length: 80 }, (_, i) => ({ title: "Título " + i, kind: i % 2 ? "series" : "movie" }));
  const own = Array.from({ length: 40 }, (_, i) => "propio " + i);
  const terms = plain(p.buildTerms({ terms: own, titles: many, useLibrary: true, libraryCount: 50 }));
  assert.equal(terms.length, 50);
  assert.equal(terms.filter((t) => t.from === "term").length, 40);
  assert.equal(terms.filter((t) => t.from === "watched").length, 10);
  assert.deepEqual(plain(p.buildTerms({ terms: ["x"], titles: many, useLibrary: false })), [{ term: "x", from: "term" }]);
});

test("qualifiers: a watched title narrowed to its kind in the edition's language; the person's terms as written", async () => {
  const p = await P();
  assert.equal(p.qualifierFor("co", "movie"), "película");
  assert.equal(p.qualifierFor("co", "series"), "serie");
  assert.equal(p.qualifierFor("us", "series"), "\"TV series\"");
  assert.equal(p.qualifierFor("zz", "movie"), "película");
  assert.equal(p.termQuery("Avatar", "movie", "co"), "(\"Avatar\" película)");
  assert.equal(p.termQuery("Avatar", "series", "us"), "(\"Avatar\" \"TV series\")");
  assert.equal(p.termQuery("El \"gran\" golpe", "movie", "co"), "(\"El gran golpe\" película)");
  assert.equal(p.termQuery("Dragon Ball"), "\"Dragon Ball\"");
  assert.equal(p.termQuery("Petro"), "Petro");
  const b = plain(p.batchQueries([
    { term: "Dragon Ball", from: "term" }, { term: "Avatar", from: "watched", kind: "movie" }, { term: "Avatar", from: "watched", kind: "series" },
    { term: "Pokémon & Cía", from: "term" },
  ], "co"));
  assert.equal(b.length, 1);
  assert.equal(b[0].q, "\"Dragon Ball\" OR (\"Avatar\" película) OR (\"Avatar\" serie) OR \"Pokémon & Cía\"");
  const url = p.googleNewsUrl({ q: b[0].q, edition: "co" });
  assert.match(url, /^https:\/\/news\.google\.com\/rss\/search\?q=%22Dragon%20Ball%22%20OR%20\(%22Avatar%22%20pel%C3%ADcula\)/);
  assert.match(url, /Pok%C3%A9mon%20%26%20C%C3%ADa/);
});

test("matchTerm: the most specific term names the story (the series, not the movie of the same first word)", async () => {
  const p = await P();
  const terms = [{ term: "Avatar", from: "watched", kind: "movie" }, { term: "Avatar: The Last Airbender", from: "watched", kind: "series" }];
  assert.equal(p.matchTerm("Netflix renueva Avatar: The Last Airbender", terms).term, "Avatar: The Last Airbender");
  assert.equal(p.matchTerm("Avatar 3 llega en diciembre", terms).term, "Avatar");
  assert.equal(p.matchTerm("Otra cosa", terms), null);
});

test("batching: 50 qualified terms of 40 characters fit in a few searches under 1800 characters, each term once", async () => {
  const p = await P();
  const terms = Array.from({ length: 50 }, (_, i) => ({ term: ("Título largo número " + i + " ñ&").padEnd(40, "x"), from: i % 2 ? "watched" : "term", kind: i % 4 === 1 ? "series" : "movie" }));
  const b = plain(p.batchQueries(terms, "co"));
  assert.ok(b.length >= 2 && b.length <= 10, String(b.length));
  for (const x of b) assert.ok(p.googleNewsUrl({ q: x.q, edition: "co" }).length <= 1800);
  assert.deepEqual(b.flatMap((x) => x.terms), terms.map((t) => t.term));
  assert.deepEqual(plain(p.batchQueries([{ term: "uno", from: "term" }], "co")), [{ q: "uno", terms: ["uno"] }]);
  // More batches than one step takes: the cursor rotates over all of them.
  const many = Array.from({ length: 23 }, (_, i) => ({ q: "q" + i }));
  const first = plain(p.pickBatches(many, 0, 10));
  assert.deepEqual(first.chosen.map((x) => x.q), many.slice(0, 10).map((x) => x.q));
  const second = plain(p.pickBatches(many, first.next, 10));
  const third = plain(p.pickBatches(many, second.next, 10));
  assert.deepEqual(new Set([...first.chosen, ...second.chosen, ...third.chosen].map((x) => x.q)).size, 23);
  assert.deepEqual(plain(p.pickBatches(many.slice(0, 3), 7, 10)), { chosen: many.slice(0, 3), next: 0 });
});

// ---------- step: the work queue within a budget ----------

test("step: a term reads its search once; a fresh feed is not fetched again; the stories are a compact record", async () => {
  const p = await P();
  const clock = fakeClock();
  const net = fakeNet({ clock });
  const store = memStore();
  const cache = p.makeCache(store);
  const r = plain(await p.step(cache, net.fetch, { ...settingsBase, loadMedia: false }, clock));
  assert.deepEqual(net.seen.map((x) => x.url), ["https://news.google.com/rss/search?q=Dune&hl=es-419&gl=CO&ceid=CO%3Aes-419"]);
  assert.equal(r.stories.length, 3);
  assert.equal(r.changed, true);
  const rec = r.stories.find((s) => s.t === "Breaking Bad cumple años y su elenco se reúne");
  assert.equal(rec.u, PUBLISHER, "an older token gives the outlet's address at once");
  assert.equal(rec.g, null);
  assert.equal(r.stories.find((s) => s.t === "Avatar: Fuego y Ceniza confirma su fecha de estreno").g, OPAQUE);
  assert.deepEqual(Object.keys(rec).sort(), ["a", "c", "d", "g", "i", "id", "m", "ok", "p", "q", "r", "s", "t", "u"]);
  const again = plain(await p.step(cache, net.fetch, { ...settingsBase, loadMedia: false }, clock));
  assert.equal(net.seen.length, 1);
  assert.equal(again.changed, false);
  assert.equal(again.stories.length, 3);
});

test("step: no term asks Google for nothing: no request, no story, not a failure", async () => {
  const p = await P();
  const clock = fakeClock();
  const net = fakeNet({ clock });
  const cache = p.makeCache(memStore());
  const r = plain(await p.step(cache, net.fetch, { ...settingsBase, terms: [], loadMedia: false }, clock));
  assert.equal(net.seen.length, 0);
  assert.equal(r.stories.length, 0);
  assert.equal(r.failed, false);
  assert.equal(r.changed, false);
});

test("step: 50 terms make at most 10 requests in all; every request waits its gap on the injected clock", async () => {
  const p = await P();
  const clock = fakeClock();
  const net = fakeNet({ clock, costMs: 100 });
  const cache = p.makeCache(memStore());
  const terms = Array.from({ length: 50 }, (_, i) => "término " + i);
  const r = plain(await p.step(cache, net.fetch, { ...settingsBase, terms }, clock));
  assert.ok(r.fetches <= 10, String(r.fetches));
  assert.equal(net.seen.length, r.fetches);
  for (let i = 1; i < net.seen.length; i++) assert.ok(net.seen[i].at - net.seen[i - 1].at >= 400, "spaced");
  assert.ok(net.seen.filter((x) => x.url.includes("/rss/search?q=")).length >= 1);
  assert.ok(r.done.resolve + r.done.meta > 0, "the rest of the budget went to the stories");
});

test("step: with more searches than a step takes, the cursor moves on and every search comes in turn; a step writes little", async () => {
  const p = await P();
  const clock = fakeClock();
  const asked = [];
  const net = fakeNet({ clock, rss: (u) => { asked.push(new URL(u).searchParams.get("q")); return rssOf(3, { from: asked.length * 10 }); } });
  const store = memStore();
  const cache = p.makeCache(store);
  const terms = Array.from({ length: 50 }, (_, i) => ("término largo para llenar la búsqueda " + i).slice(0, 40));
  const batches = plain(p.batchQueries(terms.map((term) => ({ term, from: "term" })), "co")).length;
  assert.ok(batches >= 2);
  const s = { ...settingsBase, terms, loadMedia: false, frequencyMin: 15 };
  for (let i = 0; i < batches; i++) {
    clock.t += 16 * 60000;
    const before = cache.written();
    await p.step(cache, net.fetch, s, clock, { batch: 1 });
    assert.ok(cache.written() - before < 256 * 1024, "a step writes under 256 KB");
  }
  assert.equal(new Set(asked).size, batches, "each search once, in turn");
  assert.ok(p.validStories(JSON.parse(store.get("stories"))).length >= batches * 3 - 1, "the stories of earlier searches stay");
});

test("step: the enrichment stops on the budget and resumes from the cache; the stages take turns", async () => {
  const p = await P();
  const clock = fakeClock();
  const net = fakeNet({ clock, rss: rssOf(12) });
  const store = memStore();
  const cache = p.makeCache(store);
  const s = { ...settingsBase, terms: ["estreno"] };
  const first = plain(await p.step(cache, net.fetch, s, clock));
  assert.ok(first.fetches <= 10);
  assert.ok(first.bytes <= p.STEP_MAX_BYTES);
  assert.ok(first.done.resolve > 0);
  const resolvedAfterFirst = first.stories.filter((x) => x.u).length;
  clock.t += 10000;
  const second = plain(await p.step(cache, net.fetch, s, clock));
  assert.ok(second.fetches <= 10);
  assert.ok(second.done.meta > 0, "the meta stage got its turn");
  assert.ok(second.stories.filter((x) => x.u).length >= resolvedAfterFirst);
  // Google's resolver reads a big page: a step resolves only a couple, so twelve take a few more steps.
  for (let i = 0; i < 30; i++) { clock.t += 10000; await p.step(cache, net.fetch, s, clock); }
  const done = p.validStories(JSON.parse(store.get("stories")));
  assert.equal(done.filter((x) => x.u === RESOLVED).length, 12, "every story got its address");
  assert.equal(done.filter((x) => x.i === PICTURE).length, 12, "and its picture");
  assert.match(done[0].d, /^Cameron & su equipo celebran "la secuela del año"/);
  assert.deepEqual(plain(p.stageOrder(0)), ["resolve", "meta", "categorize"]);
  assert.deepEqual(plain(p.stageOrder(1)), ["meta", "categorize", "resolve"]);
  assert.deepEqual(plain(p.stageOrder(5)), ["categorize", "resolve", "meta"]);
});

test("step: a time budget is kept (a request starts only when it ends in time); a later step resumes", async () => {
  const p = await P();
  const clock = fakeClock();
  const net = fakeNet({ clock, rss: rssOf(12), costMs: 3000 });
  const cache = p.makeCache(memStore());
  const r = plain(await p.step(cache, net.fetch, { ...settingsBase, terms: ["estreno"] }, clock));
  assert.ok(r.ms <= 18000 + 3000, String(r.ms));
  assert.ok(r.fetches < 10, String(r.fetches));
  clock.t += 10000;
  const next = plain(await p.step(cache, net.fetch, { ...settingsBase, terms: ["estreno"] }, clock));
  assert.ok(next.done.resolve + next.done.meta > 0);
});

test("budgetFor: a phone does batches of 10; a TV alone runs lite (5, double spacing, 8 cards, the AI for 20)", async () => {
  const p = await P();
  assert.deepEqual(plain(p.budgetFor("phone")), { batch: 10, maxFetches: 10, maxBytes: Math.floor(1.6 * 1024 * 1024), maxMs: 18000, fetchGapMs: 400, askGapMs: 6000, enrichFirst: 100, aiFirst: 100, maxResolves: 2 });
  assert.deepEqual(plain(p.budgetFor("something")), plain(p.budgetFor("phone")));
  const tv = plain(p.budgetFor("tv"));
  assert.deepEqual(tv, { batch: 5, maxFetches: 5, maxBytes: 1048576, maxMs: 18000, fetchGapMs: 800, askGapMs: 12000, enrichFirst: 8, aiFirst: 20, maxResolves: 1 });
  const clock = fakeClock();
  const net = fakeNet({ clock, rss: rssOf(30) });
  const store = memStore();
  const cache = p.makeCache(store);
  let asked = 0;
  const ask = async (prompt) => { asked += JSON.parse(prompt).length; return null; };
  for (let i = 0; i < 20; i++) { clock.t += 13000; await p.step(cache, net.fetch, { ...settingsBase, terms: ["estreno"], useAi: true }, clock, tv, ask); }
  for (let i = 1; i < net.seen.length; i++) if (net.seen[i].at - net.seen[i - 1].at < 13000) assert.ok(net.seen[i].at - net.seen[i - 1].at >= 800);
  const stories = p.validStories(JSON.parse(store.get("stories")));
  assert.equal(stories.slice(0, 8).filter((x) => x.u).length, 8, "the first 8 cards are enriched");
  assert.equal(stories.slice(8).filter((x) => x.u).length, 0, "nothing past them on a TV");
  assert.ok(asked > 0 && asked <= 20 * 3, "the AI is asked about the first 20 at most (null answers retry an hour later)");
  const p0 = plain(p.pending(stories, { loadMedia: true, useAi: true }, tv, clock.t));
  assert.ok(p0.categorize.every((s) => stories.indexOf(stories.find((x) => x.id === s.id)) < 20));
});

test("the window: the newest 100 stay; a 101st pushes the oldest out; the survivors keep their data; under 64 KB", async () => {
  const p = await P();
  const parsed = (from, n) => plain(p.parseGoogleNews(rssOf(n, { from }), 200));
  let w = plain(p.mergeWindow([], [parsed(0, 100)]));
  assert.equal(w.length, 100);
  // Enrich them as a step would, with realistic values.
  w = w.map((r, i) => ({
    ...r, g: null, u: "https://www.medio" + (i % 7) + ".example/seccion/2026/10/26/" + "una-noticia-con-un-titulo-largo-" + i, ok: true, m: Date.UTC(2026, 9, 26),
    i: "https://estaticos.medio" + (i % 7) + ".example/binrepository/1280x720/0c0/1280d720/none/11101/IMGS/" + i + ".jpg",
    d: "Una descripción realista de la noticia, como las que dan las páginas en su og:description: dos frases cortas que resumen lo que pasó.".slice(0, 160),
    c: "science",
  }));
  const size = JSON.stringify(w).length;
  assert.ok(size < 64 * 1024, String(size));
  const newer = plain(p.parseGoogleNews(rssOf(1, { from: 500, base: Date.UTC(2026, 9, 27, 12) }), 10));
  const next = plain(p.mergeWindow(p.validStories(w), [newer]));
  assert.equal(next.length, 100);
  assert.equal(next[0].t, newer[0].title.split(" - ")[0] === newer[0].title ? newer[0].title : newer[0].title);
  const oldest = w[w.length - 1];
  assert.ok(!next.some((x) => x.id === oldest.id), "the oldest is gone, with its data");
  const kept = next.find((x) => x.id === w[0].id);
  assert.equal(kept.u, w[0].u);
  assert.equal(kept.i, w[0].i);
  // A known story seen again keeps its record and its data.
  const again = plain(p.mergeWindow(p.validStories(w), [parsed(0, 5)]));
  assert.equal(again.find((x) => x.id === w[0].id).d, w[0].d);
});

test("the cache adapter: JSON in and out, a value over 256 KB refused, junk read back as nothing", async () => {
  const p = await P();
  const store = memStore();
  const cache = p.makeCache(store);
  cache.set("k", { a: 1 });
  assert.deepEqual(plain(cache.get("k")), { a: 1 });
  store.set("bad", "{not json");
  assert.equal(cache.get("bad"), null);
  assert.throws(() => cache.set("big", "x".repeat(300 * 1024)));
  const junk = [
    null, "x", { id: "bad id", t: "T", g: OPAQUE }, { id: "s12", t: "", g: OPAQUE }, { id: "s12", t: "T", g: "http://insecure.example" },
    { id: "sabc12", t: "Bien", g: OPAQUE, i: "javascript:alert(1)", d: "x".repeat(500), c: "nope", a: 7, p: "yesterday" },
  ];
  const ok = plain(p.validStories(junk));
  assert.equal(ok.length, 1);
  assert.equal(ok[0].i, null);
  assert.equal(ok[0].d.length, 240);
  assert.equal(ok[0].c, "other");
  assert.equal(ok[0].a, 0);
  assert.equal(ok[0].p, 0);
});

// ---------- categories ----------

test("categories: a keyword guess; the AI's question holds only ids and titles; its answer read strictly", async () => {
  const p = await P();
  assert.equal(p.guessCategory("Gala del Balón de Oro 2026: ganadores"), "sports");
  assert.equal(p.guessCategory("Netflix estrena la segunda temporada"), "film");
  assert.equal(p.guessCategory("Investigadores publican un estudio sobre el sueño"), "science");
  assert.equal(p.guessCategory("Avatar: Fuego y Ceniza confirma su fecha de estreno"), "film");
  assert.equal(p.guessCategory("Fiscalía citó al ministro"), "politics");
  assert.equal(p.guessCategory("Algo sin pistas"), "other");
  const stories = Array.from({ length: 50 }, (_, i) => ({ id: "s" + i, t: "Título " + i + " " + "x".repeat(300), s: "Medio", u: "https://secret.example" }));
  const q = plain(p.buildCategoryPrompt(stories));
  const items = JSON.parse(q.prompt);
  assert.equal(items.length, 40);
  assert.deepEqual(Object.keys(items[0]), ["id", "title"]);
  assert.equal(items[0].title.length, 200);
  assert.match(q.system, /JSON only/);
  const few = stories.slice(0, 3);
  assert.deepEqual(plain(p.parseCategories("Claro:\n```json\n[{\"id\":\"s0\",\"category\":\"sports\"},{\"id\":\"s1\",\"category\":\"Weird\"},{\"id\":\"zz\",\"category\":\"film\"}]\n```", few)), { s0: "sports", s1: "other" });
  assert.deepEqual(plain(p.parseCategories("no sé", few)), {});
  assert.deepEqual(plain(p.parseCategories("[{broken", few)), {});
  assert.equal(await p.askAi("x", "y"), null);
});

test("step with the AI: one question of at most 10 titles, at most one every 6 s; no answer keeps the guess", async () => {
  const p = await P();
  const clock = fakeClock();
  const net = fakeNet({ clock, rss: rssOf(25) });
  const cache = p.makeCache(memStore());
  const asks = [];
  const ask = async (prompt) => {
    asks.push(clock.t);
    const ids = JSON.parse(prompt).map((x) => x.id);
    assert.ok(ids.length <= 10);
    return JSON.stringify(ids.map((id) => ({ id, category: "health" })));
  };
  const s = { ...settingsBase, loadMedia: false, useAi: true, terms: ["estreno"] };
  await p.step(cache, net.fetch, s, clock, undefined, ask);
  await p.step(cache, net.fetch, s, clock, undefined, ask);
  assert.equal(asks.length, 1, "a second step within 6 s does not ask");
  clock.t += 6000;
  await p.step(cache, net.fetch, s, clock, undefined, ask);
  clock.t += 6000;
  const r = plain(await p.step(cache, net.fetch, s, clock, undefined, ask));
  assert.equal(asks.length, 3);
  assert.equal(r.stories.filter((x) => x.a === 1 && x.c === "health").length, 25);
  const none = fakeClock();
  const plainCache = p.makeCache(memStore());
  const g = plain(await p.step(plainCache, fakeNet({ clock: none }).fetch, { ...settingsBase, loadMedia: false, useAi: true }, none));
  assert.ok(g.stories.every((x) => x.a === 0), "askAi answers null: the guesses stay");
});

// ---------- a story's page ----------

test("Google's resolver: the page's three attributes, the request, the answer (and a refused one)", async () => {
  const p = await P();
  const params = plain(p.parseArticleParams(FIX("google-article-page.html")));
  assert.deepEqual(params, { id: "CBMilgFBVV95cUxNeS1kaG9ncUFodHNvQmJRaGxQ", ts: 1793060654, sg: "AbIaSL_rt6IrqvT5tSQlXIzARdT2" });
  assert.equal(p.parseArticleParams("<html></html>"), null);
  const req = plain(p.batchExecuteRequest(params));
  assert.equal(req.url, "https://news.google.com/_/DotsSplashUi/data/batchexecute");
  const outer = JSON.parse(req.form["f.req"]);
  assert.equal(outer[0][0][0], "Fbv4je");
  assert.deepEqual(JSON.parse(outer[0][0][1]).slice(2), [params.id, params.ts, params.sg]);
  assert.equal(p.parseBatchExecute(FIX("batchexecute-answer.txt")), RESOLVED);
  assert.equal(p.parseBatchExecute(FIX("batchexecute-refused.txt")), null);
  assert.equal(p.parseBatchExecute("junk"), null);
});

test("parsePageMeta: Open Graph first, entities decoded, relative and protocol-relative pictures resolved, http refused", async () => {
  const p = await P();
  const m = plain(p.parsePageMeta(FIX("publisher-article.html"), RESOLVED));
  assert.equal(m.image, PICTURE);
  assert.equal(m.description, "Cameron & su equipo celebran \"la secuela del año\": la tercera película de Avatar llega en diciembre.");
  assert.equal(m.title, "Avatar: Fuego y Ceniza confirma su fecha de estreno");
  assert.equal(m.site, "Diario de Ejemplo");
  assert.equal(plain(p.parsePageMeta(FIX("publisher-divs.html"), "https://radio.example/n/1")).image, "https://cdn.radio.example/img/stranger-things.png");
  assert.equal(plain(p.parsePageMeta("<head><meta name=\"twitter:image\" content=\"http://x.example/a.jpg\"></head>", "https://x.example/")).image, null);
  assert.equal(p.resolveHttps("img/a.jpg", "https://x.example/dir/page.html"), "https://x.example/dir/img/a.jpg");
  assert.equal(p.resolveHttps("data:image/png;base64,AAA", "https://x.example/"), null);
  assert.equal(p.headOf("<head>a</head><body>" + "b".repeat(100000)), "<head>a");
});

test("extractArticle: the article's paragraphs only; a div soup's main block; a paywall stub gives nothing; a huge page is cut", async () => {
  const p = await P();
  const a = p.extractArticle(FIX("publisher-article.html"));
  assert.deepEqual(a.split("\n\n"), [
    "La tercera película de Avatar ya tiene fecha: James Cameron confirmó que Fuego y Ceniza llegará a los cines en diciembre, con nuevos clanes de Pandora.",
    "El director dijo que la historia sigue a la familia de Jake Sully después de la segunda entrega — y que habrá más mundos por conocer.",
    "El equipo mostrará un avance el próximo mes & promete una película «más grande que las anteriores» en efectos y en duración.",
  ]);
  const d = p.extractArticle(FIX("publisher-divs.html"));
  assert.match(d, /^Primer párrafo de la nota/);
  assert.match(d, /“es un cierre enorme”/);
  assert.doesNotMatch(d, /cookies|Menú principal/);
  assert.equal(p.extractArticle(FIX("publisher-paywall.html")), "");
  const para = "<p>" + "Un párrafo largo de una noticia enorme que se repite muchas veces con variaciones ".repeat(3) + "</p>";
  const huge = "<html><body><article>" + Array.from({ length: 4000 }, (_, i) => para.replace("Un", "Un " + i)).join("") + "</article></body></html>";
  assert.ok(huge.length > 600 * 1024);
  const h = p.extractArticle(huge);
  assert.ok(h.length <= 6000, String(h.length));
  assert.ok(h.length > 5000, String(h.length));
  assert.equal(p.extractArticle(""), "");
});

// ---------- the screen ----------

test("open: skeleton cards before the first answer; then the feed as a grid of cards, two per row on a phone", async () => {
  const { plugin, seen } = await rig({ net: { rss: rssOf(6) }, config: { loadMedia: false } });
  const before = await tree(plugin, {});
  assert.equal(ofType(before, "skeleton").length, 6);
  const a = await answer(plugin, "open");
  assert.equal(seen.length, 1);
  const t = await tree(plugin, a.state);
  const cs = cards(t);
  assert.equal(cs.length, 6);
  assert.equal(cs[0].style.span, 12, "one card per row on a phone");
  assert.equal(cs[0].byClass.medium.style.span, 6);
  assert.equal(cs[0].byClass.expanded.style.span, 4, "three per row on a TV");
  assert.equal(plugin.CARD_FLUSH, true);
  assert.equal(cs[0].flush, true, "the picture runs edge to edge");
  assert.equal(cs[0].onTap.event.name, "read");
  assert.deepEqual(cs[0].onTap.ui, [], "the answer opens the pop-up, not the tap");
  const img = ofType(cs[0], "image")[0];
  assert.ok(!img.url, "no picture yet: the image keeps its fallback");
  assert.equal(img.fallback.type, "col");
  assert.equal(ofType(img.fallback, "text")[0].text, "M");
  assert.equal(cs[0].children[1].type, "col", "then a column with its own padding");
  const row = ofType(t, "row").find((r) => r.wrap === true);
  assert.equal(row.children.length, 6);
  assert.equal(row.style.align, null, "no align: a line's cards stretch to the tallest");
  assert.equal(t.every, undefined);
  const raw = await plugin.screen(fakeScreenContext({ state: { ...fakeScreenContext().state, ...a.state } }));
  assert.deepEqual(plain(raw.every), { ms: 10000, event: "tick" });
});

test("category tabs: Kino's tab strip under the screen's tabs, «Todas» first with counts, only categories with stories; picking one filters the grid", async () => {
  const xml = RSS.replace("Breaking Bad cumple años y su elenco se reúne", "Gol de la selección en el mundial");
  const { plugin } = await rig({ net: { rss: xml }, config: { loadMedia: false } });
  const a = await answer(plugin, "open");
  const t = await tree(plugin, a.state);
  assert.equal(ofType(t, "chips").length, 0, "no chips: a tab strip");
  const strips = ofType(t, "tabs");
  assert.equal(strips.length, 2, "the screen's tabs, then the categories");
  const cats = strips.find((x) => x.key === "category");
  assert.deepEqual(cats.tabs.map((o) => o.label), ["Todas (3)", "Deportes (1)", "Cine y TV (2)"]);
  assert.equal(cats.value, "all");
  assert.equal(cats.onChange.event.name, "category");
  // The order the D-pad follows: the screen's tabs, the category tabs, then the cards.
  const order = all(t).map((n) => n.key);
  const firstCard = order.findIndex((k) => /^n[a-z0-9]/.test(k || "") && k !== "newsBody");
  assert.ok(order.indexOf("tabs") < order.indexOf("category"), "screen tabs before category tabs");
  assert.ok(order.indexOf("category") < firstCard, "category tabs before the cards");
  assert.ok(cats.style.padding.bottom > 0, "a small gap under the category tabs");
  const f = await answer(plugin, "category", { value: "sports" });
  assert.deepEqual(plain(f.state), { cat: "sports", shown: 12 });
  const ft = await tree(plugin, { ...a.state, ...f.state });
  assert.deepEqual(cards(ft).map((c) => ofType(c, "text").find((x) => x.variant === "h5").text), ["Gol de la selección en el mundial"]);
});

test("a story: the read answer opens the pop-up (an answer's ui) with the picture, title, category, the page's text and «Ver noticia»", async () => {
  const { plugin, seen } = await rig();
  const a = await answer(plugin, "open");
  const t0 = await tree(plugin, a.state);
  const pop0 = ofType(t0, "popup")[0];
  assert.equal(pop0.key, "story");
  assert.equal(pop0.title, "", "no title: the picture is on top");
  assert.equal(pop0.onClose.event.name, "storyClosed");
  const id = a.state.feed.items.find((x) => x.title === "Avatar: Fuego y Ceniza confirma su fecha de estreno").id;
  const before = seen.length;
  const r = await answer(plugin, "read", { arg: id, state: a.state });
  assert.deepEqual(r.ui, [{ open: "story" }]);
  assert.ok(seen.length > before, "the page is read when the person opens the story");
  const t = await tree(plugin, { ...a.state, ...r.state });
  const pop = ofType(t, "popup")[0];
  const texts = ofType(pop, "text").map((x) => x.text);
  assert.equal(ofType(pop, "text").find((x) => x.variant === "h3").text, "Avatar: Fuego y Ceniza confirma su fecha de estreno");
  assert.equal(ofType(pop, "image")[0].fallback.type, "col", "the picture keeps its placeholder as fallback");
  assert.ok(texts.some((x) => /^La tercera película de Avatar ya tiene fecha/.test(x)));
  assert.ok(texts.some((x) => /Extracto de la página del medio/.test(x)));
  assert.equal(ofType(pop, "badge")[0].text, "Cine y TV");
  const qr = ofType(pop, "qr")[0];
  assert.equal(qr.value, RESOLVED);
  assert.deepEqual(qr.devices, ["tv"], "the QR only on a TV");
  assert.deepEqual(pop.buttons.map((b) => [b.label, b.event, b.variant]), [["Ver noticia", "openStory", "primary"]]);
  // «Ver noticia»: go.url with the outlet's address, which Kino's own check keeps.
  const go = await answer(plugin, "openStory", { arg: id, state: { ...a.state, ...r.state } });
  assert.deepEqual(go.go, { url: { href: RESOLVED, title: "Diario de Ejemplo" } });
  assert.deepEqual(go.ui, [{ close: "story" }]);
  assert.equal(await answer(plugin, "openStory", { arg: "other", state: { ...a.state, ...r.state } }), null);
  assert.equal(await answer(plugin, "openStory", { arg: id, state: { ...a.state, reading: { ...r.state.reading, target: "http://insecure.example/a" } } }), null, "never a non-https address");
  // Opened again: read from the cache, no request.
  const n = seen.length;
  await answer(plugin, "read", { arg: id, state: a.state });
  assert.equal(seen.length, n);
  const c = await answer(plugin, "storyClosed", { state: { ...a.state, ...r.state } });
  assert.deepEqual(c.state, { reading: null });
});
test("with pages off: no outlet is contacted, cards without pictures, the pop-up has Google's link and an honest note", async () => {
  const { plugin, seen } = await rig({ config: { loadMedia: false } });
  const a = await answer(plugin, "open");
  const id = a.state.feed.items.find((x) => x.title === "Avatar: Fuego y Ceniza confirma su fecha de estreno").id;
  const r = await answer(plugin, "read", { arg: id, state: a.state });
  assert.ok(seen.every((x) => x.url.startsWith("https://news.google.com/rss/search?")));
  const pop = ofType(await tree(plugin, { ...a.state, ...r.state }), "popup")[0];
  assert.equal(ofType(pop, "qr")[0].value, OPAQUE);
  assert.equal(pop.buttons[0].event, "openStory", "Google's link is still https: the button stays");
  assert.ok(ofType(pop, "text").some((x) => /Aún no tenemos la dirección del medio/.test(x.text)));
  assert.ok(ofType(pop, "text").some((x) => /No pudimos leer el texto/.test(x.text)));
});

test("a failed feed with nothing stored: the banner with Retry and an empty state, never sample stories", async () => {
  const { plugin } = await rig({ net: { rssStatus: 503 } });
  const a = await answer(plugin, "open");
  assert.equal(a.state.feed.failed, true);
  const t = await tree(plugin, a.state);
  assert.equal(ofType(t, "banner")[0].action.onTap.event.name, "refreshNow");
  assert.deepEqual(cards(t).map((c) => c.key), []);
  assert.ok(ofType(t, "emptyState").length === 1);
  assert.doesNotMatch(wordsOf(t).join(" | "), /ejemplo|sample/i);
});

test("Configuración: the switches and their notes, the add-term pop-up with Kino's form, and the duplicate check", async () => {
  const { plugin } = await rig({ config: { terms: [{ term: "Dragon Ball" }], useLibrary: false } });
  const t = await tree(plugin, { tab: "settings" });
  assert.deepEqual(ofType(t, "toggle").map((x) => x.key), ["loadMedia", "useAi", "useLibrary"]);
  // The 18+ filter is Kino's own settings form (it asks the 18+ code to switch it off), never a plugin toggle.
  assert.deepEqual(ofType(t, "settings").map((x) => x.keys), [["hideAdult"]]);
  assert.equal(ofType(t, "dropdown").length, 0, "no frequency of its own: Kino's job row has it");
  assert.ok(ofType(t, "text").some((x) => /elige cada cuánto en Ajustes ▸ Noticias/.test(x.text)));
  assert.ok(ofType(t, "text").some((x) => /se envían a Google Noticias como términos de búsqueda/.test(x.text)));
  assert.ok(ofType(t, "text").some((x) => /servicio de IA de terceros/.test(x.text)));
  const add = ofType(t, "button").find((b) => b.key === "addTermButton");
  assert.deepEqual(add.onTap.ui, [{ open: "addTerm" }]);
  const pop = ofType(t, "popup").find((x) => x.key === "addTerm");
  assert.equal(pop.onClose.event.name, "addDismissed");
  const input = ofType(pop, "textInput")[0];
  assert.equal(input.field.required, true);
  assert.equal(input.maxLength, 40);
  assert.deepEqual(pop.buttons.map((b) => [b.label, b.event]), [["Cancelar", "cancelAdd"]]);
  const cancel = await answer(plugin, "cancelAdd", { state: { tab: "settings", addError: { es: "x", en: "x" } } });
  assert.deepEqual(cancel.state, { addError: null, inputs: { newTerm: "" } });
  assert.deepEqual(cancel.ui, [{ close: "addTerm" }]);
  assert.equal(cancel.focus, "addTermButton");
  const dup = await answer(plugin, "addTerm", { value: { newTerm: "dragon ball" }, state: { tab: "settings" } });
  assert.equal(dup.state.addError.es, "Ese término ya está en la lista");
  const ok = await answer(plugin, "addTerm", { value: { newTerm: "Pokémon" }, state: { tab: "settings" } });
  assert.deepEqual(ok.config.terms, [{ term: "Dragon Ball" }, { term: "Pokémon" }]);
  assert.equal(ok.focus, "addTermButton");
  assert.deepEqual(ok.ui, [{ close: "addTerm" }]);
  const rm = await answer(plugin, "removeTerm", { arg: "Dragon Ball", state: { tab: "settings" } });
  assert.ok(rm.config.terms === null || (Array.isArray(rm.config.terms) && rm.config.terms.length === 0), JSON.stringify(rm.config));
});

test("Usar lo que he visto: the watched works as rows with their kind; removing one excludes it; at least one term", async () => {
  const library = { watched: [
    { title: "Avatar", kind: "movie", year: 2009, watchedAtMs: Date.UTC(2026, 9, 20) },
    { title: "Avatar: The Last Airbender", kind: "series", watchedAtMs: Date.UTC(2026, 9, 19) },
    { title: "Breaking Bad", kind: "series", year: 2008, watchedAtMs: Date.UTC(2026, 9, 18) },
  ] };
  const { plugin } = await rig({ library, config: { terms: [], useLibrary: true, libraryCount: "5" } });
  await answer(plugin, "open");
  const tab = await answer(plugin, "pickTab", { value: "settings" });
  const t = await tree(plugin, { ...tab.state });
  const rows = ofType(t, "row").filter((r) => /^w\d/.test(r.key));
  assert.deepEqual(rows.map((r) => ofType(r, "badge")[0].text), ["Película · 2009", "Serie", "Serie · 2008"]);
  assert.equal(ofType(rows[1], "button")[0].onTap.event.arg, "series:avatar: the last airbender");
  const ex = await answer(plugin, "excludeWatched", { arg: "series:avatar: the last airbender", state: tab.state });
  assert.equal(ex.toast.text, "Guardado");
  const open = await answer(plugin, "open");
  assert.equal(open.state.feed.terms, 2);
  const empty = await rig({ library: { watched: [] }, config: { terms: [], useLibrary: false } });
  const refused = await answer(empty.plugin, "library", { value: true });
  assert.equal(refused.state.settingsError.es, "Necesitas al menos un término: agrega uno o mira algo primero");
  assert.equal(refused.config, null);
});

test("the queries the owner's watched titles make, qualified by kind, from the screen", async () => {
  const { plugin, seen } = await rig({ library: { watched: WATCHED }, config: { useLibrary: true, libraryCount: "7", loadMedia: false, terms: [{ term: "Dragon Ball Daima" }] } });
  await answer(plugin, "open");
  const q = decodeURIComponent(new URL(seen[0].url).searchParams.get("q"));
  assert.equal(q, "\"Dragon Ball Daima\" OR (\"Avatar\" película) OR (\"Avatar: The Last Airbender\" serie) OR (\"Breaking Bad\" serie) OR " +
    "(\"Dune\" película) OR (\"Stranger Things\" serie) OR (\"One Piece\" serie) OR (\"Dragon Ball\" serie)");
  const en = await rig({ library: { watched: WATCHED.slice(0, 2) }, lang: "en-US", config: { terms: [], useLibrary: true, loadMedia: false } });
  await answer(en.plugin, "open", { lang: "en" });
  assert.equal(decodeURIComponent(new URL(en.seen[0].url).searchParams.get("q")), "(\"Avatar\" movie) OR (\"Avatar: The Last Airbender\" \"TV series\")");
});

// ---------- the job, kino.shared and the AI ----------

test("the cache adapter over kino.shared: reads it, falls back to kino.storage, never writes the same value twice", async () => {
  const p = await P();
  const local = p.makeCache(memStore());
  const writes = [];
  const shared = { get: (k) => (k === "feed" ? { key: "x" } : null), set: (k, v) => { writes.push(k); if (k === "big") throw Object.assign(new Error("too_large"), { code: "too_large" }); return true; } };
  const c = p.makeSharedCache(shared, local);
  assert.deepEqual(plain(c.get("feed")), { key: "x" });
  c.set("feed", { key: "x" });
  assert.deepEqual(writes, [], "unchanged: not written");
  c.set("feed", { key: "y" });
  c.set("big", { a: 1 });
  assert.deepEqual(writes, ["feed", "big"]);
  assert.deepEqual(plain(local.get("big")), { a: 1 }, "refused by kino.shared: kept on this device");
  const none = p.makeSharedCache(null, local);
  none.set("work", { turn: 2 });
  assert.deepEqual(plain(local.get("work")), { turn: 2 });
  // The window always fits a shared value.
  const many = Array.from({ length: 100 }, (_, i) => ({ id: "s" + i, t: "T".repeat(200), s: "S", p: i, g: null, u: "https://x.example/" + "a".repeat(300), i: "https://i.example/" + "b".repeat(300), d: "d".repeat(240), c: "film", a: 0, r: 0, m: 0, ok: true, q: 0 }));
  const fit = plain(p.fitSize(many));
  assert.ok(JSON.stringify(fit).length <= p.STORIES_MAX_CHARS);
  assert.ok(fit.length < 100 && fit[0].id === "s0", "the oldest go first");
});

test("job: the phone runs a step with its budget and shares the result; the TV's screen reads it without fetching again", async () => {
  const devices = createSharedDevices({ now: Date.now });
  const phoneNet = fakeNet({ rss: rssOf(6) });
  const fetchImpl = async (url, init) => { const r = await phoneNet.fetch(url, init); return new Response(await r.text(), { status: r.status }); };
  const { kino } = createKino(MANIFEST, { fetchImpl, device: "phone", shared: devices.phone, callFunction: "job", config: { terms: [{ term: "Dragon Ball" }] } });
  const budget = jobBudget();
  const jk = jobKino(kino, budget);
  const { plugin } = await loadPlugin(join(DIR, "plugin.js"), jk, { console: quiet });
  const r = await runJob(plugin, jobContext("refresh", "scheduled"), budget);
  assert.equal(r.ok, true, String(r.failure));
  assert.ok(phoneNet.seen.length >= 1 && phoneNet.seen.length <= 10, String(phoneNet.seen.length));
  assert.ok(budget.fetches <= 10);
  devices.sync();
  assert.ok(devices.tv.get(MANIFEST.id, "stories"), "the stories reached the TV");
  // The TV opens the screen: the shared feed is fresh, so nothing is fetched there.
  const tv = await rig({ device: "tv", shared: devices.tv, config: { terms: [{ term: "Dragon Ball" }], loadMedia: false } });
  const a = await answer(tv.plugin, "open");
  assert.equal(tv.seen.length, 0, "stale-while-revalidate: fresh, so no request on the TV");
  assert.equal(a.state.feed.items.length, 6);
});

test("job with the AI on: one question about 10 titles at most, counted as a request; never on open or a timer tick", async () => {
  const asked = [];
  const ai = async ({ prompt, json }) => {
    asked.push({ n: JSON.parse(prompt).length, json });
    return JSON.stringify(JSON.parse(prompt).map((x) => ({ id: x.id, category: "film" })));
  };
  const net = fakeNet({ rss: rssOf(25) });
  const fetchImpl = async (url, init) => { const r = await net.fetch(url, init); return new Response(await r.text(), { status: r.status }); };
  const { kino } = createKino(MANIFEST, { fetchImpl, device: "phone", ai, callFunction: "job", config: { useAi: true, loadMedia: false, terms: [{ term: "estreno" }] } });
  const budget = jobBudget();
  const { plugin } = await loadPlugin(join(DIR, "plugin.js"), jobKino(kino, budget), { console: quiet });
  const r = await runJob(plugin, jobContext("refresh", "manual"), budget);
  assert.equal(r.ok, true, String(r.failure));
  assert.deepEqual(asked, [{ n: 10, json: true }]);
  // The screen: open and ticks never ask.
  const screenAsked = [];
  const s = await rig({ net: { rss: rssOf(25) }, ai: async (o) => { screenAsked.push(o); return "[]"; }, config: { useAi: true, loadMedia: false } });
  const a = await answer(s.plugin, "open");
  await answer(s.plugin, "tick", { state: a.state });
  assert.equal(screenAsked.length, 0);
});

test("«Clasificar ahora»: the AI stage alone over the next 10 unsorted headlines; a refusal keeps the keyword guesses", async () => {
  const p = await P();
  const store = memStore();
  const cache = p.makeCache(store);
  const clock = fakeClock();
  await p.step(cache, fakeNet({ clock, rss: rssOf(15) }).fetch, { ...settingsBase, loadMedia: false, terms: ["estreno"] }, clock);
  const prompts = [];
  const ask = async (prompt, system) => {
    prompts.push(JSON.parse(prompt));
    assert.match(system, /JSON only/);
    return "Sure! ```json\n" + JSON.stringify(JSON.parse(prompt).map((x, i) => ({ id: x.id, category: i === 0 ? "nonsense" : "film" })).concat([{ id: "stranger", category: "film" }])) + "\n```";
  };
  const r = plain(await p.classifyNow(cache, clock, undefined, ask));
  assert.equal(r.done, 10);
  assert.equal(prompts[0].length, 10);
  assert.deepEqual(Object.keys(prompts[0][0]), ["id", "title"]);
  const stored = p.validStories(JSON.parse(store.get("stories")));
  assert.equal(stored.filter((x) => x.a === 1).length, 10);
  assert.equal(stored[0].c, "other", "an unknown category becomes Otros");
  const refused = plain(await p.classifyNow(cache, clock, undefined, async () => null));
  assert.equal(refused.done, 0);
  assert.equal(p.validStories(JSON.parse(store.get("stories"))).filter((x) => x.a === 1).length, 10, "the guesses of the rest stay");
  // The screen's button exists only with the AI on.
  const on = await rig({ config: { useAi: true } });
  assert.ok(ofType(await tree(on.plugin, { tab: "settings" }), "button").some((b) => b.key === "classifyButton"));
  const off = await rig();
  assert.ok(!ofType(await tree(off.plugin, { tab: "settings" }), "button").some((b) => b.key === "classifyButton"));
});

test("pages are read only as far as needed: maxBytes and stopAt on a page's head, maxBytes on the article", async () => {
  const p = await P();
  const clock = fakeClock();
  const net = fakeNet({ clock, rss: rssOf(3) });
  const cache = p.makeCache(memStore());
  for (let i = 0; i < 3; i++) { clock.t += 20000; await p.step(cache, net.fetch, { ...settingsBase, terms: ["estreno"] }, clock); }
  const heads = net.seen.filter((x) => x.url === RESOLVED);
  assert.ok(heads.length >= 1);
  const opts = [];
  const spy = async (url, o) => { opts.push(o); return net.fetch(url, o); };
  clock.t += 25 * 3600000;
  await p.step(cache, spy, { ...settingsBase, terms: ["estreno"] }, clock);
  assert.ok(opts.some((o) => o && o.maxBytes === 65536), "the head: 64 KB");
  // Task 8u: the head's read also ends at its close tag.
  assert.ok(opts.some((o) => o && o.maxBytes === 65536 && o.stopAt === "</head>"), "the head ends at </head>");
});

// ---------- the job's byte budget (device pass 2, D2) ----------

/**
 * A network with realistic sizes, as Kino's job counts them: Google News RSS about 150 KB (cut at the request's maxBytes),
 * Google's resolver page about 600 KB, its answer 1 KB, a page's head 64 KB or more. Every request is recorded with its options.
 */
function heavyNet() {
  const seen = [];
  const pad = (n) => "<!-- " + "x".repeat(Math.max(0, n - 9)) + " -->";
  const fetch = async (url, opts = {}) => {
    const u = String(url);
    seen.push({ url: u, opts });
    let body;
    if (u.includes("/_/DotsSplashUi/")) body = FIX("batchexecute-answer.txt");
    else if (u.includes("news.google.com/rss/articles/")) body = pad(600 * 1024) + FIX("google-article-page.html");
    else if (u.startsWith("https://news.google.com/rss")) body = rssOf(40, { from: seen.length * 100 }) + pad(150 * 1024);
    else body = FIX("publisher-article.html") + pad(300 * 1024);
    const cap = opts && opts.maxBytes;
    if (cap && body.length > cap) body = body.slice(0, cap);
    return { ok: true, status: 200, text: async () => body };
  };
  return { fetch, seen };
}

test("job, realistic sizes: a run never reads over 1.6 MB, never crosses Kino's 2 MB, and stores what it found", async () => {
  const p = await P();
  for (const terms of [["Dragon Ball"], Array.from({ length: 50 }, (_, i) => "Película número " + i)]) {
    const net = heavyNet();
    const store = memStore();
    const cache = p.makeCache(store);
    const clock = fakeClock();
    let total = 0;
    const counting = async (url, opts) => {
      const r = await net.fetch(url, opts);
      const text = await r.text();
      total += Buffer.byteLength(text, "utf8");
      assert.ok(total <= 2 * 1024 * 1024, "never past Kino's 2 MB");
      return { ok: r.ok, status: r.status, text: async () => text };
    };
    const r = plain(await p.step(cache, counting, { ...settingsBase, terms }, clock));
    assert.ok(r.bytes <= p.STEP_MAX_BYTES, String(r.bytes));
    assert.ok(total <= p.STEP_MAX_BYTES, String(total));
    assert.ok(r.fetches <= 10);
    assert.ok(net.seen.every((x) => Number.isInteger(x.opts.maxBytes)), "every request says how much it reads");
    assert.ok(net.seen.filter((x) => x.url.includes("/rss/articles/")).length <= 2, "only a few big resolver pages a run");
    const stored = p.validStories(JSON.parse(store.get("stories")));
    assert.ok(stored.length > 0, "the run stored its stories");
  }
});

test("job through the kit's caps: the run ends clean (no cap crossed) and the next run resumes from what was stored", async () => {
  const net = heavyNet();
  const fetchImpl = async (url, init) => { const r = await net.fetch(url, init); return new Response(await r.text(), { status: r.status }); };
  const devices = createSharedDevices({ now: Date.now });
  const { kino } = createKino(MANIFEST, { fetchImpl, device: "phone", shared: devices.phone, callFunction: "job", config: { terms: [{ term: "Avatar" }, { term: "Dune" }] } });
  for (let run = 0; run < 3; run++) {
    const budget = jobBudget();
    const { plugin } = await loadPlugin(join(DIR, "plugin.js"), jobKino(kino, budget), { console: quiet });
    const r = await runJob(plugin, jobContext("refresh", "manual"), budget);
    assert.equal(r.ok, true, "run " + run + ": " + r.failure);
  }
  const stories = JSON.parse(devices.phone.get(MANIFEST.id, "stories"));
  assert.ok(stories.length > 0);
  assert.ok(stories.some((x) => x.u), "later runs resolved and enriched some stories");
});

test("a step cut short still keeps its progress: the stories are stored after the feed, before any page", async () => {
  const p = await P();
  const store = memStore();
  const cache = p.makeCache(store);
  const clock = fakeClock();
  let calls = 0;
  const failing = async (url, opts) => {
    calls++;
    if (calls > 1) throw new Error("the run was cut");
    return { ok: true, status: 200, text: async () => rssOf(5) };
  };
  await p.step(cache, failing, { ...settingsBase, terms: ["Dune"] }, clock);
  assert.equal(p.validStories(JSON.parse(store.get("stories"))).length, 5);
});

/** Every text a tree shows a person, in both languages (texts, labels, titles, banners' lines). */
const wordsOf = (t) => all(t).flatMap((n) => [n.text, n.textEn, n.label, n.labelEn, n.title, n.titleEn, n.hint, n.hintEn]).filter((x) => typeof x === "string");

test("the terms line: the plain count only; no «destacadas» / featured sentence anywhere, with or without terms", async () => {
  const none = await rig({ net: { rss: rssOf(3) }, config: { terms: [], useLibrary: false } });
  const t0 = await tree(none.plugin, { tab: "settings" });
  assert.ok(ofType(t0, "text").some((x) => x.text === "0 de 50 términos en total."));
  const some = await rig({ config: { terms: [{ term: "Dune" }] } });
  const t1 = await tree(some.plugin, { tab: "settings" });
  assert.ok(ofType(t1, "text").some((x) => x.text === "1 de 50 términos en total."));
  // The feed with no term reads nothing and says so once, in its empty state: no banner, no hint in Configuración.
  const opened = await answer(none.plugin, "open");
  assert.equal(opened.state.feed.terms, 0);
  for (const lang of ["es", "en"]) {
    for (const state of [opened.state, { ...opened.state, tab: "settings" }, {}]) {
      for (const device of ["phone", "tv"]) {
        const words = wordsOf(await tree(none.plugin, state, { lang, device })).join(" | ");
        assert.doesNotMatch(words, /destacad|featured|top stories|Sin ninguno|With none|Agrega términos|Add terms in/i);
      }
    }
  }
  assert.ok(!all(await tree(none.plugin, opened.state)).some((n) => n.key === "noTerms"));
});

test("kit run: both tabs print a valid tree with nothing dropped, on a phone and on a TV", () => {
  for (const device of ["phone", "tv"]) {
    for (const tab of ["news", "settings"]) {
      const r = spawnSync(process.execPath, [RUN, "--device", device, "--state", JSON.stringify({ tab }), DIR, "screen"], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stderr, /dropped/, device + " " + tab);
    }
  }
});

// ---------- «Actualizar ahora» ----------

/** Moves this device's last manual refresh back by [ms], as if that long had passed since the tap. */
async function backdateManual(kino, ms) {
  const p = await P();
  const local = p.makeCache(kino.storage);
  local.set("manualRefreshAt", Number(local.get("manualRefreshAt")) - ms);
}

test("the refresh icon: Kino lists `refresh` (Task 8v) and the button keeps it", async () => {
  assert.ok(contract.manifest.panel.icons.includes("refresh"));
  const { plugin } = await rig({ net: { rss: rssOf(3) } });
  const t = await tree(plugin, { feed: { items: [], terms: 0, fetchedAt: 1 } });
  assert.equal(all(t).find((b) => b.key === "refreshButton").icon, "refresh");
});

test("the header on a phone: Kino's tabs on the left; the refresh icon on the right, in one row", async () => {
  const { plugin } = await rig({ net: { rss: rssOf(4) }, config: { loadMedia: false } });
  const a = await answer(plugin, "open");
  for (const tab of ["news", "settings"]) {
    for (const widthClass of ["compact", "medium", "expanded"]) {
      const t = await tree(plugin, { ...a.state, tab }, { size: { widthClass, heightClass: "medium", orientation: "portrait" } });
      const head = t.children[0];
      assert.equal(head.type, "row", "tabs and button share one row");
      assert.deepEqual(head.children.map((c) => c.key), ["tabs", "refreshButton"]);
      const [tabs, button] = head.children;
      assert.equal(tabs.type, "tabs");
      assert.equal(tabs.value, tab, "the tab selection still works");
      assert.equal(tabs.onChange.event.name, "pickTab");
      assert.equal(tabs.style.weight, 1, "the tabs take the room left, from the left edge");
      assert.equal(button.variant, "icon", "icon only: its label is not drawn");
      assert.equal(button.icon, "refresh");
      assert.equal(button.label, "Actualizar ahora", "the accessible label (TalkBack, the TV's focus)");
      assert.deepEqual(button.byClass, {}, "icon only in every size class");
      assert.deepEqual(plain(button.onTap.ui), [{ show: "refreshing" }]);
      assert.equal(button.onTap.event.name, "refreshNow");
      // A small margin under the header in every size class, then a thin line: scrolled content never touches the tabs.
      const pad = (head.byClass[widthClass] || head).style.padding;
      assert.ok(pad && pad.bottom > 0, widthClass + ": bottom padding under the header");
      assert.equal(t.children[1].type, "divider", "a thin line under the header");
      const line = t.children[2];
      assert.equal(line.key, "refreshing", "«Actualizando…» right under the header, on either tab");
      assert.equal(line.hidden, true, "hidden until the tap");
      assert.equal(ofType(line, "progress").length, 1);
      // Exactly one «Actualizando…»: the progress bar's own label, no sibling text (Redmi pass 3, D-A).
      assert.deepEqual(wordsOf(line).filter((w) => /Actualizando/.test(w)), ["Actualizando…"]);
      assert.equal(ofType(line, "progress")[0].label, "Actualizando…");
      assert.equal(ofType(line, "text").length, 0);
      const body = t.children[3];
      assert.equal(body.key, tab === "news" ? "newsBody" : "settingsBody", "then the tab's content (the header stays out of its scroll)");
      const inner = body.children[0];
      const bodyPad = (inner.byClass[widthClass] || inner).style.padding;
      assert.ok(bodyPad.top >= (widthClass === "expanded" ? 16 : 12), widthClass + ": the first heading never glued to the tabs");
    }
  }
  const en = await tree(plugin, a.state, { lang: "en" });
  assert.equal(en.children[0].children[1].label, "Refresh now");
  assert.ok(!all(en).some((n) => n.key === "updatedAgo"), "no «Updated …» caption");
  assert.equal(all(await tree(plugin, a.state)).filter((n) => n.key === "refreshButton").length, 1, "one refresh button");
});

test("the header never shows «Actualizado hace …», fresh, stale or failed", async () => {
  const { plugin } = await rig({ net: { rss: rssOf(4) }, config: { loadMedia: false } });
  const a = await answer(plugin, "open");
  for (const feed of [a.state.feed, { ...a.state.feed, stale: true }, { ...a.state.feed, failed: true }]) {
    const t = await tree(plugin, { ...a.state, feed });
    assert.ok(!all(t).some((n) => n.key === "updatedAgo"));
    assert.doesNotMatch(wordsOf(t).join(" | "), /Actualizado|actualizado|Updated|Sin conexión/);
    assert.deepEqual(t.children[0].children.map((c) => c.key), ["tabs", "refreshButton"]);
  }
});

test("the header on a TV: the same row, Kino's tab strip on the left and the refresh icon on the right", async () => {
  const { plugin } = await rig({ net: { rss: rssOf(4) }, config: { loadMedia: false }, device: "tv" });
  const a = await answer(plugin, "open");
  for (const tab of ["news", "settings"]) {
    const t = await tree(plugin, { ...a.state, tab }, { device: "tv", size: { widthClass: "expanded", heightClass: "medium", orientation: "landscape" } });
    const head = t.children[0];
    assert.equal(head.type, "row");
    // Tree order is the D-pad's: the tab strip (Left/Right walk its tabs and, past the last, reach the icon in this row).
    assert.deepEqual(head.children.map((c) => c.key), ["tabs", "refreshButton"]);
    assert.equal(head.children[0].type, "tabs");
    assert.equal(head.children[0].value, tab);
    assert.equal(head.children[0].onChange.event.name, "pickTab");
    assert.ok(!all(head).some((n) => /^tab_/.test(n.key || "")), "no button tabs any more");
    const button = head.children[1];
    assert.equal(button.variant, "icon", "the circular arrow with Kino's focus ring");
    assert.equal(button.label, "Actualizar ahora");
    assert.ok((head.byClass.expanded || head).style.padding.bottom >= 12, "room under the header on a TV");
    assert.equal(t.children[1].type, "divider");
    assert.equal(t.children[2].key, "refreshing");
    assert.equal(t.children[3].key, tab === "news" ? "newsBody" : "settingsBody");
  }
  const picked = await answer(plugin, "pickTab", { value: "settings" });
  assert.equal(picked.state.tab, "settings");
});

test("Noticias starts with the header, the category tabs and the cards: no heading or hint over them", async () => {
  const { plugin } = await rig({ net: { rss: rssOf(4) }, config: { loadMedia: false } });
  const a = await answer(plugin, "open");
  const t = await tree(plugin, a.state);
  const inner = t.children[3].children[0];
  assert.equal(inner.children[0].key, "category", "the category tabs come first in the body");
  assert.equal(inner.children[1].type, "row", "then the cards");
  const words = wordsOf(t).join(" | ");
  assert.doesNotMatch(words, /Tus noticias|Your news|Últimas noticias|Latest news/);
});

test("tree budgets with 100 stories in the state: Noticias first page <= 150 nodes and 60 KB, Configuración <= 120 nodes; only the active tab", async () => {
  const { plugin } = await rig();
  const items = Array.from({ length: 100 }, (_, i) => ({
    id: "s" + i, title: "Estreno número " + i + " de la semana en cines con un titular de largo normal", source: "Medio " + (i % 7),
    ts: Date.UTC(2026, 9, 26) - i * 60000, cat: ["film", "series", "sports"][i % 3], term: i % 2 ? "Avatar" : null, from: "watched",
    image: "https://www.diario.example/fotos/" + i + ".jpg", desc: "x".repeat(240),
  }));
  const feed = { items, fetchedAt: Date.UTC(2026, 9, 26), terms: 2 };
  for (const device of ["phone", "tv"]) {
    const over = { device, size: { widthClass: device === "tv" ? "expanded" : "compact", heightClass: "medium", orientation: "landscape" } };
    const news = await tree(plugin, { tab: "news", feed }, over);
    const raw = await plugin.screen(fakeScreenContext({ ...over, state: { ...fakeScreenContext().state, tab: "news", feed } }));
    const nodes = all(news).length;
    const bytes = Buffer.byteLength(JSON.stringify(raw));
    assert.ok(nodes <= 150, device + ": " + nodes + " nodes on Noticias");
    assert.ok(bytes <= 60 * 1024, device + ": " + bytes + " bytes on Noticias");
    assert.equal(cards(news).length, 12, "one page of cards");
    assert.ok(ofType(news, "image").length <= 12);
    assert.ok(cards(news).every((c) => ofType(c, "text").every((x) => (x.text || "").length <= 200)), "descriptions cut");
    assert.ok(!all(news).some((n) => n.key === "settingsBody" || n.key === "addTerm"), "no Configuración nodes");
    const more = all(news).find((n) => n.key === "moreButton");
    assert.equal(more.label, "Ver más (88)");
    const settings = await tree(plugin, { tab: "settings", feed }, over);
    assert.ok(all(settings).length <= 120, device + ": " + all(settings).length + " nodes on Configuración");
    assert.equal(cards(settings).length, 0, "no cards on Configuración");
  }
  // «Ver más» pages from the state: no request; later cards are text cards (pictures only on the first two pages).
  const m = await answer(plugin, "more", { arg: "36", state: { tab: "news", feed } });
  assert.deepEqual(plain(m.state), { shown: 36 });
  const page3 = await tree(plugin, { tab: "news", feed, shown: 36 });
  assert.equal(cards(page3).length, 36);
  assert.equal(ofType(page3, "image").length, plugin.PICTURE_CARDS);
  assert.ok(all(page3).length > 150, "the person asked for more: the budget is the first page's");
});

test("a tab switch is a pure state change: no request, no storage or shared write", async () => {
  const devices = createSharedDevices();
  const dir = mkdtempSync(join(tmpdir(), "news-tab-"));
  const storageFile = join(dir, "storage.json");
  const { plugin, seen, kino } = await rig({ net: { rss: rssOf(30) }, config: { loadMedia: false, useLibrary: true }, library: { watched: WATCHED }, shared: devices.phone, storageFile });
  const a = await answer(plugin, "open");
  const requests = seen.length;
  const before = readFileSync(storageFile, "utf8");
  const sharedBefore = JSON.stringify(["feed", "stories", "work", "excluded"].map((k) => kino.shared.get(k)));
  let state = a.state;
  for (const tab of ["settings", "news", "settings", "news"]) {
    const r = await answer(plugin, "pickTab", { value: tab, state });
    state = { ...state, ...r.state };
    await tree(plugin, state);
  }
  const c = await answer(plugin, "category", { value: "film", state });
  assert.deepEqual(Object.keys(plain(c.state)).sort(), ["cat", "shown"]);
  assert.equal(seen.length, requests, "no request");
  assert.equal(readFileSync(storageFile, "utf8"), before, "no storage write");
  assert.equal(JSON.stringify(["feed", "stories", "work", "excluded"].map((k) => kino.shared.get(k))), sharedBefore, "no shared write");
  // After a settings change, Noticias reloads by a one-second timer once drawn, never in the tab switch.
  const changed = await answer(plugin, "media", { value: false, state });
  state = { ...state, ...changed.state, tab: "settings" };
  const back = await answer(plugin, "pickTab", { value: "news", state });
  assert.equal(seen.length, requests, "the switch back fetches nothing");
  state = { ...state, ...back.state };
  const raw = await plugin.screen(fakeScreenContext({ state: { ...fakeScreenContext().state, ...state } }));
  assert.deepEqual(plain(raw.every), [plain(plugin.TICK), { ms: 1000, event: "reload" }]);
  const reload = await answer(plugin, "reload", { state });
  assert.equal(reload.state.feedOutdated, false);
  const after = await plugin.screen(fakeScreenContext({ state: { ...fakeScreenContext().state, ...state, ...reload.state } }));
  assert.deepEqual(plain(after.every), plain(plugin.TICK), "the reload timer is gone");
});

test("the story pop-up: no close control of its own (Kino draws it), «Ver noticia» its only button; the add-term pop-up keeps Cancelar and Guardar", async () => {
  const { plugin } = await rig();
  const a = await answer(plugin, "open");
  const id = a.state.feed.items[0].id;
  const r = await answer(plugin, "read", { arg: id, state: a.state });
  const t = await tree(plugin, { ...a.state, ...r.state });
  const pop = all(t).find((n) => n.key === "story");
  assert.ok(!pop.title, "no title row");
  assert.deepEqual(pop.buttons.map((b) => b.label), ["Ver noticia"]);
  assert.ok(!ofType(pop, "button").some((b) => /Cerrar|Close/.test(b.label) || b.icon === "close"), "no close button in the body");
  assert.ok(!wordsOf(pop).some((w) => /^Cerrar$|^Close$/.test(w)));
  const s = await tree(plugin, { tab: "settings" });
  const add = all(s).find((n) => n.key === "addTerm");
  assert.deepEqual(add.buttons.map((b) => b.label), ["Cancelar"]);
  assert.ok(ofType(add, "button").some((b) => b.label === "Guardar"));
  assert.ok(!wordsOf(add).some((w) => /^Cerrar$|^Close$/.test(w)));
});

test("manualRefresh: new stories counted against the ids before, up to 3 steps, never the AI", async () => {
  const p = await P();
  assert.equal(p.MANUAL_STEPS, 3);
  assert.equal(p.MANUAL_GAP_MS, 30000);
  const cache = p.makeCache(memStore());
  const clock = fakeClock();
  const r0 = await p.manualRefresh(cache, fakeNet({ rss: rssOf(5, { from: 10 }), clock }).fetch, settingsBase, clock, p.budgetFor("phone"), 0);
  assert.equal(r0.throttled, false);
  assert.equal(r0.failed, false);
  assert.equal(r0.newCount, 5);
  assert.ok(r0.steps >= 1 && r0.steps <= 3, r0.steps + " steps");
  clock.t += 3600000;
  const r1 = await p.manualRefresh(cache, fakeNet({ rss: rssOf(8, { from: 7 }), clock }).fetch, settingsBase, clock, p.budgetFor("phone"), 0);
  assert.equal(r1.newCount, 3, "7, 8 and 9 are new; 10 to 14 were there");
  assert.equal(r1.stories.length, 8);
  assert.ok(r1.steps <= 3);
  clock.t += 3600000;
  const r2 = await p.manualRefresh(cache, fakeNet({ rss: rssOf(8, { from: 7 }), clock }).fetch, settingsBase, clock, p.budgetFor("phone"), 0);
  assert.equal(r2.newCount, 0, "the same feed again: nothing new");
  // `step` is called with no AI: a refresh never asks, whatever the settings say.
  const asked = [];
  const r3 = await p.manualRefresh(p.makeCache(memStore()), fakeNet({ rss: rssOf(3), clock }).fetch, { ...settingsBase, useAi: true, ask: () => asked.push(1) }, clock, p.budgetFor("phone"), 0);
  assert.equal(r3.failed, false);
  assert.equal(asked.length, 0);
});

test("manualRefresh, realistic sizes: all its steps together stay within one step's byte, request and time budget", async () => {
  const p = await P();
  for (const device of ["phone", "tv"]) {
    const cache = p.makeCache(memStore());
    const clock = fakeClock();
    const start = clock.now();
    const net = heavyNet();
    let read = 0;
    const fetch = async (url, opts) => {
      const r = await net.fetch(url, opts);
      const text = await r.text();
      const cut = opts && opts.maxBytes ? Buffer.from(text, "utf8").subarray(0, opts.maxBytes).toString("utf8") : text;
      read += Buffer.byteLength(cut, "utf8");
      clock.t += 300;
      return { ok: r.ok, status: r.status, text: async () => cut };
    };
    const b = p.budgetFor(device);
    const r = await p.manualRefresh(cache, fetch, settingsBase, clock, b, 0);
    assert.ok(r.steps >= 1 && r.steps <= 3, device + ": " + r.steps + " steps");
    assert.ok(r.fetches <= b.maxFetches, device + ": " + r.fetches + " requests");
    assert.ok(r.bytes <= b.maxBytes, device + ": counted " + r.bytes);
    assert.ok(read <= b.maxBytes && read < 2 * 1024 * 1024, device + ": read " + read + " bytes");
    assert.ok(clock.now() - start <= b.maxMs + 5000, device + ": " + (clock.now() - start) + " ms");
    assert.ok(r.stories.length > 0);
  }
});

test("manualRefresh: a second refresh within 30 s does nothing; after 30 s it runs again", async () => {
  const p = await P();
  const cache = p.makeCache(memStore());
  const clock = fakeClock();
  const net = fakeNet({ rss: rssOf(3), clock });
  const lastAt = clock.now();
  clock.t += 10000;
  const r = await p.manualRefresh(cache, net.fetch, settingsBase, clock, p.budgetFor("phone"), lastAt);
  assert.deepEqual(plain(r), { throttled: true });
  assert.equal(net.seen.length, 0);
  clock.t += 20000;
  const again = await p.manualRefresh(cache, net.fetch, settingsBase, clock, p.budgetFor("phone"), lastAt);
  assert.equal(again.throttled, false);
  assert.ok(net.seen.length >= 1);
});

test("manualRefresh: a feed that cannot be read keeps the stored stories and says it failed", async () => {
  const p = await P();
  const cache = p.makeCache(memStore());
  const clock = fakeClock();
  await p.manualRefresh(cache, fakeNet({ rss: rssOf(4), clock }).fetch, settingsBase, clock, p.budgetFor("phone"), 0);
  const before = plain(cache.get("stories")).map((x) => [x.id, x.t]);
  clock.t += 3600000;
  const r = await p.manualRefresh(cache, fakeNet({ rssStatus: 503, clock }).fetch, settingsBase, clock, p.budgetFor("phone"), 0);
  assert.equal(r.failed, true);
  assert.equal(r.newCount, 0);
  assert.equal(r.steps, 1, "no second step after a failed feed");
  assert.equal(r.stories.length, 4);
  assert.deepEqual(plain(cache.get("stories")).map((x) => [x.id, x.t]), before, "the stored stories are kept (their pages may go on being read)");
});

test("the refreshNow event: new stories, a tap within 30 s (or queued behind one) ignored, then nothing new; the line hidden", async () => {
  let rss = rssOf(4);
  const { plugin, kino, seen } = await rig({ net: { rss: () => rss }, config: { loadMedia: false } });
  const opened = await answer(plugin, "open");
  assert.equal(opened.state.feed.items.length, 4);
  rss = rssOf(6, { base: Date.UTC(2026, 9, 26, 12) + 2 * 60000, from: -2 });
  const a = await answer(plugin, "refreshNow", { state: opened.state });
  assert.deepEqual(plain(a.ui), [{ hide: "refreshing" }]);
  assert.equal(a.toast.text, "Hay 2 noticias nuevas");
  assert.equal(a.toast.role, "success");
  assert.equal(a.state.feed.items.length, 6);
  // Kino runs a plugin's events one at a time: a second tap (or one queued while the first ran) finds the first one's mark.
  const count = seen.length;
  const b = await answer(plugin, "refreshNow", { state: a.state, lang: "en" });
  assert.equal(seen.length, count, "no request");
  assert.ok(!b.state, "the feed stays as it is");
  assert.match(b.toast.text, /^Wait a moment/);
  assert.deepEqual(plain(b.ui), [{ hide: "refreshing" }]);
  await backdateManual(kino, 31000);
  const c = await answer(plugin, "refreshNow", { state: a.state });
  assert.ok(seen.length > count, "30 s later it runs");
  // No new story: «Noticias al día» when the step still finished some work (links, pages), «Sin novedades» when nothing changed.
  assert.ok(["Noticias al día", "Sin novedades"].includes(c.toast.text), c.toast.text);
  assert.equal(c.state.feed.items.length, 6);
  // The screen never refreshes by itself: opening and the timer do not start a manual refresh.
  const t = await answer(plugin, "tick", { state: c.state });
  assert.ok(!t || !t.toast || !/noticias nuevas|Sin novedades/.test(t.toast.text));
});

test("the refreshNow event with the feed down: the error toast, the stored cards stay", async () => {
  let down = false;
  const { plugin } = await rig({ net: { rss: () => { if (down) throw new Error("down"); return rssOf(4); } }, config: { loadMedia: false } });
  const opened = await answer(plugin, "open");
  down = true;
  const a = await answer(plugin, "refreshNow", { state: opened.state });
  assert.equal(a.toast.role, "error");
  assert.match(a.toast.text, /^No se pudo actualizar/);
  assert.equal(a.state.feed.items.length, 4, "the stored cards stay");
  assert.equal(a.state.feed.stale, true);
  assert.equal(a.state.feed.failed, false);
});

// ---------- the 18+ filter ----------

/** RSS from [{ title, source, url? }], the newest first; an `url` gives the item an old-style Google token for that address. */
function rssFrom(list, base = Date.UTC(2026, 9, 26, 12)) {
  const items = list.map((x, i) => {
    const link = x.url
      ? "https://news.google.com/rss/articles/" + Buffer.from("\x08\x13\x22" + String.fromCharCode(x.url.length) + x.url + "\xd2\x01\x00", "latin1").toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_") + "?oc=5"
      : OPAQUE.replace("CBM", "CBM" + i + "a");
    return `<item><title>${x.title} - ${x.source}</title><link>${link}</link><guid>a${i}</guid><pubDate>${new Date(base - i * 60000).toUTCString()}</pubDate><source url="https://m.example">${x.source}</source></item>`;
  });
  return `<rss><channel>${items.join("")}</channel></rss>`;
}

const ADULT_YES = [
  "Filtran video porno de un famoso actor", "La industria del porno en crisis", "Estrella porno anuncia su retiro",
  "Pornografía infantil: capturan a red en Bogotá", "Les dangers de la pornographie chez les ados", "Study on pornography and teens",
  "Pornstar launches clothing line", "Nueva ley contra la prostitución en Colombia", "Prostitution ring busted in Miami",
  "Rede de prostituição desmantelada em São Paulo", "Detienen a dos prostitutas en el centro", "Actriz confirma su cuenta de OnlyFans",
  "OnlyFans creator earnings revealed", "Los videos más vistos de Pornhub en 2026", "XVideos bloqueado en Turquía",
  "Leaked sex tape of reality star", "La sextape de la influencer", "Sexo explícito en la nueva serie: polémica",
  "Une scène de sexe explicite fait scandale", "Sexually explicit content on the platform", "Contenido para adultos en la plataforma",
  "Adult content creators protest new rules", "Adult film star dies at 40", "Garota de programa revela rotina",
  "Escort service shut down by police", "Servicio de escorts de lujo desarticulado", "Escorts de lujo en Medellín",
  "Club de striptease cerrado por la alcaldía", "Strip club owner arrested", "Fotos +18 de la cantante se filtran",
  "Contenido 18+ en la app", "Imágenes NSFW generadas con IA", "Video XXX de una modelo", "Hentai: el anime para adultos",
  "Orgía en una mansión de Hollywood", "Masturbación: lo que dice un estudio", "BDSM y consentimiento en el cine",
  "Pornô brasileiro em alta", "Film porno tourné à Paris", "Chaturbate model sues platform",
];
const ADULT_NO = [
  "Sex Education estrena su temporada final", "Sex and the City: el reboot vuelve", "El sexto episodio de The Last of Us",
  "Essex derby ends in a draw", "Harry y Meghan, duques de Sussex", "Middlesex University film festival",
  "Young adult novel becomes Netflix series", "Adulthood: a new HBO drama", "Adultos mayores reciben la vacuna",
  "Contenido para adultos mayores en la radio pública", "El Ford Escort vuelve en versión eléctrica", "Navy escort ships arrive",
  "Super Bowl XXX: recordando el partido", "Pornic accueille un festival de cinéma", "Thriller erótico de los noventa vuelve a cines",
  "Sexy Beast llega a Paramount+", "Adult Swim renueva Rick and Morty", "La película para toda la familia del año",
  "El dólar sube +18% en octubre", "Las ventas suben 18 % este año", "Avatar: Fuego y Ceniza bate récords",
  "Dune: Parte Tres confirma su reparto", "Stranger Things: el final explicado", "One Piece temporada 2 en Netflix",
  "Dragon Ball Daima termina", "Breaking Bad cumple años y su elenco se reúne", "Ley de educación sexual en debate",
  "Campaña de salud sexual en colegios", "Diversidad sexual en el cine latino", "The Sexual Life of College Girls renewed",
  "Prosecutors charge the producer", "Prosperity Gospel documentary", "Estreno de Adultos, la nueva comedia",
  "Babygirl, de Nicole Kidman, llega a streaming", "Porto vence al Benfica", "Escorpión, el nuevo thriller",
  "18 años de Grey's Anatomy", "Ganó por 18 puntos de diferencia", "Matrix cumple 25 años", "Mortal Kombat 2 tráiler oficial",
];

test("isAdult: a table of 80 headlines (40 18+, 40 not), whole words and phrases, accents and case aside", async () => {
  const p = await P();
  assert.ok(ADULT_YES.length + ADULT_NO.length >= 60);
  for (const t of ADULT_YES) assert.equal(p.isAdult(t), true, "should be 18+: " + t);
  for (const t of ADULT_NO) assert.equal(p.isAdult(t), false, "should pass: " + t);
  assert.equal(p.isAdult(""), false);
  assert.equal(p.isAdult(null), false);
  assert.equal(p.isAdult("PORNOGRAFÍA"), true, "case and accents aside");
  assert.equal(p.isAdult("Super Bowl XXX y luego un video xxx"), true, "a second xxx is not the Super Bowl's");
});

test("isAdultUrl and adultRecord: the adult domains and their subdomains, http or https; a record by any of its fields", async () => {
  const p = await P();
  for (const u of ["https://www.pornhub.com/view", "https://es.xvideos.com/x", "http://onlyfans.com/a", "https://xhamster.com"]) assert.equal(p.isAdultUrl(u), true, u);
  for (const u of ["https://www.eltiempo.com/cine", "https://notpornhub.com.example.org/", "https://pornhub.com.evil.example/", "ftp://pornhub.com", "", null]) assert.equal(p.isAdultUrl(u), false, String(u));
  assert.equal(p.adultRecord({ t: "Avatar", s: "Diario", d: "", u: "https://www.diario.example/x", c: "film" }), false);
  assert.equal(p.adultRecord({ t: "Avatar", s: "Diario", d: "", u: "https://www.pornhub.com/x", c: "film" }), true, "by the outlet");
  assert.equal(p.adultRecord({ t: "Avatar", s: "XVideos", d: "", u: null, c: "film" }), true, "by the source's name");
  assert.equal(p.adultRecord({ t: "Avatar", s: "Diario", d: "Un video porno filtrado", u: null, c: "film" }), true, "by the description");
  assert.equal(p.adultRecord({ t: "Avatar", s: "Diario", d: "", u: null, c: "adult" }), true, "by the AI's category");
  assert.ok(p.ADULT_DOMAINS.length >= 10);
});

test("buildTerms: an adult term or watched title is never searched with the filter on (the default); off, it is", async () => {
  const p = await P();
  const titles = [{ title: "Avatar", kind: "movie" }, { title: "Pornstar Diaries", kind: "series" }];
  const on = plain(p.buildTerms({ terms: ["Dune", "porno gratis"], titles, useLibrary: true }));
  assert.deepEqual(on.map((x) => x.term), ["Dune", "Avatar"]);
  const off = plain(p.buildTerms({ terms: ["Dune", "porno gratis"], titles, useLibrary: true, hideAdult: false }));
  assert.deepEqual(off.map((x) => x.term), ["Dune", "porno gratis", "Avatar", "Pornstar Diaries"]);
});

test("step with the filter (default on): adult headlines, sources and outlets never enter the cache or the counts; off, they do", async () => {
  const p = await P();
  const list = [
    { title: "Avatar: Fuego y Ceniza bate récords", source: "Diario" },
    { title: "Filtran video porno de un famoso actor", source: "Diario" },
    { title: "Dune: Parte Tres confirma su reparto", source: "XVideos" },
    { title: "Stranger Things: el final explicado", source: "Diario", url: "https://www.pornhub.com/view_video" },
    { title: "One Piece temporada 2 en Netflix", source: "Diario" },
  ];
  const rss = rssFrom(list);
  for (const [settings, expected] of [
    [{ ...settingsBase }, ["Avatar: Fuego y Ceniza bate récords", "One Piece temporada 2 en Netflix"]],
    [{ ...settingsBase, hideAdult: true }, ["Avatar: Fuego y Ceniza bate récords", "One Piece temporada 2 en Netflix"]],
    [{ ...settingsBase, hideAdult: false }, list.map((x) => x.title)],
  ]) {
    const store = memStore();
    const cache = p.makeCache(store);
    const clock = fakeClock();
    const net = fakeNet({ rss, clock });
    const r = await p.step(cache, net.fetch, settings, clock, { ...p.budgetFor("phone"), maxFetches: 10 });
    assert.deepEqual(plain(r.stories).map((x) => x.t), expected);
    assert.deepEqual(plain(p.validStories(JSON.parse(store.get("stories")))).map((x) => x.t), expected, "the cache holds the same");
    if (settings.hideAdult !== false) assert.ok(!net.seen.some((x) => /pornhub/.test(x.url)), "no adult page is ever read");
    const counts = plain(p.categoryOptions(r.stories.map((x) => ({ cat: x.c }))));
    assert.equal(counts[0].label, "Todas (" + expected.length + ")");
  }
});

test("a cache written with the filter off (or by an older version) loses its adult stories at the next step with it on", async () => {
  const p = await P();
  const store = memStore();
  const cache = p.makeCache(store);
  const clock = fakeClock();
  const rss = rssFrom([{ title: "Avatar: Fuego y Ceniza bate récords", source: "Diario" }, { title: "Actriz confirma su cuenta de OnlyFans", source: "Diario" }]);
  await p.step(cache, fakeNet({ rss, clock }).fetch, { ...settingsBase, hideAdult: false }, clock);
  assert.equal(p.validStories(JSON.parse(store.get("stories"))).length, 2);
  // The same cache under the old key (no "|18+": what a legacy feed looks like), stepped with the filter on by default.
  const feed = JSON.parse(store.get("feed"));
  store.set("feed", JSON.stringify({ ...feed, key: feed.key.replace("|18+", "") }));
  const r = await p.step(cache, async () => { throw new Error("no request expected"); }, { ...settingsBase }, clock);
  assert.deepEqual(plain(r.stories).map((x) => x.t), ["Avatar: Fuego y Ceniza bate récords"]);
  assert.deepEqual(plain(p.validStories(JSON.parse(store.get("stories")))).map((x) => x.t), ["Avatar: Fuego y Ceniza bate récords"]);
});

test("an outlet resolved to an adult site: the story is dropped and its page never read", async () => {
  const p = await P();
  const store = memStore();
  const cache = p.makeCache(store);
  const clock = fakeClock();
  const net = fakeNet({ rss: rssOf(2), clock, resolver: FIX("batchexecute-answer.txt").replace(/https:\/\/www\.diario\.example[^"\\]*/g, "https://www.pornhub.com/view") });
  for (let i = 0; i < 4; i++) await p.step(cache, net.fetch, { ...settingsBase }, clock);
  assert.ok(!net.seen.some((x) => /pornhub/.test(x.url)), "never fetched");
  assert.equal(p.validStories(JSON.parse(store.get("stories"))).filter((x) => /pornhub/.test(x.u || "")).length, 0);
});

test("the AI may answer «adult» with the filter on: those stories are dropped, never a category; off, «adult» is «other»", async () => {
  const p = await P();
  const stories = [{ id: "s0", t: "Uno" }, { id: "s1", t: "Dos" }];
  assert.match(p.buildCategoryPrompt(stories).system, /adult/);
  assert.doesNotMatch(p.buildCategoryPrompt(stories, 40, false).system, /adult/);
  const answer = "[{\"id\":\"s0\",\"category\":\"adult\"},{\"id\":\"s1\",\"category\":\"film\"}]";
  assert.deepEqual(plain(p.parseCategories(answer, stories, true)), { s0: "adult", s1: "film" });
  assert.deepEqual(plain(p.parseCategories(answer, stories)), { s0: "other", s1: "film" });
  assert.ok(!p.CATEGORIES.some((c) => c.value === "adult"), "never a tab");
  const store = memStore();
  const cache = p.makeCache(store);
  const clock = fakeClock();
  await p.step(cache, fakeNet({ rss: rssOf(3), clock }).fetch, { ...settingsBase, loadMedia: false }, clock);
  const ids = p.validStories(JSON.parse(store.get("stories"))).map((x) => x.id);
  const ask = async () => JSON.stringify(ids.map((id, i) => ({ id, category: i === 0 ? "adult" : "film" })));
  const r = plain(await p.classifyNow(cache, clock, undefined, ask));
  assert.equal(r.stories.length, 2);
  assert.ok(!p.validStories(JSON.parse(store.get("stories"))).some((x) => x.id === ids[0]));
});

test("the screen: «No mostrar noticias +18» on by default, locked with Kino's 18+ code, in Kino's own settings form", async () => {
  const setting = MANIFEST.settings.find((s) => s.key === "hideAdult");
  assert.equal(setting.default, true);
  assert.equal(setting.unlockWith, "adultCode", "switching it off asks the device's 18+ code (Kino's prompt)");
  assert.equal(setting.label, "No mostrar noticias +18");
  assert.equal(setting.labelEn, "Hide 18+ news");
  assert.equal(setting.hint, "Filtro básico por palabras: puede no detectar todo");
  assert.equal(setting.hintEn, "A basic word filter: it may not catch everything");
  const { plugin } = await rig();
  const t = await tree(plugin, { tab: "settings" });
  // Kino's form draws the switch (and its hint), asks the code and saves: the plugin has no toggle and no event for it.
  assert.equal(ofType(t, "toggle").find((x) => x.key === "hideAdult"), undefined);
  assert.deepEqual(ofType(t, "settings").map((x) => x.keys), [["hideAdult"]]);
  assert.ok(ofType(t, "text").some((x) => x.text === "Para apagarlo, Kino te pide su código de control parental; luego pulsa Guardar."));
  const en = await tree(plugin, { tab: "settings" }, { lang: "en" });
  assert.ok(ofType(en, "text").some((x) => x.text === "To switch it off, Kino asks for its parental control code; then press Save."));
  // The old plugin event is gone: nothing the plugin answers can switch the filter off.
  assert.equal(await answer(plugin, "adultFilter", { value: false }), null);
});

test("the 18+ filter changed in Configuración reloads Noticias on the way back; unchanged, nothing reloads", async () => {
  const { plugin } = await rig();
  const opened = await answer(plugin, "pickTab", { value: "settings" });
  assert.equal(opened.state.adultWas, true);
  // Unchanged: back on Noticias, no reload.
  const same = await answer(plugin, "pickTab", { value: "news", state: opened.state });
  assert.equal(same.state.feedOutdated, undefined);
  assert.equal(same.state.adultWas, null);
  // The person switched it off in Kino's form (after the code): back on Noticias, the feed reloads.
  const off = await rig({ config: { hideAdult: false } });
  const back = await answer(off.plugin, "pickTab", { value: "news", state: opened.state });
  assert.equal(back.state.feedOutdated, true);
});

test("adult terms and watched titles: «Oculto por el filtro +18» in their rows and never in a query; with the filter off they are searched", async () => {
  const library = { watched: [
    { title: "Avatar", kind: "movie", year: 2009, watchedAtMs: Date.UTC(2026, 9, 20) },
    { title: "Pornstar Diaries", kind: "series", watchedAtMs: Date.UTC(2026, 9, 19) },
  ] };
  const config = { useLibrary: true, libraryCount: "5", loadMedia: false, terms: [{ term: "Dune" }, { term: "video porno" }] };
  const { plugin, seen } = await rig({ library, config });
  await answer(plugin, "open");
  const q = decodeURIComponent(new URL(seen[0].url).searchParams.get("q"));
  assert.equal(q, "Dune OR (\"Avatar\" película)");
  const tab = await answer(plugin, "pickTab", { value: "settings" });
  const t = await tree(plugin, tab.state);
  const hiddenRows = ofType(t, "row").filter((r) => ofType(r, "text").some((x) => x.text === "Oculto por el filtro +18"));
  assert.deepEqual(hiddenRows.map((r) => ofType(r, "text")[0].text), ["Pornstar Diaries", "video porno"]);
  const off = await rig({ library, config: { ...config, hideAdult: false } });
  await answer(off.plugin, "open");
  assert.match(decodeURIComponent(new URL(off.seen[0].url).searchParams.get("q")), /video porno.*Pornstar Diaries/);
  const t2 = await tree(off.plugin, { tab: "settings" });
  assert.ok(!wordsOf(t2).includes("Oculto por el filtro +18"));
});

test("a story the filter drops is never opened: no pop-up, no page read", async () => {
  const { plugin, kino, seen } = await rig();
  const p = await P();
  // A story stored with the filter off (or by an older version), read with it on (the default).
  p.makeCache(kino.storage).set("stories", [{ id: "sadult01", t: "Filtran video porno de un famoso actor", s: "Diario", p: 1, g: null, u: "https://www.diario.example/x", i: null, d: "", c: "other", a: 0, r: 0, m: 0, ok: false, q: 0 }]);
  assert.equal(await answer(plugin, "read", { arg: "sadult01" }), null);
  assert.equal(seen.length, 0, "no page read");
  const off = await rig({ config: { hideAdult: false, loadMedia: false } });
  p.makeCache(off.kino.storage).set("stories", [{ id: "sadult01", t: "Filtran video porno de un famoso actor", s: "Diario", p: 1, g: null, u: "https://www.diario.example/x", i: null, d: "", c: "other", a: 0, r: 0, m: 0, ok: false, q: 0 }]);
  const opened = await answer(off.plugin, "read", { arg: "sadult01" });
  assert.deepEqual(plain(opened.ui), [{ open: "story" }], "with the filter off it opens");
});
