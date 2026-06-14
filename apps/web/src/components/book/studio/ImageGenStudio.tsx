// ImageGenStudio — the shared, prompt-first image generator both the Scene level (PageReview) and the
// "design the look" portrait step (FoundationsStep) compose. One surface, identical capabilities:
//
//   compose an editable PROMPT → optionally attach author REFERENCE images → GENERATE → review →
//   commit. Or skip AI entirely and UPLOAD an image directly.
//
// `multiSelect` is the one axis of difference: portraits keep a SET (generate variants / different
// angles, add the ones you like, stay open) while a scene commits one image and closes. The hosts pass
// the surface-specific `compose` / `render` / `onAdd` / `uploadDirect` and own persistence.
import { useRef, useState } from "react";
import { ImageIcon, Loader2, Plus, RefreshCw, Sparkles, Upload, X } from "lucide-react";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { useToast } from "@/hooks/use-toast";
import { ActionLink, Eyebrow } from "./studioUi";

interface Props {
  /** LLM-compose an editable prompt from the host's context, optionally steered by author direction. */
  compose: (instruction?: string) => Promise<string>;
  /** Render image(s) from the (edited) prompt + author reference URLs. Returns the resulting URLs. */
  render: (prompt: string, refUrls: string[]) => Promise<string[]>;
  /** Upload an author reference image, return its URL (added to the reference set, not committed). */
  uploadRef: (file: File) => Promise<string>;
  /** Commit a generated/chosen URL (portrait: add to the set; scene: no-op, the row is inserted). */
  onAdd: (url: string) => Promise<void> | void;
  /** Upload a file and commit it directly as a final image (skips AI). */
  uploadDirect: (file: File) => Promise<void>;
  onFullscreen: (url: string) => void;
  multiSelect?: boolean;
  startLabel: string;
  generateLabel?: string;
}

type Phase = "idle" | "composing" | "ready" | "rendering";

