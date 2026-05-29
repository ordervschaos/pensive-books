import { Globe, BookOpen, Download } from "lucide-react";
import { UIFrame } from "../UIFrame";

const SHELF = [
  { bg: "#1f2d44", text: "#e8dcc4", title: "Salt & Lamplight" },
  { bg: "#6b1f1f", text: "#f0e6d2", title: "The Second Keeper" },
  { bg: "#2d4a3e", text: "#e8e2cc", title: "Tidewrack" },
];

/**
 * Publish — the book-detail header with its actions bar (the real Globe
 * "Publish" control, mirrored from BookVisibilityToggle), then the book
 * appearing in the public library shelf.
 */
export function PublishMock() {
  return (
    <UIFrame crumb="Salt & Lamplight">
      {/* Book detail header */}
      <div className="flex items-center gap-4">
        <div
          className="aspect-[4/5] w-[72px] flex-none overflow-hidden rounded-[3px] border border-border shadow-sm"
          style={{ backgroundColor: "#1f2d44" }}
        >
          <div className="flex h-full items-center justify-center px-1.5 text-center">
            <span className="pv-display text-[11px] italic leading-tight" style={{ color: "#e8dcc4" }}>
              Salt &amp; Lamplight
            </span>
          </div>
        </div>
        <div className="min-w-0">
          <h3 className="pv-display text-[22px] italic leading-tight text-foreground">
            Salt &amp; Lamplight
          </h3>
          <p className="pv-serif text-[13px] text-[hsl(var(--pv-text-muted))]">
            by Mara Vance · 24 pages
          </p>
          {/* Actions bar */}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="pv-sans inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background">
              <Globe className="h-3.5 w-3.5" /> Publish
            </span>
            <span className="pv-sans inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-[hsl(var(--pv-text-muted))]">
              <BookOpen className="h-3.5 w-3.5" /> Read
            </span>
            <span className="pv-sans inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-[hsl(var(--pv-text-muted))]">
              <Download className="h-3.5 w-3.5" /> EPUB
            </span>
          </div>
        </div>
      </div>

      <div className="my-4 flex items-center gap-2 text-[hsl(var(--pv-text-faint))]">
        <span className="h-px flex-1 bg-border" />
        <span className="pv-mono text-[10px] uppercase tracking-[0.15em]">
          live in the library
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* The public library shelf */}
      <div className="grid grid-cols-3 gap-3">
        {SHELF.map((b) => (
          <div
            key={b.title}
            className="aspect-[4/5] overflow-hidden rounded-[3px] border border-border shadow-sm"
            style={{ backgroundColor: b.bg }}
          >
            <div className="flex h-full items-center justify-center px-2 text-center">
              <span
                className="pv-display text-[13px] italic leading-tight"
                style={{ color: b.text }}
              >
                {b.title}
              </span>
            </div>
          </div>
        ))}
      </div>
    </UIFrame>
  );
}
