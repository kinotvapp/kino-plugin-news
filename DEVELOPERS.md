# Solo noticias: for developers

How the plugin works inside, how to test it and how a new version is made. The person-facing documentation is
[README.md](README.md) ([español](README.es.md)).

## Where the code comes from

The code lives in `src/` (one file per responsibility; `src/plugin.js` only re-exports) and `npm run build` bundles it
with esbuild into `plugin.js`, the one file Kino installs (the manifest's `entry`). `plugin.js` is generated, committed
and signed: never edit it by hand. "How the code is organized" below (synced from the example) says which folder owns
what.

`src/`, `plugin.js` and `test/` are kept in sync with the `screen-news` example of Kino's plugin guide. Kino's repository
is the source of truth for the code; this repository owns the publishing metadata (`id`, `name`, `version`,
`description`, `author`, `homepage`, `icon`, `color`, `categories`, `signature`) and the documents. To bring a newer
example in:

```sh
node scripts/sync-from-example.mjs <kino>/docs/plugins/examples/screen-news --dry-run   # what would change
node scripts/sync-from-example.mjs <kino>/docs/plugins/examples/screen-news
```

It mirrors `src/` (only the entry's first comment line changes), copies the generated `plugin.js` as the example built it
(the same bytes: `npm run check:built` proves it here), `scripts/build.mjs` and the build part of `package.json` (the
`build` and `check:built` scripts, esbuild), mirrors `test/` with the kit imports pointed at `sdk/`, takes the manifest's
working fields and never the ones listed above, refreshes the Node kit (`sdk/`, `contract.json`, `kino.d.ts`) from the
same Kino checkout (`--no-kit` to skip), and rewrites the section below. When `plugin.js` or a working field changed it
drops the stale `signature` and tells you what comes next.

## Testing and signing

```sh
npm install          # once: esbuild (node_modules/ is ignored)
npm run build        # src/ -> plugin.js, deterministic: the same sources give the same bytes
npm run check:built  # fails when plugin.js is not exactly what src/ builds to
npm test             # node --test test/*.test.mjs: the built plugin.js in the kit's sandbox, plus the check above; no network
npm run validate     # node sdk/validate.mjs . --repo kinotvapp/kino-plugin-news
npm run sign         # signs plugin.js with the author key (~/.config/kino/kino-author-key.pem, or $KINO_AUTHOR_KEY)
```

Try it by hand with the kit (it reaches the real Google News):

```sh
node sdk/run.mjs --device phone . job refresh
node sdk/run.mjs --device tv . screen
node sdk/run.mjs . shared
```

A new version, step by step:

1. Change the code in `src/` (or sync it from the example, above). Never edit `plugin.js` by hand.
2. `npm run build`, then `npm run check:built` and `npm test`.
3. Raise `version` in `kino-plugin.json` and add a `CHANGELOG.md` entry.
4. `npm run sign`, then `npm run validate` (it checks the signature too).
5. Commit `src/`, `plugin.js`, `kino-plugin.json` and `CHANGELOG.md` together, then push.

Every change to `plugin.js` or to `version` needs a new signature, always with the same key: Kino refuses an update
signed by another one.

## How it works

<!-- sync:begin example-readme -->
_Synced by `scripts/sync-from-example.mjs` from `docs/plugins/examples/screen-news` in Kino's repository at `efddb7278`. Do not edit by hand: change the example and sync again._

### Where the news come from

- **The 18+ filter** (`hideAdult`, on by default: a fresh install and an update both read a missing value as on). A
  basic, pure word filter (`isAdult`): whole words and phrases in Spanish, English, Portuguese and French, accents and case
  aside (porno, pornografía, xxx, NSFW, +18, OnlyFans, sex tape, sexo explícito, escort service, prostitución, the names of
  well-known adult sites...), and a small list of adult domains (`isAdultUrl`) for the outlet's address. It is careful
  with look-alikes (Sex Education, sexto, Essex, Sussex, young adult, Ford Escort, Super Bowl XXX). With it on, a story
  whose headline, source, description or outlet looks 18+ never enters the cache or the category counts and its page is
  never read; the person's terms and watched titles that look 18+ are never sent to Google and show «Oculto por el filtro
  +18» in their rows; with the AI on, it may also answer the internal category `adult`, and those stories are dropped
  (never a tab). The screen says it honestly: «Filtro básico por palabras: puede no detectar todo». Off, nothing is
  filtered. The switch is locked with Kino's 18+ code (`"unlockWith": "adultCode"`, apiVersion 14): Configuración shows it
  through Kino's own settings form (`{ type: "settings", keys: ["hideAdult"] }`), which asks the device's 18+ code before
  switching it off (never to switch it on) and saves it; the plugin never sees the code and has no event of its own for it.
  When the person comes back to Noticias with the filter changed, the feed reloads.

- **Google News RSS** (`news.google.com`, no key). With no term: the top stories of the edition that matches Kino's
  language. With terms: OR searches, e.g. `"Dragon Ball Daima" OR ("Avatar" película) OR ("Breaking Bad" serie)`: a watched
  title is narrowed to its kind in the edition's language (`movie`, `"TV series"` in English), the person's own terms are
  used as written. Each search's address stays under 1800 characters; at most 10 searches a step.
- **Google's feed terms** allow it only in a personal feed reader, which is what this screen is on the person's device.
- **Pictures and texts** (on by default; `"fetchHosts": "any"`, consented in red): the plugin finds each story's page
  and reads its picture and description from the head (`og:image`, `og:description`, `maxBytes: 65536`). Google's newer
  article links are opaque: they are resolved with the same two requests Google's own page makes (its `data-n-a-sg`
  signature, then the `Fbv4je` call to `batchexecute`). **That is unofficial and fragile**: when it fails, the button and
  the QR keep Google's link. Off: no connection to the outlets.
- **The story's text** is read when the person opens it (`maxBytes: 262144`; its `<article>` or its densest block of
  paragraphs, at most 6000 characters, boilerplate left out). It is an extract and may be partial (paywalls); the
  pop-up says so.
