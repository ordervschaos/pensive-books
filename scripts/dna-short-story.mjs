// dna-short-story — drive a COMPLETE short story down the whole Novel DNA ladder, headless (no UI), via the
// dev bridge's runDnaExpand (which routes AI to a free `claude -p`). Unlike dna-flow-test (structural only),
// this fills in EVERYTHING: premise → pillar → cast/world/relationships/set-pieces/voice/games → meters
// (game-twins + shape) → acts → threads → global beat sheet → scenes → PROSE for every scene. Then run
// scripts/dna-short-story-eval.mjs to grade it (real lints + observed meters + editor's read).
//
//   node scripts/dna-short-story.mjs                 # fresh book, full ladder + prose
//   DNA_BOOK_ID=1234 node scripts/dna-short-story.mjs  # continue an existing book
//   DNA_NO_PROSE=1 node scripts/dna-short-story.mjs   # structure only, skip prose
//
// Progress → scripts/.dna-short.log ; final tree → scripts/.dna-short-tree.json
process.env.DNA_BRIDGE_NO_LISTEN = "1"; // import bridge run-fns without binding the port
process.env.DNA_NO_MAIN = "1";          // import flow-test helpers without running its own flow
import { writeFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// DYNAMIC import (not static): ESM hoists static imports and evaluates the module BEFORE this file's
// top-level env assignments run — which would fire dna-flow-test's own main() on import. Importing at call
// time, after DNA_NO_MAIN is set above, keeps its flow dormant and gives us only its helpers.
const { expand, loadNodes, insertNodes, rest, newId } = await import("./dna-flow-test.mjs");

const here = dirname(fileURLToPath(import.meta.url));
const LOG = join(here, ".dna-short.log");
const TREE = join(here, ".dna-short-tree.json");
const log = (m) => { const line = `[${new Date().toISOString()}] ${m}`; console.log(line); appendFileSync(LOG, line + "\n"); };
const OWNER = "91f66fef-e7f0-455d-833e-080fd65d8aed"; // the dev user (book 1171's owner)

// The short story: a closed-door speculative/psychological piece with a hard genre promise (the machine
// answers something it shouldn't be able to) and a real dramatic question (does she let the dead stay dead).
const BRIEF = {
  scope: { band: "short", word_target: 5000 },
  genre: "speculative / psychological",
  idea: "A grief counsellor feeds her dead husband's texts into a chatbot to say a proper goodbye — and it starts answering with things he never told her while he was alive.",
  tone: ["intimate", "unnerving"],
  content_type: { level: "closed", note: "" },
  success_criteria: "the reader can't tell if the machine is haunted or she is; the last line re-frames the whole story.",
};

// Shape meters (non-game): the plottable axes the prose is later measured against. In prod these ride the
// brief `contract` compile; the bridge doesn't do contract, so we mint them here as derived instruments with
// an explicit target curve (0..1 of the reading order → value on scale) so target_drift / read lints can bite.
const SHAPE_METERS = [
  { name: "dread", kind: "tension", scale: { min: 0, max: 100 },
    poles: { low: "domestic calm", high: "the machine knows too much" },
    target: [{ at: 0.10, value: 20 }, { at: 0.50, value: 55 }, { at: 0.75, value: 80 }, { at: 0.95, value: 95 }] },
  { name: "the question", kind: "mystery", scale: { min: 0, max: 100 },
    poles: { low: "settled", high: "who is really answering" },
    target: [{ at: 0.10, value: 30 }, { at: 0.50, value: 70 }, { at: 0.85, value: 90 }, { at: 1.00, value: 20 }] },
];

const wordCount = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);

