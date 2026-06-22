// dna-flow-test — drive the whole Novel DNA flow (brief → structural tree) through the dev bridge's own
// runDnaExpand, persisting each rung via the service role, then dump the tree for evaluation by the real
// engine. This is the "go through the flow using bridge calls" end-to-end check. STRUCTURAL only (no prose
// by default — prose is the bulk and the three analytic axes don't need it). Set DNA_WITH_PROSE=1 to also
// write prose for the first chapter's scenes.
//
//   node scripts/dna-flow-test.mjs            # fresh book, full structural ladder
//   DNA_BOOK_ID=1234 node scripts/dna-flow-test.mjs   # reuse/continue an existing test book
//
// Progress is appended to scripts/.dna-flow.log; the final tree is written to scripts/.dna-flow-tree.json.
process.env.DNA_BRIDGE_NO_LISTEN = "1"; // import the bridge run-fns without binding the port
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runDnaExpand, SUPABASE_URL, sbHeaders } from "./eval-bridge.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const LOG = join(here, ".dna-flow.log");
const TREE = join(here, ".dna-flow-tree.json");
const log = (m) => { const line = `[${new Date().toISOString()}] ${m}`; console.log(line); appendFileSync(LOG, line + "\n"); };

const env = Object.fromEntries(readFileSync(join(here, "..", ".env.local"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const OWNER = "91f66fef-e7f0-455d-833e-080fd65d8aed"; // book 1171's owner (the dev user)

// The brief I walk in the design review: a fair-play thriller with a ticking clock.
const BRIEF = {
  scope: { band: "novel", word_target: 80000 },
  genre: "thriller / mystery",
  premise: "A small-town coroner finds her own signature on a death certificate for a man who is still alive — dated eleven days from today.",
  tone: ["dread", "propulsive"],
  content_type: { level: "closed", note: "" },
  success_criteria: "the reader re-reads chapter 1 after the ending; every clue was fair.",
};

const rest = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=representation", ...(opts.headers || {}) } });
const newId = () => `n_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
const wordCount = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);

async function getOrCreateBook() {
  if (env.DNA_BOOK_ID || process.env.DNA_BOOK_ID) {
    const id = Number(process.env.DNA_BOOK_ID || env.DNA_BOOK_ID);
    log(`reusing book ${id}`);
    return id;
  }
  const r = await rest("books", { method: "POST", body: JSON.stringify({ name: "DNA flow test (coroner)", owner_id: OWNER, brief: BRIEF, is_public: false }) });
  const b = await r.json();
  if (!Array.isArray(b) || !b[0]) throw new Error("create book failed: " + JSON.stringify(b));
  log(`created book ${b[0].id} "${b[0].name}"`);
  return b[0].id;
}

async function loadNodes(bookId) {
  const r = await rest(`book_nodes?book_id=eq.${bookId}&select=id,parent_id,kind,level,position,content,authoring,proposals,chosen`);
  return r.json();
}

async function insertNodes(rows) {
  if (!rows.length) return;
  const r = await rest("book_nodes", { method: "POST", body: JSON.stringify(rows) });
  if (!r.ok) throw new Error("insert failed: " + (await r.text()));
}

const chapterTitle = (sum) => sum ? sum.split(/[—–.;:]/)[0].trim().split(/\s+/).slice(0, 7).join(" ").replace(/^./, (c) => c.toUpperCase()) : "Untitled";

// Mirror dnaExpand.ts: call the bridge expand, persist the result as accepted ai nodes.
async function expand(bookId, node, target, startPosition = 0) {
  log(`  expand ${node.kind}#${node.id} → ${target} …`);
  const res = await runDnaExpand({ bookId, nodeId: node.id, target });
  if (res.error) throw new Error(`expand ${target} failed: ${res.error}`);
  if (target === "prose") {
    const text = (res.prose || "").trim();
    if (!text) throw new Error("no prose generated");
    await rest(`book_nodes?id=eq.${node.id}`, { method: "PATCH", body: JSON.stringify({ content: { ...node.content, prose: { text, words: wordCount(text) } }, authoring: { ...node.authoring, source: "ai", status: "accepted" } }) });
    log(`    ✓ prose ${wordCount(text)} words`);
    return [];
  }
  if (res.beatsheet) return persistBeatSheet(bookId, res);

  const children = (res.children || []).map((content, i) => ({
    id: newId(), book_id: bookId, parent_id: node.id,
    level: res.childLevel ?? (node.level + 1), kind: res.childKind ?? "scene",
    position: startPosition + i, content,
    authoring: { source: "ai", locked: false, status: "accepted" },
  }));
  // Scenes REALIZE their beat (root fix): inherit the beat's polarity + thread schedule, don't re-invent.
  if ((res.childKind ?? "scene") === "scene" && node.kind === "beat") {
    const beat = node.content || {};
    for (const s of children) {
      if (beat.polarity && s.content.value_shift && !s.content.value_shift.polarity) s.content.value_shift.polarity = beat.polarity;
    }
    if (children[0] && Array.isArray(beat.threads) && beat.threads.length) children[0].content.threads = beat.threads;
    (Array.isArray(beat.realizes) ? beat.realizes : []).forEach((tpId, i) => { const s = children[i] ?? children[children.length - 1]; if (s) s.content.realizes_tentpole = tpId; });
    if (startPosition === 0 && children[0] && !children[0].content.chapter_start) children[0].content.chapter_start = { title: chapterTitle(String(beat.summary ?? "")) };
  }
  await insertNodes(children);
  log(`    ✓ ${children.length} ${res.childKind}(s)`);
  return children;
}

// Persist the global beat sheet: flat movement-indexed list → beats grouped under each movement.
async function persistBeatSheet(bookId, res) {
  const movementIds = res.movementIds || [];
  const entries = res.beats || [];
  const posByMovement = {};
  const beats = entries.map((e) => {
    const parent_id = movementIds[e.movement] ?? movementIds[0];
    const position = (posByMovement[parent_id] = (posByMovement[parent_id] ?? 0) + 1) - 1;
    return { id: newId(), book_id: bookId, parent_id, level: res.childLevel ?? 4, kind: "beat", position, content: e.content, authoring: { source: "ai", locked: false, status: "accepted" } };
  });
  await insertNodes(beats);
  log(`    ✓ beat sheet: ${beats.length} beats across ${movementIds.length} movements`);
  return beats;
}

async function main() {
  writeFileSync(LOG, ""); // fresh log
  const bookId = await getOrCreateBook();
  let nodes = await loadNodes(bookId);

  // (0) seed — minted directly (the human's logline); everything else is generated.
  let seed = nodes.find((n) => n.kind === "seed");
  if (!seed) {
    seed = { id: newId(), book_id: bookId, parent_id: null, level: 0, kind: "seed", position: 0,
      content: { logline: "A small-town coroner finds her own signature on the death certificate of a man who is still alive — dated eleven days from today." },
      authoring: { source: "user", locked: true, status: "accepted" } };
    await insertNodes([seed]);
    log(`seeded logline`);
  }

  // (1) seed → premise
  let [premise] = await expand(bookId, seed, "premise");
  // (2) premise → pillar
  let [pillar] = await expand(bookId, premise, "pillar");
  // (3) pillar → foundations registry: cast, world, relationships (relationships read cast)
  await expand(bookId, pillar, "cast");
  await expand(bookId, pillar, "world");
  await expand(bookId, pillar, "relationships");
  // (4) pillar → movements  (BEFORE threads, so threads see the whole arc)
  const movements = await expand(bookId, pillar, "movements");
  // (5) pillar → threads  (reads the movements just made)
  await expand(bookId, pillar, "threads");
  // (6) GLOBAL beat sheet — one pass over the whole arc (root fix): schedules setup→payoff in order + plans
  //     polarity to oscillate. Reload pillar with fresh content (it parents movements + threads).
  const allBeats = await expand(bookId, pillar, "beatsheet");
  // order beats by movement position then beat position for scene generation
  const mPos = new Map(movements.map((m, i) => [m.id, i]));
  allBeats.sort((a, b) => (mPos.get(a.parent_id) - mPos.get(b.parent_id)) || (a.position - b.position));
  // (7) each beat → scenes (scenes inherit the beat's polarity + thread schedule)
  const allScenes = [];
  for (const b of allBeats) allScenes.push(...await expand(bookId, b, "scenes"));

  // (8) optional prose — only the first chapter's worth (first 3 scenes) to keep it cheap
  if (process.env.DNA_WITH_PROSE) {
    for (const s of allScenes.slice(0, 3)) await expand(bookId, s, "prose");
  }

  nodes = await loadNodes(bookId);
  writeFileSync(TREE, JSON.stringify({ bookId, brief: BRIEF, nodes }, null, 2));
  const counts = {}; for (const n of nodes) counts[n.kind] = (counts[n.kind] || 0) + 1;
  log(`DONE. book ${bookId}. nodes: ${JSON.stringify(counts)}`);
  log(`tree dumped → ${TREE}`);
}

// Reusable by scripts/dna-upgrade.mjs (upgrade an EXISTING book's structure in place). Set DNA_NO_MAIN=1 to
// import the helpers without running the fresh-book flow.
export { expand, persistBeatSheet, loadNodes, insertNodes, rest, newId, log, TREE };
if (!process.env.DNA_NO_MAIN) main().catch((e) => { log(`FATAL: ${e.message}`); process.exit(1); });