- **Categories**: a keyword guess on the device. With «Clasificar con IA» on, the headlines (only an id and the headline
  text, 10 per question) go to Kino's text AI (`kino.ai.ask`, `json: true`, capability `ai`, consented in red): in the
  scheduled job, or when the person presses «Clasificar ahora» (Kino refuses it on open and on a timer). The reply is
  checked strictly (known ids and categories only); without one the guesses stay.

### The work: a background job and one step at a time

The recommended pattern for heavy plugin work: nothing is done all at once. One pure function, `step(cache, fetch,
settings, clock, budget, ask)`, moves a **work queue** forward:

1. the feed, only when it is older than an hour (`STALE_AFTER_MIN`, the job's default period) or the terms changed: at most 10 OR searches; with more,
   each step takes the next ones (a cursor in the cache), so every term is searched over time;
2. then **one batch per stage**, in a rotating order so no stage starves: the outlet's address, the page's picture and
   description, the AI's category (when an `ask` is given; it counts as one of the step's requests); the first cards first.

The stories are a rolling window of the newest **100** (`MAX_STORIES`, one constant): a new one pushes the oldest out with
all its data, and the whole window stays under 60 KB of JSON (`fitSize`). A step keeps to its budget, `budgetFor(device)`:
a phone at most 10 requests, 1.6 MB (`STEP_MAX_BYTES`, a margin under the 2 MB Kino gives a job's run) and 18 s,
400 ms between requests, 6 s between AI questions; a TV a lighter one (5
requests, 1 MB, double spacing, pictures only for the first 8 cards, the AI only for the first 20). Each request gives up
after 5 s, reads at most a known size (`maxBytes`: Google News RSS 256 KB, a page's head 64 KB, Google's resolver page
1 MB, at most 2 of those a step) and starts only when both its time and its size still fit. What a step finds is stored
after the feed and after each stage, so a run that ends early keeps it and the next one resumes. The clock and the budget are parameters, so the kit tests
prove a step stops on its budget and the next one resumes from the cache.

Who calls `step`:

- **The job** (`jobs`: `refresh`, every 60 min by default, the person picks 15 min to 24 h; capability `schedule`;
  `runOn: "preferPhone"`): ONE of the person's linked devices runs it, the phone first, and the result is written to
  **kino.shared** (capability `shared`: the feed, the stories, the work state, the excluded titles; 4 keys, synced between
  the person's devices). A TV alone runs it itself, with the TV budget. Each job starts off until the person turns it on.
- **The screen**: on open it reads the shared cache and fetches only what is stale (stale-while-revalidate); while it is
  open a timer (`every` 10 s) runs a step, which does nothing when there is nothing to do. No AI there.
- **The header**: the tabs on the left; on the right «Actualizado hace 12 min» (a muted caption worked out from the stored
  `fetchedAt` on every render, «Sin conexión» in the warning colour when the feed is stale or failed) and the refresh
  button, the circular arrow alone (`variant: "icon"`; its label «Actualizar ahora» is what TalkBack and the TV's focus
  read). The same row on a phone and a TV: Kino's tab strip; on a TV Left and Right walk the tabs and, past the last one,
  reach the refresh icon in the same row (Down goes to the content). A small margin and a divider sit under the header, which stays
  out of the tabs' scroll; «Actualizando…» shows under it while a refresh works.
- **Switching tabs** is a pure state change: no request, no storage read or write (the watched titles shown in
  Configuración are the ones read when the screen opened). Only the active tab's nodes are in the tree. After a settings
  change Noticias reloads once it is drawn, by a one-second timer (`reload`) that the answer then removes.
- **Refreshing by hand** (`manualRefresh`): only from the person's tap, up to 3 steps in a row within ONE step's budget (requests, bytes, time), never the AI, at
  most one every 30 s («Espera un momento»), counting the new stories against the ids before; a feed that cannot be read
  keeps the stored ones.

Everything is read and written through one small cache adapter (`makeSharedCache`): kino.shared, with kino.storage on
this device as the fallback when kino.shared is missing or refuses. What it reads is checked like outside input
(another device, maybe another version of this plugin, wrote it). The article texts and the watched titles read last stay
in kino.storage on each device.

### How the code is organized

The code people read lives in `src/`, one small file per responsibility. Kino installs ONE file, `plugin.js` (the
manifest's `entry`), so `npm run build` bundles `src/` into it with [esbuild](https://esbuild.github.io/): one readable
ES module (not minified) with the same named exports, starting with a line that says it is generated. `plugin.js` stays
committed (Kino installs it straight from the repository, and the signature covers its bytes); **never edit it by hand**:
edit `src/`, then `npm run build`. `npm run check:built` (and the test `test/built.test.mjs`) fails when `plugin.js` is
not exactly what `src/` builds to.

```text
src/
  plugin.js        the entry: only re-exports the public surface (what Kino calls and what the tests use)
  limits.js        limits and pacing: terms, stories, cards, sizes read, refresh frequencies, the work budget
  util/            html.js (entities, tags), time.js (RSS dates, «hace 2 h»), text.js (folding, a term), values.js
  feed/            google-news.js: the editions, the RSS address, the article links, the feed's items
  store/           cache.js (kino.shared with kino.storage as fallback, the keys), stories.js (the stored story)
  terms/           terms.js (terms to queries, batches), watched.js (what the person watched as terms)
  filter/          adult.js: the 18+ filter
  categories/      categories.js: the keyword guess and Kino's text AI
  article/         page.js (the outlet's address, picture, description), text.js (a story's text),
                   read-story.js (what the pop-up shows, read on a tap)
  work/            schedule.js, stages.js, step.js (`step`, the budgeted work queue), manual.js («Actualizar ahora»)
  state/           load.js: the settings, the library and the storage as `step` and the screen read them
  ui/              samples.js, format.js, cards.js, story-popup.js, news-tab.js, settings-tab.js, header.js
  exports/         job.js (`job`), screen.js (`screen`), screen-event.js (`screenEvent`)
```

Imports only go one way (util and limits, then the pure readers, then work and state, then ui, then exports): there is
no import cycle. Each file starts with a comment that says what it owns.

```sh
npm install          # once: esbuild
npm run build        # src/ -> plugin.js
npm test             # the tests run the built plugin.js in the kit's sandbox, and check it is built from src/
npm run check:built  # plugin.js is exactly what src/ builds to
```
<!-- sync:end example-readme -->
