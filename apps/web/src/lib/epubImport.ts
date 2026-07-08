// epubImport — the inverse of lib/epub.ts: parse an .epub into chapters of plain-text scenes.
// Generic (no DNA imports); the DNA adapter lives in features/dna/lib/importEpub.ts.
//
// Handles both epub shapes:
//  • multi-file (Calibre/Scrivener/Vellum): one XHTML per chapter, heading inside the file
//  • single-file (Pensive's own export): every page is a <section> in one content.xhtml
//
// Segmentation rules (v1, deterministic — no LLM):
//  • a spine file boundary closes the current chapter
//  • a heading BEFORE any prose in the chapter RETITLES it (this is what collapses Pensive's
//    cover block + section-page/content-page duplicate headings, and generic title pages)
//  • a heading AFTER prose starts a new chapter
//  • <hr> or an asterism paragraph (`* * *`, `⁂`, …) is a scene break
//
// Front/back-matter filtering (verified against Gutenberg + Distributed Proofreaders epubs):
//  • boilerplate chapters (Project Gutenberg header/license, DP blurb, transcriber notes) — by
//    title or by the opening of their text
//  • apparatus chapters (table of contents — incl. TOC rendered as prose, copyright, dedication…)
//  • title pages: very short chapters that just echo the book title / author
//  • title-only chapters that echo the book title / "by <author>" (real part dividers survive)
import JSZip from "jszip";

export interface ImportedChapter { title: string; scenes: string[] }
export interface ImportedDraft {
  title: string;
  author: string | null;
  chapters: ImportedChapter[];
}

// Namespace-tolerant lookup: happy-dom and browsers disagree on namespaced tagName ("dc:title"),
// but localName is stable in both.
const byLocalName = (root: Document | Element, name: string): Element[] =>
  Array.from(root.getElementsByTagName("*")).filter((el) => el.localName?.toLowerCase() === name);

const textOf = (el: Element | undefined | null): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

// A paragraph that is purely typographic separator glyphs (asterism / dinkus) = scene break.
const isAsterism = (text: string): boolean =>
  text.length > 0 && text.length <= 30 && !/[\p{L}\p{N}]/u.test(text);

// Spine entries that are chrome, not story. Matched against manifest href + properties.
const CHROME_HREF = /(^|\/)(nav|toc|cover|title[-_]?page|copyright|colophon)[^/]*$/i;

// Publishing apparatus by TITLE (dropped whether or not the chapter carries prose).
const APPARATUS_TITLE = /^(table of )?contents\b|^copyright|^title ?page$|^dedication$|^acknowledg|^colophon$|^imprint$/i;
// Digitization boilerplate by content — Project Gutenberg headers/licenses, Distributed
// Proofreaders blurbs, transcriber notes. `.?` tolerates the curly apostrophe (transcriber’s).
const BOILERPLATE = /project gutenberg|distributed proofreaders|proofreading team|transcriber.?s note/i;

interface Block { type: "heading" | "para" | "break"; text: string }

const HEADING = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
// Blockquote is NOT a leaf: Gutenberg wraps whole structures (the TOC, chapter bodies) in
// <blockquote><div>…</div></blockquote>, and flattening one to a single para destroys the
// line structure the TOC-shape rule needs. Containers recurse; bare-text containers emit.
const LEAF = new Set(["p", "li", "pre", "dd", "dt"]);

/** Flatten a chapter document's body into an ordered block stream. */
function blocksOf(doc: Document): Block[] {
  const out: Block[] = [];
  const para = (t: string) => { if (t) out.push(isAsterism(t) ? { type: "break" as const, text: "" } : { type: "para" as const, text: t }); };
  const walk = (el: Element) => {
    const tag = el.localName?.toLowerCase() ?? "";
    if (HEADING.has(tag)) { const t = textOf(el); if (t) out.push({ type: "heading", text: t }); return; }
    if (tag === "hr") { out.push({ type: "break", text: "" }); return; }
    if (LEAF.has(tag)) { para(textOf(el)); return; }
    const kids = Array.from(el.children);
    if (!kids.length) { para(textOf(el)); return; } // bare-text container (e.g. <div>prose</div>)
    for (const child of kids) walk(child);
  };
  const body = doc.body ?? byLocalName(doc, "body")[0];
  if (body) for (const child of Array.from(body.children)) walk(child);
  return out;
}

/** Map nav.xhtml TOC entries: content href (path only, no fragment) → label of its FIRST link. */
function navLabels(doc: Document, navDir: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of byLocalName(doc, "a")) {
    const href = a.getAttribute("href");
    const label = textOf(a);
    if (!href || !label) continue;
    const path = resolvePath(navDir, href.split("#")[0]);
    if (path && !map.has(path)) map.set(path, label);
  }
  return map;
}