export function ImageGenStudio({ compose, render, uploadRef, onAdd, uploadDirect, onFullscreen, multiSelect, startLabel, generateLabel }: Props) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>("idle");
  const [direction, setDirection] = useState("");
  const [prompt, setPrompt] = useState("");
  const [refUrls, setRefUrls] = useState<string[]>([]);
  const [variants, setVariants] = useState<string[]>([]);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [uploadingRef, setUploadingRef] = useState(false);
  const [uploadingDirect, setUploadingDirect] = useState(false);
  const refInput = useRef<HTMLInputElement>(null);
  const directInput = useRef<HTMLInputElement>(null);

  const fail = (title: string, e: unknown) => toast({ variant: "destructive", title, description: String((e as Error)?.message ?? e) });
  const reset = () => { setPhase("idle"); setDirection(""); setPrompt(""); setRefUrls([]); setVariants([]); setAdded(new Set()); };

  const startCompose = async () => {
    setPhase("composing"); setVariants([]); setAdded(new Set());
    try { setPrompt(await compose(direction.trim() || undefined)); setPhase("ready"); }
    catch (e) { fail("Couldn't compose the prompt", e); setPhase("idle"); }
  };

  const doRender = async () => {
    if (!prompt.trim()) return;
    setPhase("rendering");
    try {
      const urls = await render(prompt.trim(), refUrls);
      if (!multiSelect) { if (urls[0]) await onAdd(urls[0]); reset(); }
      else { setVariants((v) => [...urls, ...v]); setPhase("ready"); }
    } catch (e) { fail("Couldn't generate the image", e); setPhase("ready"); }
  };

  const add = async (url: string) => {
    try { await onAdd(url); setAdded((s) => new Set(s).add(url)); }
    catch (e) { fail("Couldn't add the image", e); }
  };

  const addRefs = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploadingRef(true);
    try { const urls = await Promise.all(Array.from(files).map(uploadRef)); setRefUrls((r) => [...r, ...urls]); }
    catch (e) { fail("Couldn't upload reference", e); }
    finally { setUploadingRef(false); if (refInput.current) refInput.current.value = ""; }
  };

  const doDirect = async (file: File | undefined) => {
    if (!file) return;
    setUploadingDirect(true);
    try { await uploadDirect(file); reset(); }
    catch (e) { fail("Couldn't upload the image", e); }
    finally { setUploadingDirect(false); if (directInput.current) directInput.current.value = ""; }
  };

  // Hidden inputs (always mounted so refs are stable).
  const inputs = (
    <>
      <input ref={refInput} type="file" accept="image/*" multiple hidden onChange={(e) => void addRefs(e.target.files)} />
      <input ref={directInput} type="file" accept="image/*" hidden onChange={(e) => void doDirect(e.target.files?.[0])} />
    </>
  );

  if (phase === "idle") {
    return (
      <div>
        {inputs}
        <AutoTextarea
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          placeholder="Art direction (optional) — mood, framing, lighting, time of day, palette… steers the prompt."
          className="mb-3 pv-serif border-[hsl(var(--pv-border-soft))] bg-transparent text-[13.5px] leading-relaxed focus-visible:ring-0"
        />
        <div className="flex flex-wrap items-center gap-5">
          <button
            type="button"
            onClick={() => void startCompose()}
            className="pv-serif inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[hsl(var(--pv-accent))]/[0.08] px-4 py-2 text-[14px] text-[hsl(var(--pv-accent))] transition-colors hover:bg-[hsl(var(--pv-accent))]/[0.14]"
          >
            <Sparkles className="h-3.5 w-3.5" /> {startLabel}
          </button>
          <ActionLink icon={<Upload className="h-3.5 w-3.5" />} tone="muted" busy={uploadingDirect} onClick={() => directInput.current?.click()}>
            {uploadingDirect ? "uploading…" : "or upload an image"}
          </ActionLink>
        </div>
      </div>
    );
  }

  if (phase === "composing") {
    return <p className="pv-serif inline-flex items-center gap-2 text-[14px] italic text-[hsl(var(--pv-text-muted))]"><Loader2 className="h-4 w-4 animate-spin" /> Composing the prompt…</p>;
  }

  return (
    <div className="rounded-2xl border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 px-5 py-4">
      {inputs}
      <Eyebrow tone="muted">prompt — edit before generating</Eyebrow>
      <AutoTextarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        className="mt-1.5 pv-serif border-[hsl(var(--pv-border-soft))] bg-transparent text-[14px] leading-relaxed focus-visible:ring-0"
      />

      {/* Author reference images, fed into the generation. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {refUrls.map((u) => (
          <div key={u} className="relative">
            <img src={u} alt="reference" className="h-12 w-12 cursor-zoom-in rounded-md border border-[hsl(var(--pv-border-soft))] object-cover" onClick={() => onFullscreen(u)} />
            <button type="button" onClick={() => setRefUrls((r) => r.filter((x) => x !== u))} className="absolute -right-1.5 -top-1.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80" aria-label="Remove reference">
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <ActionLink icon={<Plus className="h-3.5 w-3.5" />} tone="muted" busy={uploadingRef} onClick={() => refInput.current?.click()}>
          {uploadingRef ? "uploading…" : "add reference image"}
        </ActionLink>
      </div>

      {phase === "rendering" ? (
        <p className="pv-serif mt-3 inline-flex items-center gap-2 text-[14px] italic text-[hsl(var(--pv-text-muted))]"><Loader2 className="h-4 w-4 animate-spin" /> Generating…</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-5">
          <button
            type="button"
            onClick={() => void doRender()}
            className="pv-serif inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[hsl(var(--pv-accent))]/[0.08] px-4 py-2 text-[14px] text-[hsl(var(--pv-accent))] transition-colors hover:bg-[hsl(var(--pv-accent))]/[0.14]"
          >
            <ImageIcon className="h-3.5 w-3.5" /> {generateLabel ?? (multiSelect ? "Generate variants" : "Generate image")}
          </button>
          <ActionLink icon={<RefreshCw className="h-3.5 w-3.5" />} tone="muted" onClick={() => void startCompose()}>recompose</ActionLink>
          <ActionLink tone="faint" onClick={reset}>{multiSelect ? "done" : "cancel"}</ActionLink>
        </div>
      )}

      {/* Variant chooser (multiSelect / portraits). */}
      {variants.length > 0 && (
        <div className="mt-4">
          <Eyebrow tone="muted">variants — add the ones you want</Eyebrow>
          <div className="mt-2 grid grid-cols-3 gap-2.5">
            {variants.map((u) => (
              <div key={u} className="group relative overflow-hidden rounded-lg border border-[hsl(var(--pv-border-soft))]">
                <img src={u} alt="variant" className="aspect-square w-full cursor-zoom-in object-cover" onClick={() => onFullscreen(u)} />
                <button
                  type="button"
                  onClick={() => void add(u)}
                  disabled={added.has(u)}
                  className="absolute inset-x-0 bottom-0 bg-black/55 py-1 pv-serif text-[12px] text-white transition-colors hover:bg-black/75 disabled:opacity-100"
                >
                  {added.has(u) ? "✓ added" : "add"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
