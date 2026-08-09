// Reader Machine — P0 core: an epub becomes the units a reader steps through, plus the free lenses.
// See .doc_1786174825000_reader_model_algorithm.md §10 (P0) for the plan this implements.
//
// PURE + ISOMORPHIC. No network, no model calls, no Supabase. Runs identically in the browser (the
// /reader page) and in Node (scripts/reader-machine.mts, which sets globalThis.DOMParser from
// happy-dom). ONE implementation — the script imports this file rather than mirroring it, so there
// is no twin to drift, the same rule _shared/dna-decompose-core.ts follows.
//
// ── Why this does not reuse src/lib/epubImport.ts ────────────────────────────────────────────────
// That parser is the production import path and is correct for STRUCTURED epubs (Calibre/Vellum/
// Gutenberg): it segments on <h1..h6> and <hr>. A ripped epub has neither — every block is a plain
// <p>, chapter titles are rasterized images, and paragraphs break at printed line ends. Running the
// production parser on one yields a handful of 22k-word "chapters" starting mid-scene. So this adds
// a REPAIR pass and recovers structure from the TEXT. epubImport.ts is untouched.
//
// ── The pipeline (order matters) ─────────────────────────────────────────────────────────────────
//   §1 EXTRACT   spine → ordered RAW blocks (what the file literally contains)
//   §2 LOCATE    find chapter markers in the TEXT; story start = first marker that survives
//   §3 REPAIR    per chapter: drop debris, rejoin line fragments → real paragraphs
//   §4 SEGMENT   chapter → units (the paragraph IS the reader's step)
//   §5 MEASURE   computed lenses, zero cost
//
// LOCATE runs BEFORE REPAIR on purpose: the rejoin rule cannot tell a heading from a line fragment
// (both lack terminal punctuation), so run the other way it glues "CHAPTER" + "ONE" + the first
// sentence into one blob. Structure recovery must precede text repair.
import JSZip from "jszip";

// ── §1 EXTRACT ───────────────────────────────────────────────────────────────────────────────────
const byLocalName = (root: Document | Element, name: string): Element[] =>
  Array.from(root.getElementsByTagName("*")).filter((el) => el.localName?.toLowerCase() === name);

