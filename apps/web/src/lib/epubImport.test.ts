// epubImport tests: a hand-built "standard" multi-file epub (Calibre/Scrivener shape) and a
// round-trip through Pensive's OWN export generators (single-file shape) — decode(encode(book)).
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseEpub } from "./epubImport";
import { generateContainerXml, generateContentOpf, generateNavXhtml, generateContentXhtml } from "./epub";

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const xhtml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>${body}</body></html>`;

async function standardEpub(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("META-INF/container.xml", CONTAINER);
  zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="BookId" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>The Long Way</dc:title>
    <dc:creator>Jane Q. Writer</dc:creator>
    <dc:identifier id="BookId">urn:uuid:test</dc:identifier>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="intro" href="intro.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch3" href="text/ch3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="cover"/><itemref idref="intro"/><itemref idref="ch1"/><itemref idref="ch2"/><itemref idref="ch3"/>
  </spine>
</package>`);
  zip.file("OEBPS/nav.xhtml", xhtml(`<nav epub:type="toc"><ol>
    <li><a href="ch1.xhtml">One: The Door</a></li>
    <li><a href="ch2.xhtml">Two: The Key</a></li>
    <li><a href="text/ch3.xhtml">Epilogue</a></li>
  </ol></nav>`));
  // cover.xhtml is skipped by href; intro.xhtml is a title page that must be dropped as front matter.
  zip.file("OEBPS/cover.xhtml", xhtml(`<div><img src="c.jpg" alt="cover"/></div>`));
  zip.file("OEBPS/intro.xhtml", xhtml(`<h1>The Long Way</h1>`));
  zip.file("OEBPS/ch1.xhtml", xhtml(`<h1>One: The Door</h1>
    <p>Mara found the door on a Tuesday.</p><p>It had not been there on Monday.</p>
    <p>* * *</p>
    <p>By night she had convinced herself it was ordinary.</p>`));
  zip.file("OEBPS/ch2.xhtml", xhtml(`<h1>Two: The Key</h1>
    <p>The key arrived by post.</p>
    <hr/>
    <p>She did not open the door. Not yet.</p>`));
  // ch3 has NO in-file heading — the title must come from the nav TOC.
  zip.file("OEBPS/text/ch3.xhtml", xhtml(`<p>Years later, the door was a story she told badly.</p>`));
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("parseEpub — standard multi-file epub", () => {
  it("extracts metadata, chapters, scene breaks, and TOC-labelled chapters; drops chrome", async () => {
    const draft = await parseEpub(await standardEpub());
    expect(draft.title).toBe("The Long Way");
    expect(draft.author).toBe("Jane Q. Writer");
    expect(draft.chapters.map((c) => c.title)).toEqual(["One: The Door", "Two: The Key", "Epilogue"]);
    expect(draft.chapters[0].scenes).toHaveLength(2); // asterism break
    expect(draft.chapters[0].scenes[0]).toBe("Mara found the door on a Tuesday.\n\nIt had not been there on Monday.");
    expect(draft.chapters[1].scenes).toHaveLength(2); // <hr/> break
    expect(draft.chapters[2].scenes).toEqual(["Years later, the door was a story she told badly."]);
  });
});

describe("parseEpub — round-trip through Pensive's own export", () => {
  it("recovers chapters and scenes from the single-file export shape", async () => {
    type Page = Parameters<typeof generateContentXhtml>[1][number];
    const doc = (title: string, paras: string[]) => ({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
        ...paras.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })),
      ],
    });
    const pages = [
      { page_type: "section", title: "Chapter One", content: null, metadata: {} },
      { page_type: "text", title: "Chapter One", content: doc("Chapter One", ["The rain began at noon.", "* * *", "It ended at midnight."]), metadata: {} },
      { page_type: "section", title: "Chapter Two", content: null, metadata: {} },
      { page_type: "text", title: "Chapter Two", content: doc("Chapter Two", ["Nothing was dry for weeks."]), metadata: {} },
    ] as unknown as Page[];
    const metadata = { title: "Rainbook", author: "A. Author", identifier: "test-id" };

    const zip = new JSZip();
    zip.file("META-INF/container.xml", generateContainerXml());
    zip.file("OEBPS/content.opf", generateContentOpf(metadata, []));
    zip.file("OEBPS/nav.xhtml", generateNavXhtml(pages));
    zip.file("OEBPS/content.xhtml", generateContentXhtml(metadata, pages, true));
    const draft = await parseEpub(await zip.generateAsync({ type: "arraybuffer" }));

    expect(draft.title).toBe("Rainbook");
    expect(draft.author).toBe("A. Author");
    // The cover block (book title + "by …") collapses into the first chapter's retitles; the
    // duplicated section-page/content-page headings collapse into one chapter each.
    expect(draft.chapters.map((c) => c.title)).toEqual(["Chapter One", "Chapter Two"]);
    expect(draft.chapters[0].scenes).toEqual(["The rain began at noon.", "It ended at midnight."]);
    expect(draft.chapters[1].scenes).toEqual(["Nothing was dry for weeks."]);
  });
});
