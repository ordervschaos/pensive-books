#!/usr/bin/env node
// One-off: strip the DEPRECATED spine-route keys from books.spine jsonb.
// The live spine is just { text, brief_hash, pinned, author_edited_at }; `routes`,
// `selected_route_id`, and `proposals` are dead legacy fields. Idempotent — safe to re-run.
//   node scripts/strip-spine-routes.mjs
// Reuses the env + service-key pattern from scripts/fetch-book.mjs.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const serviceKey = readFileSync(new URL("../apply-migration.mjs", import.meta.url), "utf8")
  .match(/const supabaseKey\s*=\s*['"]([^'"]+)['"]/)[1];
const sb = createClient(`https://${env.VITE_SUPABASE_PROJECT_ID}.supabase.co`, serviceKey);

const DEAD = ["routes", "selected_route_id", "proposals"];

const { data: books, error } = await sb.from("books").select("id, spine");
if (error) throw new Error("select: " + error.message);

let updated = 0;
for (const b of books) {
  const spine = b.spine;
  if (!spine || typeof spine !== "object") continue;
  const dirty = DEAD.some((k) => k in spine);
  if (!dirty) continue;
  const next = { ...spine };
  for (const k of DEAD) delete next[k];
  const { error: upErr } = await sb.from("books").update({ spine: next }).eq("id", b.id);
  if (upErr) throw new Error(`update ${b.id}: ${upErr.message}`);
  updated++;
  console.log(`  cleaned book ${b.id} (removed: ${DEAD.filter((k) => k in spine).join(", ")})`);
}
console.log(`\nDone. ${updated} book(s) updated out of ${books.length} scanned.`);

// Verify 1150 specifically.
const { data: b1150 } = await sb.from("books").select("spine").eq("id", 1150).maybeSingle();
if (b1150?.spine) {
  const left = DEAD.filter((k) => k in b1150.spine);
  console.log(`Book 1150 spine keys now: ${Object.keys(b1150.spine).join(", ")}`);
  console.log(left.length ? `  ⚠ still has: ${left.join(", ")}` : "  ✓ no dead route keys remain");
}
