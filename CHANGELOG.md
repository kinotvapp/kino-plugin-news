# Changelog

## 1.0.3

- The news are only about what you watch and your own topics. With no topic and nothing watched, the plugin reads nothing and
  shows an empty state: it no longer asks Google News for its front page (politics and everything else).
- **Use what I watched** is on by default.
- Never sample stories: when Google News cannot be reached and nothing is stored, you get the error banner and an empty state.
- The «Actualizado hace …» caption in the header is gone (the refresh icon stays).

## 1.0.2

- `plugin.js` is now generated from `src/`, same behaviour: the code is split into small files by responsibility under `src/` and `npm run build` (esbuild) bundles them into the one file Kino installs. `npm run check:built` proves the shipped file is built from the source.

## 1.0.1

- **Hide 18+ news** is now locked with Kino's parental control code: switching it off asks for the code (Kino's own
  prompt, on the phone and on the TV); switching it back on never does. The plugin never sees the code. The switch is
  drawn by Kino's settings form inside Settings, and News reloads when you come back with the filter changed.
- Needs Kino 0.9.74 or newer (plugin `apiVersion` 14).

## 1.0.0

The first public version (Kino plugin `apiVersion` 14).

- A **News** screen of its own, on the phone and on the TV: a Google News feed about the movies and series you watched
  (with **Use what I watched** on) and about your own terms, as cards with the picture, the outlet, the time, the
  headline and why it is there.
- Category tabs with their counts, guessed on the device or sorted by Kino's text AI (**Sort with AI**, off by default).
- A story opens in a pop-up with an extract of the outlet's page and **Open story** (a QR code on the TV).
- An optional background job, **Refresh the news** (every 60 minutes by default, 15 minutes to 24 hours, off until you
  turn it on), whose result syncs between your linked devices (`kino.shared`): the phone works, the TV shows.
- Refresh by hand, with an "Updated 12 min ago" / "Offline" line.
- Signed by its author.