// Mirror novelDna.gameTwins: every game carries a game_score meter + a resolution thread. expandNode does
// this via reconcileGameTwins; the bridge doesn't, so we mint the twins for the games we just generated.
function gameTwins(game) {
  const g = game.content || {};
  const name = (g.name || "").trim() || "the contest";
  return {
    meter: { name: `${name} — score`, kind: "game_score", owner: game.id, poles: { low: g.lose_condition, high: g.win_condition } },
    thread: { name: `${name} — resolution`, kind: "setup_payoff", owner: game.id,
      promise: g.stake ? `${name} is joined; ${g.stake} is on the line.` : `${name} is joined and must be decided.`,
      payoff: g.win_condition ? `${name} resolves: ${g.win_condition} — or it is lost.` : `${name} resolves, won or lost.` },
  };
}

async function getOrCreateBook() {
  const existing = process.env.DNA_BOOK_ID;
  if (existing) { log(`reusing book ${existing}`); return Number(existing); }
  const r = await rest("books", { method: "POST", body: JSON.stringify({ name: "DNA short story (the goodbye machine)", owner_id: OWNER, brief: BRIEF, is_public: false }) });
  const b = await r.json();
  if (!Array.isArray(b) || !b[0]) throw new Error("create book failed: " + JSON.stringify(b));
  log(`created book ${b[0].id} "${b[0].name}"`);
  return b[0].id;
}

async function mintMeters(bookId, pillarId, rows) {
  const nodes = await loadNodes(bookId);
  let pos = nodes.filter((n) => n.kind === "meter" && n.parent_id === pillarId).length;
  const made = rows.map((content) => ({ id: newId(), book_id: bookId, parent_id: pillarId, level: 2, kind: "meter", position: pos++, content, authoring: { source: "ai", locked: false, status: "accepted" } }));
  await insertNodes(made);
  log(`    ✓ ${made.length} meter(s): ${made.map((m) => m.content.name).join(", ")}`);
  return made;
}
async function mintThreads(bookId, pillarId, rows) {
  const nodes = await loadNodes(bookId);
  let pos = nodes.filter((n) => n.kind === "thread" && n.parent_id === pillarId).length;
  const made = rows.map((content) => ({ id: newId(), book_id: bookId, parent_id: pillarId, level: 2, kind: "thread", position: pos++, content, authoring: { source: "ai", locked: false, status: "accepted" } }));
  await insertNodes(made);
  log(`    ✓ ${made.length} resolution thread(s)`);
  return made;
}

// Prose-only: skip the whole structural ladder, just write prose for every scene that lacks it (ordered by
// act→beat→scene). Idempotent — resumes where a prior prose run stopped. Use DNA_PROSE_ONLY=1 DNA_BOOK_ID=….
async function proseOnly(bookId) {
  const nodes = await loadNodes(bookId);
  const acts = nodes.filter((n) => n.kind === "act").sort((a, b) => a.position - b.position);
  const actPos = new Map(acts.map((a, i) => [a.id, i]));
  const beats = nodes.filter((n) => n.kind === "beat").sort((a, b) => (actPos.get(a.parent_id) - actPos.get(b.parent_id)) || (a.position - b.position));
  const beatPos = new Map(beats.map((b, i) => [b.id, i]));
  const scenes = nodes.filter((n) => n.kind === "scene").sort((a, b) => (beatPos.get(a.parent_id) - beatPos.get(b.parent_id)) || (a.position - b.position));
  const todo = scenes.filter((s) => !(s.content?.prose?.text));
  log(`prose-only: ${scenes.length} scenes, ${todo.length} still need prose`);
  let i = 0;
  for (const s of todo) { log(`  prose ${++i}/${todo.length} (scene ${s.id})`); await expand(bookId, s, "prose"); }
  const after = await loadNodes(bookId);
  const words = after.filter((n) => n.kind === "scene").reduce((a, n) => a + (n.content?.prose?.words || 0), 0);
  log(`DONE prose. book ${bookId}. total prose words: ${words}`);
}

async function main() {
  const bookId = process.env.DNA_BOOK_ID ? Number(process.env.DNA_BOOK_ID) : null;
  if (process.env.DNA_PROSE_ONLY) { if (!bookId) throw new Error("DNA_PROSE_ONLY needs DNA_BOOK_ID"); return proseOnly(bookId); }
  writeFileSync(LOG, "");
  const bookId2 = await getOrCreateBook();
  return buildFull(bookId2);
}

