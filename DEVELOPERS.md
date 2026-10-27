# Solo noticias: for developers

How the plugin works inside, how to test it and how a new version is made. The person-facing documentation is
[README.md](README.md) ([español](README.es.md)).

## Where the code comes from

`plugin.js` and `test/` are kept in sync with the `screen-news` example of Kino's plugin guide, where the screen
widgets this plugin uses are developed. Kino's repository is the source of truth for the code; this repository owns the
publishing metadata (`id`, `name`, `version`, `description`, `homepage`, `icon`, `color`, `categories`, `signature`)
and the documents. To bring a newer example in:

```sh
node scripts/sync-from-example.mjs <kino>/docs/plugins/examples/screen-news --dry-run   # what would change
node scripts/sync-from-example.mjs <kino>/docs/plugins/examples/screen-news
```

It copies `plugin.js` (only its first comment line changes), mirrors `test/` with the kit imports pointed at `sdk/`,
takes the manifest's working fields (`apiVersion`, `hosts`, `fetchHosts`, `capabilities`, `jobs`, `screen`,
`settings`...) and never the ones listed above, refreshes the Node kit (`sdk/`, `contract.json`, `kino.d.ts`) from the
same Kino checkout (`--no-kit` to skip), and rewrites the section below. When the code or a working field changed it
drops the stale `signature` and tells you what comes next.

## Testing and signing

```sh
npm test            # node --test test/*.test.mjs: the kit's sandbox, fixtures, a fake clock and a fake AI; no network
npm run validate    # node sdk/validate.mjs . --repo kinotvapp/kino-plugin-news
npm run sign        # signs plugin.js with the author key (~/.config/kino/kino-author-key.pem, or $KINO_AUTHOR_KEY)
```

Try it by hand with the kit (it reaches the real Google News):

```sh
node sdk/run.mjs --device phone . job refresh
node sdk/run.mjs --device tv . screen
node sdk/run.mjs . shared
```

A new version: sync (or change the code), raise `version` in `kino-plugin.json`, add a `CHANGELOG.md` entry, `npm test`,
`npm run sign`, `npm run validate`, commit and push. Every change to `plugin.js` or to `version` needs a new signature,
always with the same key: Kino refuses an update signed by another one.

## How it works

<!-- sync:begin example-readme -->
_Synced by `scripts/sync-from-example.mjs` from `docs/plugins/examples/screen-news` in Kino's repository at `aef850c1e`. Do not edit by hand: change the example and sync again._

### Where the news come from

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
  read). On a TV the tab strip keeps Left and Right inside itself, so there the tabs are a row of buttons with the same
  `pickTab` event and Left/Right go tab, tab, refresh. A small margin and a divider sit under the header, which stays
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
<!-- sync:end example-readme -->
