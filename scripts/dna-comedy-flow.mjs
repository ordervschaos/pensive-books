// dna-comedy-flow — drive a full COMEDY short story through the Novel DNA pipeline end-to-end, one level
// deeper than dna-flow-test.mjs: it also runs the "contract" step (W1, compile-the-brief — genre tentpoles +
// seeded meters + voice register bounds) before the rest of the ladder, and renders FULL prose for every
// scene (not just the first 3). One-off analysis run, not a generic harness — reuses dna-flow-test.mjs's
// helpers via DNA_NO_MAIN=1 the same way dna-upgrade.mjs does.
//
// The "contract" target isn't implemented in eval-bridge.mjs's runDnaExpand (only logline/prose/beatsheet get
// dedicated branches there — see supabase/functions/dna-expand/index.ts:862 for the real one), and per
// standing project guidance eval-bridge is a special-case dev tool that should NOT be kept in lockstep with
// every edge-fn feature. So this script's contract step is hand-compiled here (below, CONTRACT_OUTPUT),
// following the exact schema and instructions of the real target==="contract" prompt, then persisted the same
// way dnaExpand.ts's persistContract() would (tentpole + meter book_nodes under the pillar, a voice_profile
// node carrying the register bounds) — so every downstream step (acts/threads/beatsheet/scenes) reads real,
// accepted tentpoles/meters exactly as production would.
//
//   node scripts/dna-comedy-flow.mjs
process.env.DNA_BRIDGE_NO_LISTEN = "1";
process.env.DNA_NO_MAIN = "1";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { expand, persistBeatSheet, loadNodes, insertNodes, rest, newId, log, TREE } from "./dna-flow-test.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OWNER = "91f66fef-e7f0-455d-833e-080fd65d8aed"; // dev user (book 1171's owner), same as dna-flow-test.mjs

const BRIEF = {
  scope: { band: "short", word_target: 6000 },
  genre: "comedy",
  idea: "A by-the-book noise-complaint inspector is sent to shut down a retirement home's illegal 'silent disco' after neighbors report a full-volume party heard from the street — but every resident she interviews swears there was no music at all, and the only person who can hear it is her.",
  tone: ["deadpan", "escalating", "warm"],
  content_type: { level: "closed", note: "" },
  success_criteria: "the reader laughs at the inspector's spiraling paranoia, and the reveal of the 'noise' lands as sweet rather than gimmicky.",
};

// Hand-compiled "contract" output — the analyst (me) playing the target==="contract" prompt's role for this
// one premise: 3-6 obligatory comedy tentpoles, 1-3 seeded meters with target curves, 2-5 voice constraints.
// Schema matches supabase/functions/dna-expand/index.ts:883 exactly.
const CONTRACT_OUTPUT = {
  tentpoles: [
    { summary: "The complaint lands and no resident will admit to hearing anything — the mystery-as-farce engine starts turning." },
    { summary: "A public, humiliating scene where the inspector's insistence that there IS music makes her look unhinged in front of witnesses." },
    { summary: "Her own by-the-book procedure backfires — the more rigorously she investigates, the more absurd the situation becomes." },
    { summary: "The reveal: the 'disco' is real, but its true nature reframes the whole chase as sweet, not a gotcha at her expense." },
  ],
  meters: [
    {
      name: "Comic Escalation", kind: "comedy",
      poles: { low: "dry procedural calm", high: "full absurdist farce" },
      scale: { min: 0, max: 100 },
      target: [{ at: 0, value: 15 }, { at: 0.25, value: 35 }, { at: 0.5, value: 55 }, { at: 0.75, value: 80 }, { at: 1, value: 60 }],
    },
    {
      name: "Professional Composure", kind: "value",
      poles: { low: "rattled, out of her depth", high: "in full control, procedural" },
      scale: { min: 0, max: 100 },
      target: [{ at: 0, value: 90 }, { at: 0.4, value: 40 }, { at: 0.7, value: 15 }, { at: 1, value: 55 }],
    },
  ],
  voice_constraints: [
    "Keep the narration DEADPAN even when events are absurd — humor comes from dry procedural language colliding with escalating chaos, never from the narrator winking at the reader.",
    "No slapstick set-piece longer than a paragraph — the comedy is situational and verbal, not visual-gag-driven.",
    "Retirement-home residents are never the butt of jokes about aging itself — the humor targets the inspector's rigidity and the situation, not the residents.",
    "Keep the inspector's POV sentences short and clipped; let prose loosen and warm when residents speak, for contrast.",
  ],
};

