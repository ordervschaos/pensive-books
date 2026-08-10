#!/usr/bin/env -S npx tsx
// Reader Machine — admin inspection fixture.
//
//   npx tsx scripts/reader-admin-fixture.mts
//
// Generates the FULL-TEXT version of the chapter-1 fixture (every unit's text kept, not just the
// opening — see DemoFixture.tsx for why the public one is truncated) and uploads it to the PRIVATE
// `reader-admin` Storage bucket, gated by admin_users RLS (supabase/migrations/20260810120000_
// reader_admin_storage.sql). Never committed to the repo — this is exactly the copyrighted text
// the public fixture avoids shipping, so it only ever lives in gated Storage. Re-run to refresh.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const { Window } = await import(join(repoRoot, "apps/web/node_modules/happy-dom/lib/index.js"));
globalThis.DOMParser = new Window().DOMParser;

const { readEpub, analyzeChapter } = await import(join(repoRoot, "apps/web/src/features/reader/lib/readerMachine.ts"));

const env = Object.fromEntries(
  readFileSync(join(repoRoot, ".env.local"), "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const supabase = createClient(`https://${env.VITE_SUPABASE_PROJECT_ID}.supabase.co`, env.SERVICE_ROLE_SECRET);

const book = await readEpub(readFileSync(join(repoRoot, "sample-books/Fourth-Wing.epub")));
const a = analyzeChapter(book, 0); // chapter 1, matches the shipped demo fixture

const payload = {
  title: book.title,
  author: book.author,
  units: a.units.map((u) => ({ i: u.i, text: u.text })),
};

const path = "fourth-wing-ch1-fulltext.json";
const { error } = await supabase.storage
  .from("reader-admin")
  .upload(path, JSON.stringify(payload), { contentType: "application/json", upsert: true });

if (error) throw error;
console.log(`uploaded ${path} · ${payload.units.length} units · ${payload.units.reduce((n, u) => n + u.text.split(/\s+/).filter(Boolean).length, 0)} words`);
