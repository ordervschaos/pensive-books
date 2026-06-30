// BookLookControls — the book-level "look" picker shared by Foundations (the house-look panel) and the
// Scene level (in-place while generating). One surface: theme presets (fill art_direction), an optional
// custom fine-tune box, and the render-model toggle (gemini-3 ↔ 2.5-flash). All three live on
// books.foundations so every illustration in the book inherits them — change them here or there, same
// fields. Presentational: the host owns the values + onPatch (full-object save in Foundations, merge
// patch on the Scene surface).
import { AutoTextarea } from "@/components/ui/auto-textarea";
import {
  ART_THEMES, DEFAULT_IMAGE_MODEL, IMAGE_MODEL_OPTIONS, type Foundations,
} from "@/lib/foundations";
import { Eyebrow } from "@/components/book/shared/studioUi";

const chip = (on: boolean) =>
  `pv-serif rounded-full border px-3 py-1 text-[13px] transition-colors ${
    on ? "border-[hsl(var(--pv-accent))] bg-[hsl(var(--pv-accent))]/[0.1] text-[hsl(var(--pv-accent))]"
      : "border-[hsl(var(--pv-border-soft))] text-[hsl(var(--pv-text-muted))] hover:border-foreground/30"
  }`;

export function BookLookControls({ artTheme, artDirection, imageModel, onPatch, showCustomText = true, showThemes = true }: {
  artTheme?: string;
  artDirection?: string;
  imageModel?: string;
  onPatch: (patch: Partial<Foundations>) => void;
  /** Foundations shows the free-text fine-tune box; the compact Scene bar hides it. */
  showCustomText?: boolean;
  /** The Scene surface picks STYLE per-compose in the generator, so it hides the book-default theme chips
   *  and keeps only the render-model toggle. */
  showThemes?: boolean;
}) {
  const theme = artTheme ?? "";
  const model = imageModel ?? DEFAULT_IMAGE_MODEL;
  const value = artDirection ?? "";
  return (
    <div>
      {showThemes && (
        <div className="flex flex-wrap gap-1.5">
          {ART_THEMES.map((t) => (
            <button key={t.id} type="button" title={t.hint} onClick={() => onPatch({ art_theme: t.id, art_direction: t.prompt })} className={chip(theme === t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {showCustomText && (
        <AutoTextarea
          key={value /* refresh the uncontrolled box when a chip swaps the text */}
          defaultValue={value}
          placeholder="Medium, palette, line, era — pick a theme above or write your own. Every scene and portrait inherits this."
          onBlur={(e) => { const v = e.target.value.trim(); if (v !== value) onPatch({ art_direction: v, art_theme: v ? "custom" : "" }); }}
          className="mt-3 pv-serif border-b border-transparent bg-transparent px-0 py-0 text-[14.5px] leading-relaxed text-foreground focus-visible:ring-0 placeholder:text-[hsl(var(--pv-text-faint))] hover:border-[hsl(var(--pv-border-soft))] transition-colors"
        />
      )}

      <div className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 ${showThemes || showCustomText ? "mt-3 border-t border-[hsl(var(--pv-border-soft))] pt-3" : ""}`}>
        <Eyebrow tone="muted" className="mr-1">render model</Eyebrow>
        {IMAGE_MODEL_OPTIONS.map((m) => (
          <button key={m.id} type="button" title={m.hint} onClick={() => onPatch({ image_model: m.id })} className={chip(model === m.id)}>
            {m.label}
          </button>
        ))}
        <span className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))]">
          {IMAGE_MODEL_OPTIONS.find((m) => m.id === model)?.hint}
        </span>
      </div>
    </div>
  );
}
