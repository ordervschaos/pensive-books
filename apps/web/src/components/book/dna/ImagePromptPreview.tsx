// ImagePromptPreview — reusable editable prompt preview gate used before any image generation in
// picture-book mode. Shows the composed prompt (editable), reference image thumbnails (if any), and
// the model that will be used. The author edits the prompt, then clicks Generate or Cancel.
//
// Use for: scene NodeCard illustrate, DnaVisuals per-scene re-illustrate + bulk stepper, and the
// portrait "design the look" step. Compose with studioUi primitives + Paper-DS tokens.
import { useState } from "react";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { ActionLink, Eyebrow, Panel, RunningInline } from "@/components/book/studio/studioUi";
import { Sparkles, X } from "lucide-react";
import { IMAGE_MODEL_OPTIONS } from "@/lib/foundations";

export function ImagePromptPreview({
  prompt,
  refImages,
  model,
  busy,
  generateLabel = "generate image",
  onGenerate,
  onCancel,
}: {
  prompt: string;
  refImages: string[];
  model: string | null;
  busy?: boolean;
  generateLabel?: string;
  onGenerate: (finalPrompt: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(prompt);

  // Resolve the model key to a human label via the same options list the foundations UI uses.
  const modelLabel = model
    ? (IMAGE_MODEL_OPTIONS.find((o) => o.id === model)?.label ?? model)
    : "default";

  return (
    <Panel variant="soft" className="mt-3 space-y-3 px-4 py-3">
      {/* Header */}
      <Eyebrow tone="muted">prompt · edit before generating</Eyebrow>

      {/* Editable prompt text */}
      <AutoTextarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={busy}
        placeholder="Image prompt…"
        className="pv-mono w-full resize-none border-0 border-b border-[hsl(var(--pv-border-soft))] bg-transparent px-0 py-0.5 text-[12px] leading-relaxed text-foreground outline-none focus:border-[hsl(var(--pv-accent))]/40 focus-visible:ring-0 disabled:opacity-60"
      />

      {/* Reference thumbnails */}
      {refImages.length > 0 ? (
        <div className="space-y-1">
          <span className="pv-mono text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">
            reference portraits
          </span>
          <div className="flex flex-wrap gap-2">
            {refImages.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`reference ${i + 1}`}
                className="h-12 w-12 rounded-md border border-[hsl(var(--pv-border-soft))] object-cover"
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="pv-mono text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">
          no reference portraits
        </p>
      )}

      {/* Model label */}
      <p className="pv-mono text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">
        model · <span className="text-[hsl(var(--pv-text-muted))]">{modelLabel}</span>
      </p>

      {/* Actions */}
      {busy ? (
        <RunningInline label="generating…" />
      ) : (
        <div className="flex items-center gap-4 border-t border-[hsl(var(--pv-border-soft))]/60 pt-2.5">
          <ActionLink
            icon={<Sparkles className="h-3.5 w-3.5" />}
            onClick={() => onGenerate(draft.trim())}
            disabled={!draft.trim()}
          >
            {generateLabel}
          </ActionLink>
          <ActionLink
            icon={<X className="h-3.5 w-3.5" />}
            tone="faint"
            onClick={onCancel}
          >
            cancel
          </ActionLink>
        </div>
      )}
    </Panel>
  );
}
