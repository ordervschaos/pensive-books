// Materialize the causality-constrained beat sheet (probe output) as a NEW book: clone 1171's structure +
// entities (everything except beats/scenes), then attach the probe's beats with all node-refs remapped.
// Usage: DNA_BRIDGE_NO_LISTEN=1 node scripts/dna-materialize-causal.mjs [srcBookId]
import { SUPABASE_URL, sbHeaders } from "./eval-bridge.mjs";
import { readFileSync } from "node:fs";

const SRC = Number(process.argv[2] ?? 1171);
const newId = () => `n_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
const rest = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...sbHeaders, "content-type": "application/json", Prefer: "return=representation", ...(opts.headers || {}) } });

// 1. source book (copy generation-relevant fields) + full tree
const [src] = await (await rest(`books?id=eq.${SRC}&select=name,owner_id,brief,is_public,bible,foundations,canon,steers,craft_notes,spine`)).json();
const tree = await (await rest(`book_nodes?book_id=eq.${SRC}&select=id,parent_id,kind,level,position,content,authoring`)).json();
const probe = JSON.parse(readFileSync(new URL(`./.dna-causality-${SRC}.json`, import.meta.url), "utf8"));

// 2. new book row
const [book] = await (await rest("books", { method: "POST", body: JSON.stringify({
  name: `${src.name?.replace(/\s*\(.*\)\s*$/, "") ?? "Untitled"} (causal beat sheet)`,
  owner_id: src.owner_id, brief: src.brief, is_public: false,
  bible: src.bible, foundations: src.foundations, canon: src.canon, steers: src.steers, craft_notes: src.craft_notes, spine: src.spine,
}) })).json();
const bookId = book.id;
console.log(`[materialize] new book ${bookId} — "${book.name}"`);

// 3. clone structure + entities (everything except beat/scene). Build old→new id map.
const SKIP = new Set(["beat", "scene"]);
const cloneSrc = tree.filter((n) => !SKIP.has(n.kind));
const idMap = {};
for (const n of cloneSrc) idMap[n.id] = newId();
// also pre-map the probe's beat ids (so couples/refs between probe beats — if any — remap too)
for (const b of probe.beats) b.__newId = newId();

// remap every old id → new id across a serialized batch (ids are unique tokens; entities carry no prose)
const remap = (rows) => {
  let s = JSON.stringify(rows);
  for (const [oldId, newId_] of Object.entries(idMap)) s = s.split(oldId).join(newId_);
  return JSON.parse(s);
};

const clonedEntities = remap(cloneSrc.map((n) => ({
  id: n.id, book_id: bookId, parent_id: n.parent_id, level: n.level, kind: n.kind, position: n.position,
  content: n.content, authoring: n.authoring,
})));

// 4. probe beats → beat nodes under the cloned acts (act field is an INDEX into actIds)
const posByMov = {};
const beatRows = probe.beats.map((b) => {
  const oldMovId = probe.actIds[b.act] ?? probe.actIds[0];
  const parent_id = idMap[oldMovId];
  const position = (posByMov[parent_id] = (posByMov[parent_id] ?? 0) + 1) - 1;
  return { id: b.__newId, book_id: bookId, parent_id, level: 4, kind: "beat", position, content: b.content, authoring: { source: "ai", locked: false, status: "accepted" } };
});
const clonedBeats = remap(beatRows); // remap entity refs inside beat content (threads/plays/grounds_in/realizes)

// 5. insert structure+entities first (parents before beats), then beats
const ins1 = await rest("book_nodes", { method: "POST", body: JSON.stringify(clonedEntities) });
if (!ins1.ok) { console.error("entity insert failed:", await ins1.text()); process.exit(1); }
const ins2 = await rest("book_nodes", { method: "POST", body: JSON.stringify(clonedBeats) });
if (!ins2.ok) { console.error("beat insert failed:", await ins2.text()); process.exit(1); }

const counts = clonedEntities.concat(clonedBeats).reduce((a, n) => ((a[n.kind] = (a[n.kind] ?? 0) + 1), a), {});
console.log(`[materialize] inserted ${clonedEntities.length + clonedBeats.length} nodes:`, counts);
console.log(`[materialize] open: http://localhost:8080/books/${bookId}-${(book.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}/dna`);
console.log(`BOOK_ID=${bookId}`);