/** Resolve href relative to a directory inside the zip ("OEBPS" + "ch1.xhtml" → "OEBPS/ch1.xhtml"). */
function resolvePath(dir: string, href: string): string {
  const parts = (dir ? dir.split("/") : []).concat(decodeURIComponent(href).split("/"));
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

/** Parse an .epub (zip bytes) into chapters of plain-text scenes. Pure I/O over the archive. */
export async function parseEpub(data: Blob | ArrayBuffer | Uint8Array): Promise<ImportedDraft> {
  const zip = await JSZip.loadAsync(data);
  const xml = new DOMParser();
  const readText = async (path: string): Promise<string | null> => {
    const f = zip.file(path);
    if (!f) return null;
    // Drop <link> tags (happy-dom's DOMParser eagerly fetches stylesheets; browsers don't) and the
    // XML declaration (happy-dom rejects the single-quoted form `<?xml version='1.0'?>` outright).
    return (await f.async("text")).replace(/^\s*<\?xml[^>]*\?>/i, "").replace(/<link\b[^>]*>/gi, "");
  };

  // container.xml → OPF path
  const containerXml = await readText("META-INF/container.xml");
  if (!containerXml) throw new Error("Not an epub: missing META-INF/container.xml");
  const container = xml.parseFromString(containerXml, "text/xml");
  const opfPath = byLocalName(container, "rootfile")[0]?.getAttribute("full-path");
  if (!opfPath) throw new Error("Not an epub: container.xml has no rootfile");
  const opfXml = await readText(opfPath);
  if (!opfXml) throw new Error(`Not an epub: missing ${opfPath}`);
  const opf = xml.parseFromString(opfXml, "text/xml");
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";

  const title = textOf(byLocalName(opf, "title")[0]) || "Imported draft";
  const author = textOf(byLocalName(opf, "creator")[0]) || null;

  // manifest: id → {href, properties}
  const manifest = new Map<string, { href: string; properties: string }>();
  let navPath: string | null = null;
  for (const item of byLocalName(opf, "item")) {
    const id = item.getAttribute("id"), href = item.getAttribute("href");
    if (!id || !href) continue;
    const properties = item.getAttribute("properties") ?? "";
    manifest.set(id, { href, properties });
    if (/\bnav\b/.test(properties)) navPath = resolvePath(opfDir, href);
  }

  // TOC labels (used to title chapters whose file carries no heading)
  let labels = new Map<string, string>();
  if (navPath) {
    const navXml = await readText(navPath);
    if (navXml) {
      const navDir = navPath.includes("/") ? navPath.slice(0, navPath.lastIndexOf("/")) : "";
      labels = navLabels(xml.parseFromString(navXml, "text/html"), navDir);
    }
  }

  // spine → ordered content files, skipping chrome (nav/cover/toc/…)
  const files: string[] = [];
  for (const ref of byLocalName(opf, "itemref")) {
    if (ref.getAttribute("linear") === "no") continue;
    const item = manifest.get(ref.getAttribute("idref") ?? "");
    if (!item) continue;
    if (/\b(nav|cover-image)\b/.test(item.properties) || CHROME_HREF.test(item.href)) continue;
    files.push(resolvePath(opfDir, item.href));
  }

  // Segment the block stream into chapters/scenes.
  const chapters: ImportedChapter[] = [];
  let cur: { title: string; scenes: string[]; paras: string[] } | null = null;
  const flushScene = () => {
    if (cur && cur.paras.length) { cur.scenes.push(cur.paras.join("\n\n")); cur.paras = []; }
  };
  // Junk detection. A PROSE-bearing chapter is junk when its title or opening text is digitization
  // boilerplate / apparatus, its first paragraph is a contents marker (a TOC rendered as prose), or
  // it is a title page (very short + echoes the book title or author). A TITLE-ONLY chapter is junk
  // unless it reads like a real part divider (kept) — i.e. junk when untitled, apparatus-titled, or
  // echoing the book title / "by <author>".
  const isJunkProse = (t: string, scenes: string[]): boolean => {
    if (APPARATUS_TITLE.test(t) || BOILERPLATE.test(t)) return true;
    const text = scenes.join("\n\n");
    if (BOILERPLATE.test(text.slice(0, 600))) return true;
    if (/^(table of )?contents\.?$/i.test(text.split("\n", 1)[0].trim())) return true;
    // A TOC rendered as prose without a CONTENTS marker: most lines are chapter labels, not sentences.
    const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 5 && lines.filter((l) => /^(chapter|part|book|canto|act|section)\b|^[ivxlcdm]+\./i.test(l)).length / lines.length > 0.5) return true;
    if (text.split(/\s+/).length < 60) {
      const low = text.toLowerCase();
      if (low.includes(title.toLowerCase()) || (author && low.includes(author.toLowerCase()))) return true;
    }
    return false;
  };
  const isJunkTitleOnly = (t: string) =>
    !t || t.toLowerCase() === title.toLowerCase() || /^by\s/i.test(t) || APPARATUS_TITLE.test(t) || BOILERPLATE.test(t);
  const flushChapter = () => {
    flushScene();
    if (cur && (cur.scenes.length ? !isJunkProse(cur.title, cur.scenes) : !isJunkTitleOnly(cur.title))) {
      chapters.push({ title: cur.title || `Chapter ${chapters.length + 1}`, scenes: cur.scenes });
    }
    cur = null;
  };

  for (const path of files) {
    const raw = await readText(path);
    if (!raw) continue;
    flushChapter();
    cur = { title: labels.get(path) ?? "", scenes: [], paras: [] };
    for (const b of blocksOf(xml.parseFromString(raw, "text/html"))) {
      if (b.type === "heading") {
        // Before any prose: retitle (collapses cover blocks + duplicate section/content headings).
        if (!cur || (!cur.scenes.length && !cur.paras.length)) {
          cur = { title: b.text, scenes: [], paras: [] };
        } else { flushChapter(); cur = { title: b.text, scenes: [], paras: [] }; }
      } else if (b.type === "break") flushScene();
      else cur!.paras.push(b.text);
    }
  }
  flushChapter();

  return { title, author, chapters };
}
