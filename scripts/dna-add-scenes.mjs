// Add scenes (and optionally prose) to a beat-sheet book. Phase 1: expand every beat with no scenes yet →
// scenes (with inheritance). Phase 2 (DNA_WITH_PROSE=1): expand every scene with no prose yet → prose.
// Resumable + crash-tolerant: skips already-done nodes, retries transient claude -p crashes per-node, so a
// session-limit/crash mid-run just means "re-run to fill the gaps." Usage:
//   DNA_WITH_PROSE=1 node scripts/dna-add-scenes.mjs <bookId>
process.env.DNA_NO_MAIN = "1";
process.env.DNA_BRIDGE_NO_LISTEN = "1";
const { expand, loadNodes } = await import("./dna-flow-test.mjs");

const BOOK = Number(process.argv[2]);
if (!BOOK) { console.error("usage: node scripts/dna-add-scenes.mjs <bookId>"); process.exit(1); }
const RETRIES = 2;

let nodes = await loadNodes(BOOK);
const movements = nodes.filter((n) => n.kind === "movement").sort((a, b) => a.position - b.position);
const mPos = new Map(movements.map((m, i) => [m.id, i]));
const beats = nodes.filter((n) => n.kind === "beat").sort((a, b) => (mPos.get(a.parent_id) - mPos.get(b.parent_id)) || (a.position - b.position));

const hasScenes = (beatId, all) => all.some((n) => n.kind === "scene" && n.parent_id === beatId);
let done = 0, made = 0, skipped = 0, failed = [];
for (const b of beats) {
  if (hasScenes(b.id, nodes)) { skipped++; continue; }
  let ok = false;
  for (let attempt = 1; attempt <= RETRIES && !ok; attempt++) {
    try {
      const scenes = await expand(BOOK, b, "scenes");
      made += scenes.length; ok = true;
    } catch (e) {
      console.error(`  beat ${b.id} attempt ${attempt} failed: ${String(e.message ?? e)}`);
    }
  }
  if (ok) done++; else failed.push(b.id);
  console.log(`[scenes] ${done + skipped}/${beats.length} beats done (${made} scenes so far)${failed.length ? ` · ${failed.length} failed` : ""}`);
}
nodes = await loadNodes(BOOK);
let counts = nodes.reduce((a, n) => ((a[n.kind] = (a[n.kind] ?? 0) + 1), a), {});
console.log(`\n[scenes] phase done — book ${BOOK}:`, JSON.stringify(counts));
if (failed.length) console.log(`[scenes] ${failed.length} beats still need scenes (re-run to fill): ${failed.join(", ")}`);
else console.log(`[scenes] every beat has scenes ✓`);

// ── Phase 2: prose (opt-in) ─────────────────────────────────────────────────
if (process.env.DNA_WITH_PROSE) {
  const hasProse = (n) => !!(n.content?.prose?.text);
  // prose in reading order so the (eventual) context window reads naturally
  const movPos = new Map(movements.map((m, i) => [m.id, i]));
  const beatPos = new Map(nodes.filter((n) => n.kind === "beat").map((b) => [b.id, b.position]));
  const beatMov = new Map(nodes.filter((n) => n.kind === "beat").map((b) => [b.id, b.parent_id]));
  const scenes = nodes.filter((n) => n.kind === "scene").sort((a, b) =>
    (movPos.get(beatMov.get(a.parent_id)) - movPos.get(beatMov.get(b.parent_id))) ||
    (beatPos.get(a.parent_id) - beatPos.get(b.parent_id)) || (a.position - b.position));
  let pdone = 0, pskip = 0, pfail = [];
  for (const s of scenes) {
    if (hasProse(s)) { pskip++; continue; }
    let ok = false;
    for (let attempt = 1; attempt <= RETRIES && !ok; attempt++) {
      try { await expand(BOOK, s, "prose"); ok = true; }
      catch (e) { console.error(`  scene ${s.id} attempt ${attempt} failed: ${String(e.message ?? e)}`); }
    }
    if (ok) pdone++; else pfail.push(s.id);
    console.log(`[prose] ${pdone + pskip}/${scenes.length} scenes done${pfail.length ? ` · ${pfail.length} failed` : ""}`);
  }
  nodes = await loadNodes(BOOK);
  const words = nodes.filter((n) => n.kind === "scene").reduce((a, n) => a + (n.content?.prose?.words ?? 0), 0);
  console.log(`\n[prose] ${pdone} scenes drafted this run · ${words} total words in book`);
  if (pfail.length) console.log(`[prose] ${pfail.length} scenes still need prose (re-run to fill): ${pfail.join(", ")}`);
  else console.log(`[prose] every scene has prose ✓`);
}
