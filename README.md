# Solo noticias (Just News)

[Español](README.es.md) · [For developers](DEVELOPERS.md)

<img src="icon.png" width="96" alt="Just News icon" align="right">

A [Kino](https://github.com/kinotvapp/kino-light) plugin that adds a **news screen**: news about the movies and series you
watched and about your own topics, as a grid of cards, on your phone and on your TV. It reads the free
[Google News](https://news.google.com) feeds straight from your device: no account, no key, no server in between.

- **Your topics**: type the terms you care about (a saga, an actor, a festival). With **Use what I watched** on, the
  titles you watched most recently in Kino are added too.
- **Cards** with the picture, the outlet, how long ago, the headline and why it is there ("Because you watched
  “Avatar”"). Tap one to read an extract of the story, and **Open story** to read all of it in your browser (on a TV,
  a QR code takes it to your phone).
- **Categories** as tabs over the cards, guessed on your device, or sorted by Kino's text AI if you turn that on.
- **Optional automatic refresh** in the background, so the news are ready when you open the screen. Linked devices
  share the result: your phone does the work and your TV just shows it.
- **Refresh by hand** with the circular arrow at any time.

Unofficial: not affiliated with Google. Google News is only read, as a personal feed reader on your own device.

## Screenshots

<!-- To add before publishing, in screenshots/:
  1-news-phone.jpg       the News tab on a phone, with the category tabs
  2-story-phone.jpg      a story open in its pop-up
  3-settings-phone.jpg   the Settings tab
  4-news-tv.jpg          the News tab on a TV
  5-story-tv.jpg         a story on a TV, with its QR code
-->
_Coming soon._

## Install

It needs a Kino version with plugin screens (plugin `apiVersion` 14); an older Kino says "This plugin needs a newer
version of Kino".

1. On the phone, open **Menu ▸ Plugins** and tap **+** (Add plugin). On the TV, open **Plugins** and choose **Add
   plugin**.
2. Leave the type on **Kino**. In **Plugin address**, type `kinotvapp/kino-plugin-news` and tap **Add**.
3. Kino shows **Install Solo noticias**. Tap **See details**, read the lines (they are explained below), then **Install**.
4. **News** appears in Kino's menu (the phone's Home strip, the TV's side bar). Open it.

The plugin is **signed by its author** ("Signed by its author" on the install sheet): Kino checks that every update is
signed with the same key.

## Permissions, in plain words

What Kino shows when you install, and what each line means here:

| Kino says | What it means for this plugin |
| --- | --- |
| **Connects to: news.google.com** | It reads the Google News feeds (RSS) for your topics. |
| **Can connect to any public server on the internet (https only, never your home network)** (in red) | News come from many outlets. To show a story's picture and text, your device opens that story's page on the outlet's site. Only with **Pictures and texts from the outlets** on (on by default); with it off, the plugin only talks to Google News. Never your home network. |
| **Can read what you have watched and saved in Kino, and send it to its services** (in red) | Only with **Use what I watched** on (off by default): the titles you watched most recently (5 by default, up to 50) are sent to Google News **as search terms**. Nothing else from your history leaves your device, and never an 18+ title. You can also switch it off in Settings: **Let it read what I watched and saved**. |
| **Can run in the background every so often to refresh its data, using your internet and battery** (in red) | The automatic refresh. It starts **off**: turn it on in Kino's Settings ▸ News and choose how often (15 minutes to once a day; Wi-Fi only by default). |
| **Can send text to a third-party AI service (Kilo) to have it summarized or classified; what it sends leaves your device** (in red) | Only with **Sort with AI** on (off by default): the **headlines** (the headline text and an id, nothing else) go to Kino's text AI to pick their category. Never your history or your terms. With it off, the categories are guessed on your device. |
| **Keeps a few small results that sync between your linked devices** | The latest news are shared between your own linked devices (only your profile), so the TV does not repeat the phone's work. |

Each red permission can be switched off later in the plugin's tab in Kino's Settings, without uninstalling.

## Settings

On the screen's **Settings** tab (every change is saved at once):

- **Pictures and texts from the outlets** (on): pictures and descriptions from the outlets' pages. Off: headlines only,
  and no connection to the outlets.
- **Sort with AI** (off), and **Sort now** to sort the current news right away.
- **Use what I watched** (on) and **Recent titles** (1 to 50): your recently watched titles become topics. They show as
  rows you can remove one by one.
- **Your terms**: add or remove your own topics (up to 50 in all, 40 characters each).

How often the news refresh by themselves is not on this screen: it is the job's row in Kino's **Settings ▸ News**.

## The automatic refresh

- One job, **Refresh the news**, every 60 minutes by default (15 min, 30 min, 1 h, 3 h, 12 h or 24 h).
- It is **off** until you turn it on, and Kino keeps it to Wi-Fi unless you change that.
- With a phone and a TV linked, the phone does it and the TV reads the result; a TV on its own does it itself, with a
  lighter load.
- Each run is small: a few requests, under 2 MB, and it stops when its time is up. The next run continues where it
  stopped.
- Without it, the screen refreshes what is old when you open it, and the arrow refreshes by hand (at most once every
  30 seconds).

## Privacy

- **No account and no server of ours.** Everything runs inside Kino, on your device.
- **Google News** receives your search terms: your own terms and, only with **Use what I watched** on, the titles you
  watched recently. Google sees them like any search from your connection.
- **Outlets**: with **Pictures and texts from the outlets** on, your device opens the pages of the stories in your feed
  (to read their picture and description) and of a story you open (to read its text). The outlets see that like any web
  visit.
- **AI**: off by default. On, only headlines are sent.
- **Linked devices**: the news (headlines, outlets, links, categories) and the titles you removed sync between your own
  devices through Kino's sync. Never a password or a token.
- Removing the plugin deletes what it kept.

## About Google News

The plugin reads Google News' public RSS feeds as a personal feed reader, which is the use Google's terms allow for
them. It shows the headline, the outlet and a short extract, and always links to the outlet's own page for the full
story. Turning Google's newer story links into the outlet's address uses the same requests Google's own page makes:
that is unofficial and may stop working, and then **Open story** keeps Google's link.

## Troubleshooting

- **"Offline" next to the time**: the last refresh could not read Google News. Check your connection and tap the arrow;
  the stored news stay meanwhile.
- **"Wait a moment: you just refreshed"**: you refreshed less than 30 seconds ago.
- **No pictures**: **Pictures and texts from the outlets** is off, or the outlet has none; the card then shows the
  outlet's initial.
- **Nothing here**: you have no terms and **Use what I watched** is off (or your history is empty). The plugin reads
  nothing then, never Google's front page and never sample stories: add a term, or watch something.
- **The categories never change**: **Sort with AI** is off, or Kino's AI is unavailable or switched off in the plugin's
  tab in Settings (**Let it use the text AI**); the on-device guesses stay.
- **The background refresh never runs**: turn the job on in Settings ▸ News, and check **Let it work in the background**
  and the Wi-Fi-only switch there.
- **The extract is short or cut**: it is read from the outlet's page and can be partial (paywalls). **Open story** opens
  the whole story.

## How the code is organized

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
  ui/              format.js, cards.js, story-popup.js, news-tab.js, settings-tab.js, header.js
  exports/         job.js (`job`), screen.js (`screen`), screen-event.js (`screenEvent`)
```

Imports only go one way (util and limits, then the pure readers, then work and state, then ui, then exports): there is
no import cycle. Each file starts with a comment that says what it owns.

```sh
npm install          # once: esbuild
npm run build        # src/ -> plugin.js (never edit plugin.js by hand)
npm run check:built  # plugin.js is exactly what src/ builds to
npm test             # the built plugin.js in the kit's sandbox, and the check above
npm run validate     # what Kino would say at install
npm run sign         # after every build that changed plugin.js (the author key, never in this repository)
```

The full workflow is in [DEVELOPERS.md](DEVELOPERS.md).

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE).

Repository: [kinotvapp/kino-plugin-news](https://github.com/kinotvapp/kino-plugin-news)
(remote `git@github.com-kinotvapp:kinotvapp/kino-plugin-news.git`).
