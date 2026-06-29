// DnaLookPanel — the book-wide "house look" picker for picture-book mode (docs/picture-book-mode.md). The
// art_direction it sets is folded into EVERY scene illustration AND character portrait's STYLE line, so the
// whole picture book reads as one book. Same books.foundations fields the Build Studio's Scene tab edits
// (via useBookLook) — change it here or there, one source. Only mounted in picture mode.
import { BookLookControls } from "@/components/book/studio/BookLookControls";
import { Eyebrow, Panel } from "@/components/book/shared/studioUi";
import { useBookLook } from "@/hooks/useBookLook";

export function DnaLookPanel({ bookId }: { bookId: number }) {
  const { look, patchLook } = useBookLook(bookId);
  return (
    <Panel variant="soft" className="px-4 py-3">
      <Eyebrow tone="muted">the look · every scene &amp; portrait</Eyebrow>
      <p className="pv-serif mt-1 mb-2.5 text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
        The book's visual style — pick a theme or write your own. Every illustration inherits it.
      </p>
      <BookLookControls
        artTheme={look.art_theme}
        artDirection={look.art_direction}
        imageModel={look.image_model}
        onPatch={(p) => void patchLook(p)}
      />
    </Panel>
  );
}
