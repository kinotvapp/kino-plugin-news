// The background job Kino schedules (runOn preferPhone): one `step` within the device's budget.

import { askAi } from "../categories/categories.js";
import { budgetFor } from "../limits.js";
import { cacheOf, deviceKind, readWatched, realClock, stored } from "../state/load.js";
import { step } from "../work/step.js";

/**
 * Kino's scheduled job (manifest "jobs", capability "schedule", runOn "preferPhone"): one `step` with this device's budget
 * (a TV that runs it because no phone is linked takes the lighter one), the watched titles read fresh when the person uses
 * them, and the AI when they turned it on. What it finds goes to kino.shared, which the screen reads when it opens. Kino
 * never reads what it returns.
 */
export async function job(ctx) {
  const s = stored(kino.lang);
  if (s.useLibrary) {
    const w = await readWatched();
    s.titles = w.titles;
  }
  const r = await step(cacheOf(), kino.fetch, s, realClock, budgetFor(deviceKind()), s.useAi ? askAi : null);
  console.log("job " + (ctx && ctx.id) + " (" + (ctx && ctx.reason) + "): " + r.fetches + " requests, " + Math.round(r.bytes / 1024) + " KB, " + r.stories.length + " stories, done " + JSON.stringify(r.done));
}