async function buildFull(bookId) {
  let nodes = await loadNodes(bookId);

  // (0) seed — the human's logline (the one hand-authored origin).
  let seed = nodes.find((n) => n.kind === "seed");
  if (!seed) {
    seed = { id: newId(), book_id: bookId, parent_id: null, level: 0, kind: "seed", position: 0,
      content: { logline: BRIEF.idea }, authoring: { source: "user", locked: true, status: "accepted" } };
    await insertNodes([seed]);
    log(`seeded logline`);
  }

  // (1) seed → premise ; (2) premise → pillar
  const [premise] = await expand(bookId, seed, "premise");
  const [pillar] = await expand(bookId, premise, "pillar");

  // (3) FOUNDATIONS registry (the materials the plot is forced to build from)
  await expand(bookId, pillar, "cast");            // protagonist + opposition/allies
  await expand(bookId, pillar, "world");           // operable rules (the machine's mechanism → no deus ex machina)
  await expand(bookId, pillar, "relationships");   // dyads (reads cast)
  await expand(bookId, pillar, "set-pieces");      // tentpoles — the must-happen moments (genre promise)
  await expand(bookId, pillar, "voice_profile");   // the prose signature governing every scene
  await expand(bookId, pillar, "games");           // the central contest (win/lose criteria)

  // (3b) METERS — game-twins (a game_score meter + resolution thread per game) + shape meters.
  nodes = await loadNodes(bookId);
  const games = nodes.filter((n) => n.kind === "game");
  if (games.length) {
    const twins = games.map(gameTwins);
    await mintMeters(bookId, pillar.id, twins.map((t) => t.meter));
    await mintThreads(bookId, pillar.id, twins.map((t) => t.thread));
  }
  await mintMeters(bookId, pillar.id, SHAPE_METERS);

  // (4) pillar → acts (BEFORE threads, so threads see the whole arc)
  const acts = await expand(bookId, pillar, "acts");
  // (5) pillar → threads (the promise registry — reads the acts)
  await expand(bookId, pillar, "threads");
  // (6) GLOBAL beat sheet — one causal pass over the whole arc (places tentpoles, plays/resolves games,
  //     grounds turns in world rules, schedules thread setup→payoff, mints needs/establishes state keys).
  const allBeats = await expand(bookId, pillar, "beatsheet");
  const mPos = new Map(acts.map((m, i) => [m.id, i]));
  allBeats.sort((a, b) => (mPos.get(a.parent_id) - mPos.get(b.parent_id)) || (a.position - b.position));

  // (7) each beat → scenes (scenes REALIZE the beat: inherit polarity, threads, realizes, needs/establishes)
  const allScenes = [];
  for (const b of allBeats) allScenes.push(...await expand(bookId, b, "scenes"));
  log(`structure complete: ${allBeats.length} beats → ${allScenes.length} scenes`);

  // (8) PROSE — the whole short story, every scene (this is the bulk; slowest step).
  if (!process.env.DNA_NO_PROSE) {
    let i = 0;
    for (const s of allScenes) { log(`  prose ${++i}/${allScenes.length}`); await expand(bookId, s, "prose"); }
  }

  nodes = await loadNodes(bookId);
  writeFileSync(TREE, JSON.stringify({ bookId, brief: BRIEF, nodes }, null, 2));
  const counts = {}; for (const n of nodes) counts[n.kind] = (counts[n.kind] || 0) + 1;
  const words = nodes.filter((n) => n.kind === "scene").reduce((a, n) => a + (n.content?.prose?.words || 0), 0);
  log(`DONE. book ${bookId}. nodes: ${JSON.stringify(counts)}. prose words: ${words}`);
  log(`tree → ${TREE}`);
}

main().catch((e) => { log(`FATAL: ${e.message}\n${e.stack}`); process.exit(1); });
