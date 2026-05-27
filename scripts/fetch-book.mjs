#!/usr/bin/env node
// Download a book + its pages from Supabase into a local markdown file, so
// Claude Code can read and evaluate it against the fiction rubric.
//   node scripts/fetch-book.mjs <bookId>
// Writes: reports/<bookId>-manuscript.md   (and prints the path + word count)
//
// Reads the service-role key from apply-migration.mjs (private books need it);
// never hardcodes a new secret here.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
// pnpm doesn't symlink supabase-js at repo root; resolve it from apps/web.
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");

const bookId = Number(process.argv[2]);
if (!bookId) {
  console.error("Usage: node scripts/fetch-book.mjs <bookId>");
  process.exit(1);
}

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

// Minimal tiptap-JSON → text, mirroring jsonToText semantics.
function jsonToText(node) {
  if (!node) return "";
  if (Array.isArray(node)) return node.map(jsonToText).join("");
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  const inner = node.content ? jsonToText(node.content) : "";
  if (["paragraph", "heading", "blockquote", "listItem", "codeBlock"].includes(node.type))
    return inner + "\n\n";
  return inner;
}
function htmlToText(html) {
  if (!html) return "";
  return html
    .replace(/<\/(p|div|h[1-6]|li|blockquote|pre)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const { data: book, error: be } = await sb
  .from("books")
  .select("id,name,subtitle,author,brief,is_public")
  .eq("id", bookId)
  .single();
if (be) throw new Error("book: " + be.message);

const { data: pages, error: pe } = await sb
  .from("pages")
  .select("id,title,page_index,page_type,content,html_content")
  .eq("book_id", bookId)
  .eq("archived", false)
  .order("page_index", { ascending: true });
if (pe) throw new Error("pages: " + pe.message);

let words = 0;
const lines = [];
lines.push(`# ${book.name}`);
if (book.subtitle) lines.push(`*${book.subtitle}*`);
if (book.author) lines.push(`by ${book.author}`);
lines.push("");
lines.push(`> Book id ${book.id} · public: ${book.is_public} · ${pages.length} pages`);
lines.push("");
if (book.brief) {
  lines.push("## Author's brief (intent — treat as the genre contract)");
  lines.push("```json");
  lines.push(JSON.stringify(book.brief, null, 2));
  lines.push("```");
  lines.push("");
} else {
  lines.push("> No author brief set — infer the genre contract from the text.");
  lines.push("");
}

for (const p of pages) {
  const text =
    p.page_type === "text" ? (htmlToText(p.html_content) || jsonToText(p.content)).trim() : "";
  words += text ? text.split(/\s+/).length : 0;
  lines.push(`---`);
  lines.push(`## [${p.page_index}] ${p.title || "(untitled)"}  \`id:${p.id}\` \`${p.page_type}\``);
  lines.push("");
  lines.push(text || "_(no text content)_");
  lines.push("");
}
lines.unshift(`<!-- manuscript word count: ${words} -->`);

mkdirSync(new URL("../reports/", import.meta.url), { recursive: true });
writeFileSync(new URL(`../reports/${book.id}-manuscript.md`, import.meta.url), lines.join("\n"));
console.log(
  `Wrote ${pages.length} pages, ~${words} words → reports/${book.id}-manuscript.md`
);
