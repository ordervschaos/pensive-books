// Non-destructive: regenerate book 1171's beat sheet through the bridge and inspect the returned beats
// for the new causal layer (needs/establishes). Does NOT persist — runDnaExpand only returns.
import { runDnaExpand } from "./eval-bridge.mjs";
import { SUPABASE_URL, sbHeaders } from "./eval-bridge.mjs";
import { writeFileSync } from "node:fs";

const BOOK = Number(process.argv[2] ?? 1171);
const r = await fetch(`${SUPABASE_URL}/rest/v1/book_nodes?book_id=eq.${BOOK}&kind=eq.pillar&select=id`, { headers: sbHeaders });
const [pillar] = await r.json();
if (!pillar) { console.error("no pillar"); process.exit(1); }

console.log(`[probe] regenerating beat sheet for book ${BOOK} (pillar ${pillar.id}) — bridge call, may take minutes…`);
const res = await runDnaExpand({ bookId: BOOK, nodeId: pillar.id, target: "beatsheet" });
if (res.error) { console.error("[probe] error:", res.error); process.exit(1); }

const beats = res.beats ?? [];
writeFileSync(new URL(`./.dna-causality-${BOOK}.json`, import.meta.url), JSON.stringify(res, null, 2));
console.log(`[probe] ${beats.length} beats returned\n`);
let withNeeds = 0, withEst = 0, therefores = 0;
for (const b of beats) {
  const c = b.content;
  if (c.needs?.length) withNeeds++;
  if (c.establishes?.length) withEst++;
  if (c.connector === "therefore") therefores++;
  console.log(`  m${b.movement} [${(c.connector ?? "—").padEnd(9)}] ${c.polarity ?? "?"}  needs:[${(c.needs ?? []).join(", ")}]  → est:[${(c.establishes ?? []).join(", ")}]`);
}
console.log(`\n[probe] coverage: ${withNeeds}/${beats.length} beats declare needs, ${withEst}/${beats.length} establish, ${therefores} therefores`);
