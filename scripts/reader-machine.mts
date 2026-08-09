#!/usr/bin/env -S npx tsx
// Reader Machine — P0 CLI (.doc_1786174825000_reader_model_algorithm.md §10).
//
//   npx tsx scripts/reader-machine.mts --epub sample-books/Fourth-Wing.epub --list
//   npx tsx scripts/reader-machine.mts --epub sample-books/Fourth-Wing.epub [--chapter 1] [--dump 20]
//   npx tsx scripts/reader-machine.mts --epub sample-books/Fourth-Wing.epub --fixture <out.json>
//
// All of the pipeline lives in apps/web/src/features/reader/lib/readerMachine.ts, which the /reader
// page imports too — ONE implementation, no twin to drift. This file is the terminal front end:
// argument parsing, sparklines, and the fixture writer.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// happy-dom supplies the DOMParser the core expects from the browser. It is a dep of apps/web, not
// of the repo root, so a bare specifier from scripts/ would not resolve — hence the explicit path.
const { Window } = await import(join(repoRoot, "apps/web/node_modules/happy-dom/lib/index.js"));
globalThis.DOMParser = new Window().DOMParser;

// The core's own `import JSZip from "jszip"` resolves from apps/web, because bare specifiers
// resolve relative to the IMPORTING file rather than to this script.
const { readEpub, analyzeChapter, castCurve, bucket } =
  await import(join(repoRoot, "apps/web/src/features/reader/lib/readerMachine.ts"));

const args = process.argv.slice(2);
const argVal = (f: string, d?: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : d; };
const has = (f: string) => args.includes(f);
const EPUB = argVal("--epub", "sample-books/Fourth-Wing.epub")!;
const CHAPTER = Number(argVal("--chapter", "1"));
const DUMP = argVal("--dump") ? Number(argVal("--dump")) : 0;
const FIXTURE = argVal("--fixture");

const SPARK = "▁▂▃▄▅▆▇█";
const spark = (xs: number[]): string => {
  const lo = Math.min(...xs), span = (Math.max(...xs) - lo) || 1;
  return xs.map((x) => SPARK[Math.min(7, Math.floor(((x - lo) / span) * 7.999))]).join("");
};

const book = await readEpub(readFileSync(join(repoRoot, EPUB)));
if (!book.chapters.length) {
  console.error("No chapter markers found — this epub needs a different LOCATE rule.");
  process.exit(1);
}

if (has("--list")) {
  console.log(`\n${book.title}${book.author ? ` — ${book.author}` : ""}`);
  console.log(`${book.blocks.length} raw blocks · ${book.chapters.length} chapters located`);
  console.log(`front matter: blocks 0..${book.frontMatter - 1}  ·  story starts at block ${book.chapters[0].at}\n`);
  book.chapters.slice(0, 12).forEach((c, i) => {
    const a = analyzeChapter(book, i);
    console.log(`  ${c.label.padEnd(12)} block ${String(c.at).padStart(5)}  ${String(a.words).padStart(6)}w  ${a.units[0]?.text.slice(0, 68) ?? ""}`);
  });
  console.log("  …\n");
  process.exit(0);
}

const a = analyzeChapter(book, CHAPTER - 1);
if (FIXTURE) {
  // The fixture must carry the MEASUREMENTS, not the manuscript — a copyrighted reference book has
  // to stay out of the repo and the production bundle.
  //
  // Per-unit truncation does NOT achieve that, which is worth stating because it looks like it
  // does: units are short (median ~26 words), so clipping each to 160 characters left 76% of the
  // chapter intact — a clip that clips almost nothing, 305 times. Retention here is a function of
  // unit COUNT, not of unit length, so the cap has to be structural: only the opening keeps text.
  // Everything after it ships as numbers, which is all the curves and the stats ever needed.
  const KEEP_TEXT = 12;
  mkdirSync(dirname(join(repoRoot, FIXTURE)), { recursive: true });
  const units = a.units.map((u, i) => (i < KEEP_TEXT ? u : { ...u, text: "" }));
  writeFileSync(join(repoRoot, FIXTURE), `${JSON.stringify({
    title: book.title, author: book.author,
    chapters: book.chapters.length, frontMatter: book.frontMatter,
    chapter: a.chapter, span: a.span, rawFragments: a.rawFragments, words: a.words, cast: a.cast,
    textKeptThrough: KEEP_TEXT,
    units,
  }, null, 2)}\n`);
  const kept = units.reduce((n, u) => n + u.text.split(/\s+/).filter(Boolean).length, 0);
  console.log(`\n  fixture → ${FIXTURE}`);
  console.log(`  ${a.units.length} units · text kept for the first ${KEEP_TEXT} only · ${kept}/${a.words} words retained (${Math.round((kept / a.words) * 100)}%)\n`);
  process.exit(0);
}

console.log(`\n${basename(EPUB)} — ${a.chapter.label}  (blocks ${a.span[0]}..${a.span[1] - 1})`);
console.log(`REPAIR: ${a.rawFragments} raw fragments → ${a.units.length} paragraphs (${(a.rawFragments / a.units.length).toFixed(2)}× fragmentation)`);
console.log(`${a.units.length} units · ${a.words} words · ${a.cast.length} proper nouns`);
// The epigraph is read BEFORE the first line of prose, so it seeds the reader's world model before
// the narrative starts. Reported separately: it is not narration and must not pollute the curves.
if (a.chapter.epigraph.length) console.log(`epigraph: "${a.chapter.epigraph.join(" ").slice(0, 150)}…"`);
console.log();

const W = 52;
const row = (label: string, xs: number[], fmt: (n: number) => string) =>
  console.log(`  ${label.padEnd(15)} ${spark(bucket(xs, W))}  ${fmt(Math.min(...xs))} → ${fmt(Math.max(...xs))}`);
row("tempo (wps)", a.units.map((u) => u.wps), (n) => n.toFixed(1));
row("unit length", a.units.map((u) => u.words), (n) => `${Math.round(n)}w`);
row("dialogue", a.units.map((u) => u.dialogueRatio), (n) => n.toFixed(2));
row("pronoun rate", a.units.map((u) => u.pronounRate), (n) => n.toFixed(2));
row("new names", castCurve(a.units), (n) => String(Math.round(n)));
row("questions", a.units.map((u) => u.questions), (n) => String(n));

const kinds = a.units.reduce<Record<string, number>>((m, u) => ({ ...m, [u.kind]: (m[u.kind] ?? 0) + 1 }), {});
console.log(`\n  mix             ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(" · ")}`);
console.log(`  cast introduced ${a.cast.slice(0, 20).join(", ")}${a.cast.length > 20 ? ` … (+${a.cast.length - 20})` : ""}`);
console.log(`  opens           "${a.units[0]?.text.slice(0, 100)}…"\n`);

for (const u of a.units.slice(0, DUMP)) {
  console.log(`  ${String(u.i).padStart(3)} ${u.kind.padEnd(9)} ${String(u.words).padStart(3)}w  ${u.text.slice(0, 118)}`);
}
if (DUMP) console.log();
