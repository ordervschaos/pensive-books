// dna-upgrade — run the NEW architecture's structural layers (movements → threads → global beat sheet →
// scenes) on an EXISTING book's foundations, replacing the pre-architecture movements/beats/scenes. Tests
// that the system upgrades a real (migrated) book, not just a synthetic fresh one. Keeps seed/premise/pillar
// + the entity registry (the human core); regenerates everything from the acts down.
//
//   DNA_BRIDGE_NO_LISTEN=1 DNA_NO_MAIN=1 DNA_BOOK_ID=1171 node scripts/dna-upgrade.mjs
import { writeFileSync } from "node:fs";
import { expand, persistBeatSheet, loadNodes, rest, log, TREE } from "./dna-flow-test.mjs";

const bookId = Number(process.env.DNA_BOOK_ID || 1171);
const delRow = (id) => rest(`book_nodes?id=eq.${id}`, { method: "DELETE" });

async function main() {
  log(`── UPGRADE book ${bookId} to the new architecture ──`);
  let nodes = await loadNodes(bookId);
  const pillar = nodes.find((n) => n.kind === "pillar");
  if (!pillar) throw new Error("no pillar — book has no DNA foundations");
  const oldMovements = nodes.filter((n) => n.kind === "movement");
  log(`foundations kept: ${["seed","premise","pillar","character","relationship","tentpole","world_fact"].map((k)=>`${k}:${nodes.filter(n=>n.kind===k).length}`).join(" ")}`);

  // (4) regenerate movements WITH target_pct (exactly 4 on structural gravity), then drop the old acts
  // (cascade removes their beats + scenes — the pre-architecture structure).
  const movements = await expand(bookId, pillar, "movements");
  for (const m of oldMovements) await delRow(m.id);
  log(`movements: replaced ${oldMovements.length} → ${movements.length} (with target_pct)`);

  // (5) threads — the promise registry (reads the new movements)
  await expand(bookId, pillar, "threads");

  // (6) GLOBAL beat sheet — schedules setup→payoff in order, plans polarity to oscillate
  const allBeats = await expand(bookId, pillar, "beatsheet");
  const mPos = new Map(movements.map((m, i) => [m.id, i]));
  allBeats.sort((a, b) => (mPos.get(a.parent_id) - mPos.get(b.parent_id)) || (a.position - b.position));

  // (7) scenes — realize each beat (inherit polarity + thread schedule)
  for (const b of allBeats) await expand(bookId, b, "scenes");

  nodes = await loadNodes(bookId);
  writeFileSync(TREE, JSON.stringify({ bookId, brief: null, nodes }, null, 2));
  const counts = {}; for (const n of nodes) counts[n.kind] = (counts[n.kind] || 0) + 1;
  log(`DONE. book ${bookId}. nodes: ${JSON.stringify(counts)}`);
  log(`tree dumped → ${TREE}`);
}

main().catch((e) => { log(`FATAL: ${e.message}`); process.exit(1); });
