// One-shot: dump book 1171's tree + run the engine's three-axis analysis. Read-only.
import { SUPABASE_URL, sbHeaders } from "./eval-bridge.mjs";
import { writeFileSync } from "node:fs";

const BOOK = Number(process.argv[2] ?? 1171);

const r = await fetch(
  `${SUPABASE_URL}/rest/v1/book_nodes?book_id=eq.${BOOK}&select=id,parent_id,level,kind,position,content,authoring&order=level.asc,position.asc`,
  { headers: sbHeaders },
);
const nodes = await r.json();
if (!Array.isArray(nodes)) { console.error("fetch failed:", nodes); process.exit(1); }
writeFileSync(new URL(`./.dna-tree-${BOOK}.json`, import.meta.url), JSON.stringify(nodes, null, 2));

const byKind = {};
for (const n of nodes) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
console.log(`book ${BOOK}: ${nodes.length} nodes`);
console.log("by kind:", byKind);
