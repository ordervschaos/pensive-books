// ImagePromptPreview — reusable editable prompt preview gate used before any image generation in
// picture-book mode. Shows the composed prompt (editable), reference image thumbnails (if any), and
// the model that will be used. The author edits the prompt, then clicks Generate or Cancel.
//
// Use for: scene NodeCard illustrate, DnaVisuals per-scene re-illustrate + bulk stepper, and the
// portrait "design the look" step. Compose with studioUi primitives + Paper-DS tokens.
import { useState } from "react";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { ActionLink, Eyebrow, Panel, RunningInline } from "@/components/book/shared/studioUi";
import { Sparkles, X } from "lucide-react";
import { IMAGE_MODEL_OPTIONS } from "@/lib/foundations";

export function ImagePromptPreview({
  prompt,
  refImages,
  model,
  context,
  busy,
  generateLabel = "generate image",
  onGenerate,
  onCancel,
}: {
  prompt: string;
  refImages: string[];
  model: string | null;
  /** The full upstream context the prompt was drawn from (beat, cast, house look, art direction). Read-only. */
  context?: string;
  busy?: boolean;
  generateLabel?: string;
  onGenerate: (finalPrompt: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(prompt);
  // Re-seed the editable draft if the upstream prompt changes (e.g. the bulk stepper advances to a new scene).
  const [seed, setSeed] = useState(prompt);
  if (seed !== prompt) { setSeed(prompt); setDraft(prompt); }

  // Resolve the model key to a human label via the same options list the foundations UI uses.
  const modelLabel = model
    ? (IMAGE_MODEL_OPTIONS.find((o) => o.id === model)?.label ?? model)
    : "default";

  return (
    <Panel variant="soft" className="mt-3 space-y-3 px-4 py-3">
      {/* The full context the prompt is drawn from — read-only, collapsible (open by default so it's seen). */}
      {context && (
        <details open className="group">
          <summary className="pv-mono cursor-pointer list-none text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))] hover:text-[hsl(var(--pv-text-muted))]">
            context · what the image is drawn from
          </summary>
          <pre className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-[hsl(var(--pv-border-soft))]/60 bg-[hsl(var(--pv-surface-2))]/40 p-2.5 pv-mono text-[10.5px] leading-relaxed text-[hsl(var(--pv-text-muted))]">
            {context}
          </pre>
        </details>
      )}

      {/* Header */}
      <Eyebrow tone="muted">prompt · edit before generating</Eyebrow>

      {/* Editable prompt text — stays visible (just disabled) while generating, so it never vanishes. */}
      <AutoTextarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={busy}
        placeholder="Image prompt…"
        className="pv-mono w-full resize-none rounded-md border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/30 px-2.5 py-2 text-[12px] leading-relaxed text-foreground outline-none focus:border-[hsl(var(--pv-accent))]/50 focus-visible:ring-0 disabled:opacity-60"
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
