import { markdownToHtml } from "@/lib/digest/render";
import type { IssueContent } from "@/lib/digest/types";

// The body of one rendered issue — shared between the live issue page and an archived-version page, so a
// regenerate's old and new renders read identically.
export function IssueContentView({ content }: { content: IssueContent }) {
  return (
    <>
      {content.intro && (
        <div className="prose-digest text-lg" dangerouslySetInnerHTML={{ __html: markdownToHtml(content.intro) }} />
      )}

      {content.sections.map((s) => (
        <section key={s.id} className="space-y-2">
          <h2 className="text-xl">{s.title}</h2>
          {/* Sanitized upstream: this HTML comes from our own markdownToHtml, which escapes before it
              re-introduces the small set of tags it supports. */}
          <div
            className="prose-digest space-y-3"
            dangerouslySetInnerHTML={{ __html: markdownToHtml(s.markdown, { items: s.items }) }}
          />
          {s.items.length > 0 && (
            <ul className="pt-1 font-mono text-xs text-muted">
              {s.items.filter((i) => i.url).map((i) => (
                <li key={i.url}>
                  <a href={i.url} className="hover:underline" target="_blank" rel="noreferrer">
                    {i.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {content.sections.length === 0 && <p className="text-muted">Nothing was published in this issue.</p>}
    </>
  );
}
