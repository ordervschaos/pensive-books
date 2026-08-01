/**
 * Smoke test for the network-only source adapters.
 *
 *   npx tsx apps/digest/scripts/smoke-sources.ts            # everything cheap
 *   npx tsx apps/digest/scripts/smoke-sources.ts video      # one adapter
 *
 * WHY THIS EXISTS: `ranked` and `video` talk to five third-party APIs whose response shapes are the thing
 * most likely to break, and none of them need a database, a session, or a model — so they can be exercised
 * directly, in seconds, without touching the pipeline or spending a token. Every other adapter reads
 * Supabase and belongs to the preview loop instead (`/api/digests/:id/preview`).
 *
 * It asserts nothing. The output IS the assertion: you are looking for a plausible title, a real url, and a
 * score that isn't zero. A shape change shows up here as an empty list long before it shows up as a
 * mysteriously short issue on a Tuesday morning.
 */
import { rankedAdapter } from "../lib/digest/sources/ranked";
import { videoAdapter } from "../lib/digest/sources/video";
import type { Item, RunCtx, Section } from "../lib/digest/types";

// A context with no memory and no database: nothing has been delivered, nothing is cached.
const ctx: RunCtx = {
  digest: {
    id: 0,
    owner_id: "smoke",
    name: "smoke",
    timezone: "UTC",
    deliver_at: "06:00",
    active: true,
    voice: null,
    web_search_enabled: false,
    sections: [],
    delivery: {},
  },
  issueDate: new Date().toISOString().slice(0, 10),
  seen: () => false,
  cachedBody: () => undefined,
};

const CASES: Record<string, Section> = {
  hn: { id: "hn", kind: "ranked", title: "HN", source: "hn", min_score: 150, max_items: 3, fetch_body: false },
  arxiv: {
    id: "arxiv",
    kind: "ranked",
    title: "arXiv",
    source: "arxiv",
    targets: ["cs.CL"],
    max_items: 3,
    days: 5,
  },
  lobsters: { id: "lob", kind: "ranked", title: "Lobsters", source: "lobsters", max_items: 3, fetch_body: false },
  github: {
    id: "gh",
    kind: "ranked",
    title: "GitHub",
    source: "github",
    targets: ["vercel/next.js"],
    max_items: 2,
    days: 60,
  },
  reddit: {
    id: "rd",
    kind: "ranked",
    title: "Reddit",
    source: "reddit",
    targets: ["writing"],
    max_items: 3,
    fetch_body: false,
  },
  video: {
    id: "vid",
    kind: "video",
    title: "Video",
    channels: ["https://www.youtube.com/channel/UCHnyfMqiRRG1u-2MsSQLbXA"],
    max_items: 1,
    days: 30,
  },
};

function preview(items: Item[]): void {
  if (!items.length) {
    console.log("  (nothing — either the window is empty or the shape changed)");
    return;
  }
  for (const i of items) {
    console.log(`  · [${i.score ?? "-"}] ${i.title.slice(0, 70)}`);
    console.log(`      ${i.source ?? "?"} · ${i.url}`);
    console.log(`      ${i.text.replace(/\s+/g, " ").slice(0, 140)}…  (${i.text.length} chars)`);
  }
}

async function main() {
  const only = process.argv.slice(2);
  const names = only.length ? only : Object.keys(CASES);

  for (const name of names) {
    const section = CASES[name];
    if (!section) {
      console.log(`\n${name}: unknown case`);
      continue;
    }
    const started = Date.now();
    console.log(`\n── ${name} ${"─".repeat(Math.max(0, 50 - name.length))}`);
    try {
      const run = section.kind === "video" ? videoAdapter : rankedAdapter;
      preview(await run(section, ctx));
    } catch (e) {
      console.log(`  FAILED: ${(e as Error).message}`);
    }
    console.log(`  ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
}

void main();