const resolvePath = (dir: string, href: string): string => {
  const out: string[] = [];
  for (const p of (dir ? dir.split("/") : []).concat(decodeURIComponent(href).split("/"))) {
    if (!p || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
};

const LEAF = new Set(["p", "li", "pre", "dd", "dt", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote"]);

/** Flatten one document into ordered text blocks. Whitespace is NOT normalised — §3 reads it. */
function collect(el: Element, out: string[]): void {
  const tag = el.localName?.toLowerCase() ?? "";
  const kids = Array.from(el.children);
  if (LEAF.has(tag) || !kids.length) {
    // &nbsp; is how a ripper encodes justification gaps. Fold it to a plain space so the multi-space
    // artifact survives as a signal, but strip nothing else — §3 still needs the raw shape.
    const t = (el.textContent ?? "").replace(/\u00a0/g, " ").replace(/[\r\n\t]+/g, " ").trim();
    if (t) out.push(t);
    return;
  }
  for (const child of kids) collect(child, out);
}

export interface ReaderBook {
  title: string;
  author: string | null;
  blocks: string[];
  chapters: Chapter[];
  /** Blocks before the first chapter's opening group — front matter, kept for inspection. */
  frontMatter: number;
}

/** Read an epub into ordered raw blocks + located chapters. Requires a global DOMParser. */
export async function readEpub(data: ArrayBuffer | Uint8Array | Blob): Promise<ReaderBook> {
  const zip = await JSZip.loadAsync(data as ArrayBuffer);
  const xml = new DOMParser();
  const read = async (p: string): Promise<string | null> => {
    const f = zip.file(p);
    // Drop <link> (happy-dom eagerly fetches stylesheets) and the XML declaration (it rejects the
    // single-quoted form outright) — same two workarounds src/lib/epubImport.ts needs.
    return f ? (await f.async("text")).replace(/^\s*<\?xml[^>]*\?>/i, "").replace(/<link\b[^>]*>/gi, "") : null;
  };

  const containerXml = await read("META-INF/container.xml");
  if (!containerXml) throw new Error("Not an epub: missing META-INF/container.xml");
  const container = xml.parseFromString(containerXml, "text/xml");
  const opfPath = byLocalName(container, "rootfile")[0]?.getAttribute("full-path");
  if (!opfPath) throw new Error("Not an epub: container.xml has no rootfile");
  const opfXml = await read(opfPath);
  if (!opfXml) throw new Error(`Not an epub: missing ${opfPath}`);
  const opf = xml.parseFromString(opfXml, "text/xml");
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";

  const textOf = (el: Element | undefined): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const title = textOf(byLocalName(opf, "title")[0]) || "Untitled";
  const author = textOf(byLocalName(opf, "creator")[0]) || null;

  const manifest = new Map<string, string>();
  for (const item of byLocalName(opf, "item")) {
    const id = item.getAttribute("id"), href = item.getAttribute("href");
    if (id && href) manifest.set(id, href);
  }

  const blocks: string[] = [];
  for (const ref of byLocalName(opf, "itemref")) {
    const href = manifest.get(ref.getAttribute("idref") ?? "");
    if (!href) continue;
    const raw = await read(resolvePath(opfDir, href));
    if (!raw) continue;
    const doc = xml.parseFromString(raw, "text/html");
    const body = doc.body ?? byLocalName(doc, "body")[0];
    for (const child of Array.from(body?.children ?? [])) collect(child, blocks);
  }

  const chapters = locate(blocks);
  return { title, author, blocks, chapters, frontMatter: chapters[0]?.openFrom ?? 0 };
}

// ── §2 LOCATE — where the story is ───────────────────────────────────────────────────────────────
// The chapter number survives as TEXT even when the decorative title art is an image. But a real
// heading and a table-of-contents row look identical to a regex. Two independent tests separate
// them; the first is the load-bearing one.
const WORD_NUM: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10,
  ELEVEN: 11, TWELVE: 12, THIRTEEN: 13, FOURTEEN: 14, FIFTEEN: 15, SIXTEEN: 16, SEVENTEEN: 17,
  EIGHTEEN: 18, NINETEEN: 19, TWENTY: 20, THIRTY: 30, FORTY: 40, FIFTY: 50, SIXTY: 60,
};
const parseNum = (s: string): number | null => {
  const parts = s.trim().toUpperCase().split(/[\s-]+/).filter(Boolean);
  if (!parts.length || parts.some((p) => !(p in WORD_NUM))) return null;
  return parts.reduce((n, p) => n + WORD_NUM[p], 0);
};

/**
 * Small-caps debris: a ripper explodes a small-caps attribution ("—Annals of the Dragon Riders")
 * into one block per letter — "—A", "O", ", S", "’ C". Unrecoverable; drop it rather than let a
 * later pass consume failure text as story data.
 */
const isDebris = (s: string): boolean => {
  const toks = s.split(/\s+/).filter(Boolean);
  return toks.length > 0 && toks.length <= 3 && toks.every((t) => t.replace(/[^\p{L}\p{N}]/gu, "").length <= 1);
};

/** The number this block announces, or null. Two forms: "CHAPTER"+"ONE" split, or "CHAPTER ONE". */
const markerNum = (blocks: string[], i: number): { num: number; span: number } | null => {
  const b = (blocks[i] ?? "").trim();
  if (/^CHAPTER$/i.test(b)) {
    const n = parseNum(blocks[i + 1] ?? "");
    return n === null ? null : { num: n, span: 1 };
  }
  const m = b.match(/^CHAPTER\s+([A-Z][A-Z\s-]*)$/i);
  if (!m) return null;
  const n = parseNum(m[1]);
  return n === null ? null : { num: n, span: 0 };
};

// The prose test must look at a WINDOW, not the next block: a chapter can open on a five-word
// paragraph ("I will not die today."), which a next-block-only threshold rejects. A TOC row's next
// five neighbours are five more two-word rows (~10 words); a chapter's are hundreds.
const PROSE_WINDOW = 5;
const PROSE_MIN = 40;

export interface Chapter {
  num: number;
  label: string;
  /** First block of the chapter's PROSE. */
  at: number;
  /**
   * First block of the chapter's OPENING GROUP (epigraph if any, else the marker). A chapter's body
   * ends at the NEXT chapter's `openFrom` — ending it at the next `at` trails that chapter's
   * epigraph and heading onto this one.
   */
  openFrom: number;
  epigraph: string[];
}

function locate(blocks: string[]): Chapter[] {
  const out: Chapter[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const hit = markerNum(blocks, i);
    if (!hit) continue;
    const { num, span } = hit;

    // A TABLE OF CONTENTS IS A RUN OF ADJACENT MARKERS; a chapter heading is isolated. This is the
    // load-bearing front-matter test — it holds even where the prose-window test below is fooled
    // (a TOC's last rows are followed by "Acknowledgments" and the copyright block, which clear any
    // word threshold). Structural, not lexical, so it survives odd titling.
    if (markerNum(blocks, i - 1) || markerNum(blocks, i + span + 1)) continue;

    let j = i + span + 1;
    while (j < blocks.length && isDebris(blocks[j])) j++;
    const window = blocks.slice(j, j + PROSE_WINDOW).join(" ").split(/\s+/).filter(Boolean).length;
    if (window < PROSE_MIN) continue;

    const { texts, from } = epigraphBefore(blocks, i);
    out.push({ num, label: `Chapter ${num}`, at: j, openFrom: from, epigraph: texts });
    i = j - 1;
  }
  return out;
}

// OBSERVED block order, every chapter: epigraph → attribution debris → CHAPTER N → prose. So an
// epigraph sits BEFORE the marker of the chapter it belongs to (in print it is on the chapter-
// opening spread, facing the chapter number). Walk back over the debris run, then take what's behind.
//
// TUNED, not derived. Epigraphs in the reference book are 1–2 blocks under ~50 words. A looser cap
// walks chapter 1's capture into the dedication and transcriber's note, because chapter 1 is the
// one chapter whose opening group is preceded by front matter rather than a previous chapter.
// Low-stakes by placement: the epigraph is reported SEPARATELY and never enters the unit stream or
// the curves, so an over-capture is visible in the output instead of silently biasing a measurement.
const EPIGRAPH_MAX_BLOCKS = 2;
const EPIGRAPH_MAX_WORDS = 60;

function epigraphBefore(blocks: string[], markerAt: number): { texts: string[]; from: number } {
  let k = markerAt - 1, debris = 0;
  while (k >= 0 && isDebris(blocks[k])) { k--; debris++; }
  if (debris < 2) return { texts: [], from: markerAt };   // no attribution run ⇒ nothing to attribute
  const texts: string[] = [];
  let words = 0;
  while (k >= 0 && texts.length < EPIGRAPH_MAX_BLOCKS) {
    const w = blocks[k].split(/\s+/).filter(Boolean).length;
    if (words + w > EPIGRAPH_MAX_WORDS) break;
    texts.unshift(dejustify(blocks[k]));
    words += w;
    k--;
  }
  return { texts, from: k + 1 };
}

// ── §3 REPAIR — recover paragraphs from printed line fragments ───────────────────────────────────
// A rip breaks a paragraph wherever the printed line ended. ONE signal puts it back: a fragment
// that does not end in terminal punctuation is mid-sentence, so it continues into the next
// ("…tilting my chin toward the" + "mat."). Dialogue rejoins its attribution for free, because a
// comma inside the closing quote ("…academics,”" + "Rhiannon says") is not terminal either.
//
// REJECTED: a "justified tail ⇒ continues" rule, to also catch "…and attack!”" + "Professor
// Emetterio orders…". A ripper leaves multi-space gaps in justified lines, so the idea was that a
// paragraph's true last line (short, unjustified) has single spaces. It FALSE-JOINS: a short last
// line sits inside the same tail window as the end of the previous justified line, so complete
// paragraphs read as justified and swallow their successor — three merged in a row on the reference
// book. The residual error is now only OVER-SEGMENTATION, and that is the error to prefer:
// over-segmenting is recoverable downstream, over-joining destroys the paragraph boundary, which is
// itself one of the lenses (§5 unit length / paragraph rhythm).
//
// NOTE: no de-hyphenation pass, deliberately. Print hyphenates at line breaks, but the reference
// epub ships those already rejoined ("ambitious" whole; "ambi-" absent). Every surviving
// `lowercase- lowercase` is a SUSPENDED hyphen ("second- or third-years") that a de-hyphenator
// would corrupt into "secondor". Verify against the epub before adding one.
const endsTerminal = (s: string): boolean => /[.!?…][)"'’”\s]*$/.test(s.trim());
const dejustify = (s: string): string => s.replace(/\s{2,}/g, " ").trim();

export function repair(raw: string[]): string[] {
  const out: string[] = [];
  let buf = "";
  for (const frag of raw) {
    if (isDebris(frag)) continue;
    buf = buf ? `${buf} ${dejustify(frag)}` : dejustify(frag);
    if (endsTerminal(frag)) { out.push(buf); buf = ""; }
  }
  if (buf) out.push(buf);
  return out;
}

// ── §4 SEGMENT + §5 MEASURE ──────────────────────────────────────────────────────────────────────
// "Line by line" is the right instinct and the wrong unit: literal lines shred dialogue and blow the
// budget. The paragraph IS the reader's step, and a dialogue beat is already its own paragraph.
export type UnitKind = "dialogue" | "mixed" | "narration" | "fragment";

export interface ReaderUnit {
  i: number;
  text: string;
  kind: UnitKind;
  words: number;
  sentences: number;
  /** Words per sentence — tempo. */
  wps: number;
  dialogueRatio: number;
  pronounRate: number;
  commaRate: number;
  /** Literal '?' count. A deliberately dumb baseline the judged `open` verb (P1) must beat. */
  questions: number;
  properNouns: string[];
  /** First appearance in this chapter — the reader's onboarding cost. */
  newProperNouns: string[];
}

const QUOTED = /[“"]([^”"]*)[”"]/g;
const SENTENCE_END = /[.!?…]+["”’']?(\s|$)/g;
const PRONOUNS = /\b(i|me|my|mine|he|him|his|she|her|hers|they|them|their|we|us|our|you|your)\b/gi;
// A proper noun: capitalised and NOT sentence-initial, so it must follow a lowercase word or comma.
const PROPER = /(?<=[a-z,;:]\s)([A-Z][a-z]{2,})/g;

function measure(text: string, i: number, seen: Set<string>): ReaderUnit {
  const words = text.split(/\s+/).filter(Boolean).length;
  const sentences = Math.max(1, (text.match(SENTENCE_END) ?? []).length);
  const quoted = Array.from(text.matchAll(QUOTED)).reduce((n, m) => n + m[0].length, 0);
  const dialogueRatio = text.length ? quoted / text.length : 0;
  const proper = Array.from(new Set(Array.from(text.matchAll(PROPER)).map((m) => m[1])));
  const fresh = proper.filter((p) => !seen.has(p));
  fresh.forEach((p) => seen.add(p));
  return {
    i, text, words, sentences,
    kind: words < 8 ? "fragment" : dialogueRatio > 0.65 ? "dialogue" : dialogueRatio > 0.15 ? "mixed" : "narration",
    wps: Number((words / sentences).toFixed(1)),
    dialogueRatio: Number(dialogueRatio.toFixed(2)),
    pronounRate: Number(((text.match(PRONOUNS) ?? []).length / (words || 1)).toFixed(3)),
    commaRate: Number(((text.match(/,/g) ?? []).length / (words || 1)).toFixed(3)),
    questions: (text.match(/\?/g) ?? []).length,
    properNouns: proper,
    newProperNouns: fresh,
  };
}

export interface ChapterAnalysis {
  chapter: Chapter;
  /** Blocks the chapter spans, [from, to). */
  span: [number, number];
  rawFragments: number;
  units: ReaderUnit[];
  words: number;
  /** Every proper noun the chapter introduces, in first-appearance order. */
  cast: string[];
}

/** Run REPAIR → SEGMENT → MEASURE over one chapter. `index` is 0-based into `book.chapters`. */
export function analyzeChapter(book: ReaderBook, index: number): ChapterAnalysis {
  const chapter = book.chapters[index];
  if (!chapter) throw new Error(`No chapter at index ${index}`);
  const to = book.chapters[index + 1]?.openFrom ?? book.blocks.length;
  const rawFrags = book.blocks.slice(chapter.at, to);
  const seen = new Set<string>();
  const units = repair(rawFrags).map((p, i) => measure(p, i, seen));
  return {
    chapter,
    span: [chapter.at, to],
    rawFragments: rawFrags.length,
    units,
    words: units.reduce((n, u) => n + u.words, 0),
    cast: Array.from(seen),
  };
}

// ── derived series (what the charts plot) ────────────────────────────────────────────────────────
/** Cumulative count of names introduced — the free proxy for reader onboarding load. */
export const castCurve = (units: ReaderUnit[]): number[] => {
  let n = 0;
  return units.map((u) => (n += u.newProperNouns.length));
};

/** Downsample a per-unit series to `n` buckets so a long chapter stays readable. */
export function bucket(xs: number[], n: number): number[] {
  if (xs.length <= n) return xs;
  return Array.from({ length: n }, (_, b) => {
    const lo = Math.floor((b * xs.length) / n);
    const hi = Math.max(lo + 1, Math.floor(((b + 1) * xs.length) / n));
    const slice = xs.slice(lo, hi);
    return slice.reduce((a, c) => a + c, 0) / slice.length;
  });
}
