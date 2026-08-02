import {
  markdownToHtml,
  issueStyles,
  isVerbatimSection,
  itemAnchor,
  readingMinutes,
} from "@/lib/digest/render";
import type { IssueContent, RenderedSection } from "@/lib/digest/types";

// The body of one rendered issue — shared between the live issue page and an archived-version page, so a
// regenerate's old and new renders read identically.
//
// An issue runs to twenty-odd screens, so the two things it owes the reader are a MAP (what is in here, how
// long is it, take me there) and LANDMARKS (where am I now). The map is `<Contents>`; the landmark is a
// sticky section header. Both are plain HTML — `<details>` collapses without a line of JavaScript and
// `position: sticky` pins without an IntersectionObserver — which matters because this is a Server
// Component and the alternative is shipping a bundle to render a list of links.

const sectionAnchor = (id: string) => `s-${id}`;

function sectionMeta(s: RenderedSection): string {
  const items = s.items.length ? `${s.items.length} item${s.items.length === 1 ? "" : "s"}` : "";
  return [items, `${readingMinutes(s.markdown)} min`].filter(Boolean).join(" · ");
}

// The outline is derived from `content.sections[].items` — the DATA — not by parsing the rendered HTML for
// headings. Parsing the render would couple the outline to the renderer and break the moment a section is
// AI-written, because that path weaves its sources into prose and has no per-article structure to find.
//
// Which is also why only VERBATIM sections get a second level: there, one item is one article with its own
// heading to jump to. In an AI-written section the items are sources behind the prose, not destinations —
// they are listed under the section itself instead, where "reference" is the honest reading.
function Contents({ sections }: { sections: RenderedSection[] }) {
  if (sections.length < 2) return null;

  const items = sections.reduce((n, s) => n + s.items.length, 0);
  const minutes = sections.reduce((n, s) => n + readingMinutes(s.markdown), 0);

  return (
    <details open className="border-y border-rule py-3">
      <summary className="cursor-pointer select-none font-mono text-xs uppercase tracking-wider text-muted">
        Contents · {items} items · {minutes} min
      </summary>
      <ol className="mt-3 space-y-2.5">
        {sections.map((s) => (
          <li key={s.id}>
            <a href={`#${sectionAnchor(s.id)}`} className="hover:underline">
              {s.title}
            </a>
            <span className="ml-2 font-mono text-[11px] text-muted">{sectionMeta(s)}</span>
            {isVerbatimSection(s.markdown) && s.items.length > 0 && (
              <ol className="mt-1 space-y-1 pl-4 text-sm">
                {s.items.map((i, n) => (
                  <li key={`${s.id}-${n}`}>
                    <a href={`#${itemAnchor(s.id, n + 1)}`} className="text-muted hover:text-ink">
                      {i.title}
                    </a>
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

export function IssueContentView({ content }: { content: IssueContent }) {
  return (
    <>
      {/* The reader used to style issue markdown from globals.css while the mailed HTML and the preview both
          used `issueStyles`, so the one thing that page renders was the one place the rules were rewritten by
          hand — and headline links, which the citation rule doesn't cover, came out browser-default blue.
          Same function, scoped to the wrapper class. */}
      <style dangerouslySetInnerHTML={{ __html: issueStyles(".prose-digest") }} />

      {content.intro && (
        <div className="prose-digest text-lg" dangerouslySetInnerHTML={{ __html: markdownToHtml(content.intro) }} />
      )}

      <Contents sections={content.sections} />

      {content.sections.map((s) => {
        const verbatim = isVerbatimSection(s.markdown);
        return (
          <section key={s.id} id={sectionAnchor(s.id)} className="scroll-mt-16 border-t border-rule">
            {/* Sticky, so the answer to "which section am I in" survives eight screens of scrolling. It needs
                an opaque background or the prose runs underneath it. */}
            <div className="sticky top-0 z-10 flex items-baseline justify-between gap-4 border-b border-rule bg-paper pb-2 pt-3">
              <h2 className="text-xl">{s.title}</h2>
              <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-muted">
                {sectionMeta(s)}
              </span>
            </div>

            {/* Sanitized upstream: this HTML comes from our own markdownToHtml, which escapes before it
                re-introduces the small set of tags it supports. */}
            {/* No `space-y-*` here: paragraph rhythm belongs to `issueStyles`, so the reader, the preview and
                the mailed copy all space the same way. */}
            <div
              className="prose-digest"
              dangerouslySetInnerHTML={{
                __html: markdownToHtml(s.markdown, {
                  items: s.items,
                  citations: !verbatim,
                  anchorPrefix: s.id,
                  trustImageUrls: verbatim,
                }),
              }}
            />

            {/* Sources, listed only where they aren't already visible. A verbatim section renders each item
                as its own headed article and lists them again in the Contents above — a third copy at the
                foot is noise. An AI-written section weaves them into prose, so this is the only place the
                reader can see what it was built from. */}
            {!verbatim && s.items.length > 0 && (
              <ul className="pt-3 font-mono text-xs text-muted">
                {s.items
                  .filter((i) => i.url)
                  .map((i) => (
                    <li key={i.url}>
                      <a href={i.url} className="hover:underline" target="_blank" rel="noreferrer">
                        {i.title}
                      </a>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        );
      })}

      {content.sections.length === 0 && <p className="text-muted">Nothing was published in this issue.</p>}
    </>
  );
}
