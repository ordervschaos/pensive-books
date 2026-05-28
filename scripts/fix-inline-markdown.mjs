#!/usr/bin/env node
// Backfill: convert literal inline markdown (*italic*, _italic_, **bold**, __bold__) that
// was stored as PLAIN TEXT in older AI-generated pages into real TipTap marks — the same
// transform new generation now applies (apps/web/src/lib/inlineMarkdown.ts). Free, no AI.
//
//   node scripts/fix-inline-markdown.mjs <bookId>            # dry run — report only
//   node scripts/fix-inline-markdown.mjs <bookId> --write    # apply to the DB
//
// Only rewrites markless text nodes (generated prose); nodes that already carry marks
// (links, manual italics) are left alone. Idempotent: once converted, the asterisks and
// markless-ness are gone, so re-running is a no-op.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");

const bookId = Number(process.argv[2]);
const write = process.argv.includes("--write");
if (!bookId) {
  console.error("Usage: node scripts/fix-inline-markdown.mjs <bookId> [--write]");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const serviceKey = readFileSync(new URL("../apply-migration.mjs", import.meta.url), "utf8")
  .match(/const supabaseKey\s*=\s*['"]([^'"]+)['"]/)[1];
const sb = createClient(`https://${env.VITE_SUPABASE_PROJECT_ID}.supabase.co`, serviceKey);

// Mirror of apps/web/src/lib/inlineMarkdown.ts inlineMarkdownToNodes.
function inlineMarkdownToNodes(text) {
  const nodes = [];
  const re = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push({ type: "text", text: text.slice(last, m.index) });
    if (m[1]) nodes.push({ type: "text", text: m[2], marks: [{ type: "bold" }] });
    else nodes.push({ type: "text", text: m[4], marks: [{ type: "italic" }] });
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push({ type: "text", text: text.slice(last) });
  return nodes.filter((n) => n.text.length > 0);
}

const hasEmphasis = (s) => /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3/.test(s);

let converted = 0; // count of text nodes rewritten

// Walk a node; rebuild any `content` array, expanding markless text nodes with emphasis.
function transform(node) {
  if (!node || typeof node !== "object" || !Array.isArray(node.content)) return node;
  const next = [];
  for (const child of node.content) {
    if (child?.type === "text" && !child.marks && typeof child.text === "string" && hasEmphasis(child.text)) {
      const parts = inlineMarkdownToNodes(child.text);
      // Only count as a change if it actually splits / adds marks.
      if (parts.length !== 1 || parts[0].marks) converted += 1;
      next.push(...parts);
    } else {
      next.push(transform(child));
    }
  }
  return { ...node, content: next };
}

// Plain text of a block node (its direct text children joined).
function blockText(node) {
  return (node?.content ?? []).filter((c) => c?.type === "text").map((c) => c.text ?? "").join("").trim();
}

// Drop a leading body paragraph that just restates the page title — either a markdown
// heading line ("### Title") or the bare title — left by older generation. Title h1 is
// content[0]; we only inspect the paragraph(s) immediately after it.
let strippedEchoes = 0;
function stripTitleEcho(doc, title) {
  if (!doc || !Array.isArray(doc.content) || doc.content.length < 2) return doc;
  const t = (title ?? "").trim().toLowerCase();
  const content = [...doc.content];
  let idx = 1; // first node after the title heading
  while (idx < content.length && content[idx]?.type === "paragraph") {
    const txt = blockText(content[idx]);
    const isHeading = /^#{1,6}\s+/.test(txt);
    const echoesTitle = t && txt.replace(/^#{1,6}\s+/, "").trim().toLowerCase() === t;
    if (isHeading || echoesTitle) { content.splice(idx, 1); strippedEchoes += 1; }
    else break;
  }
  return { ...doc, content };
}

const { data: pages, error } = await sb
  .from("pages")
  .select("id, title, content")
  .eq("book_id", bookId)
  .eq("archived", false)
  .order("page_index", { ascending: true });
if (error) throw new Error("fetch pages: " + error.message);

let changedPages = 0;
for (const p of pages) {
  converted = 0;
  strippedEchoes = 0;
  const before = JSON.stringify(p.content);
  const after = stripTitleEcho(transform(p.content), p.title);
  if (JSON.stringify(after) === before) continue;
  changedPages += 1;
  const bits = [
    converted ? `${converted} emphasis span(s)` : null,
    strippedEchoes ? `${strippedEchoes} title echo` : null,
  ].filter(Boolean).join(", ");
  console.log(`page ${p.id} "${p.title ?? "Untitled"}": ${bits}`);
  if (write) {
    const { error: upErr } = await sb.from("pages").update({ content: after }).eq("id", p.id);
    if (upErr) throw new Error(`update page ${p.id}: ${upErr.message}`);
  }
}

console.log(
  `\n${write ? "Updated" : "Would update"} ${changedPages}/${pages.length} pages.` +
  (write ? "" : "  Re-run with --write to apply.")
);