async function persistContract(bookId, pillar) {
  log(`  contract (hand-compiled) → pillar#${pillar.id} …`);
  const tentpoleRows = CONTRACT_OUTPUT.tentpoles.map((t) => ({
    id: newId(), book_id: bookId, parent_id: pillar.id, level: 2, kind: "tentpole",
    position: 0, content: t, authoring: { source: "ai", locked: false, status: "accepted" },
  }));
  const meterRows = CONTRACT_OUTPUT.meters.map((m) => ({
    id: newId(), book_id: bookId, parent_id: pillar.id, level: 2, kind: "meter",
    position: 0, content: m, authoring: { source: "ai", locked: false, status: "accepted" },
  }));
  const voiceProfileRow = {
    id: newId(), book_id: bookId, parent_id: pillar.id, level: 2, kind: "voice_profile",
    position: 0, content: { constraints: CONTRACT_OUTPUT.voice_constraints },
    authoring: { source: "ai", locked: false, status: "accepted" },
  };
  await insertNodes([...tentpoleRows, ...meterRows, voiceProfileRow]);
  log(`    ✓ contract: ${tentpoleRows.length} tentpoles, ${meterRows.length} meters, 1 voice_profile`);
}

async function getOrCreateBook() {
  const r = await rest("books", { method: "POST", body: JSON.stringify({ name: "DNA comedy test (silent disco)", owner_id: OWNER, brief: BRIEF, is_public: false }) });
  const b = await r.json();
  if (!Array.isArray(b) || !b[0]) throw new Error("create book failed: " + JSON.stringify(b));
  log(`created book ${b[0].id} "${b[0].name}"`);
  return b[0].id;
}

async function main() {
  const bookId = await getOrCreateBook();

  // (0) seed
  const seed = { id: newId(), book_id: bookId, parent_id: null, level: 0, kind: "seed", position: 0,
    content: { logline: "A by-the-book noise-complaint inspector hunts a retirement home's 'silent disco' that only she can hear." },
    authoring: { source: "user", locked: true, status: "accepted" } };
  await insertNodes([seed]);
  log(`seeded logline`);

  // (1) seed → premise
  const [premise] = await expand(bookId, seed, "premise");
  // (2) premise → pillar
  const [pillar] = await expand(bookId, premise, "pillar");
  // (3) COMPILE THE BRIEF — contract step (before cast/world/acts, per dna-journey.ts STEP_RECIPE ordering)
  await persistContract(bookId, pillar);
  // (4) pillar → foundations registry: cast, world, relationships
  await expand(bookId, pillar, "cast");
  await expand(bookId, pillar, "world");
  await expand(bookId, pillar, "relationships");
  // (5) pillar → acts (BEFORE threads, so threads see the whole arc)
  const acts = await expand(bookId, pillar, "acts");
  // (6) pillar → threads (reads the acts just made)
  await expand(bookId, pillar, "threads");
  // (7) GLOBAL beat sheet
  const allBeats = await expand(bookId, pillar, "beatsheet");
  const mPos = new Map(acts.map((m, i) => [m.id, i]));
  allBeats.sort((a, b) => (mPos.get(a.parent_id) - mPos.get(b.parent_id)) || (a.position - b.position));
  // (8) each beat → scenes
  const allScenes = [];
  for (const b of allBeats) allScenes.push(...await expand(bookId, b, "scenes"));

  // (9) FULL prose — every scene (this is a short story; the whole point is a complete, readable book)
  for (const s of allScenes) await expand(bookId, s, "prose");

  const nodes = await loadNodes(bookId);
  writeFileSync(TREE, JSON.stringify({ bookId, brief: BRIEF, nodes }, null, 2));
  const counts = {}; for (const n of nodes) counts[n.kind] = (counts[n.kind] || 0) + 1;
  log(`DONE. book ${bookId}. nodes: ${JSON.stringify(counts)}`);
  log(`tree dumped → ${TREE}`);
}

main().catch((e) => { log(`FATAL: ${e.message}\n${e.stack}`); process.exit(1); });
