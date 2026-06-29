// ImageGenStudio — the shared image generator both the Scene level (PageReview) and the "design the
// look" portrait step (FoundationsStep) compose. One surface, identical capabilities.
//
// DEFAULT FLOW is ONE-SHOT: press the primary button → an LLM composes the prompt AND renders the
// image in a single gesture. It then lands on the (editable) composed prompt so the author can refine
// and regenerate. Secondary paths: "compose & edit first" (review the prompt before spending a
// generation), "write the prompt myself", or skip AI and UPLOAD an image directly.
//
// `multiSelect` is the one axis of difference: portraits keep a SET (generate variants / different
// angles, add the ones you like, stay open) while a scene commits each render straight to its gallery.
// The hosts pass the surface-specific `compose` / `render` / `onAdd` / `uploadDirect` and own persistence.
import { useEffect, useRef, useState } from "react";
import { ImageIcon, Loader2, Plus, RefreshCw, Sparkles, Upload, X } from "lucide-react";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { useToast } from "@/hooks/use-toast";
import { ActionLink, Eyebrow } from "@/components/book/shared/studioUi";

export interface StyleTheme { id: string; label: string; prompt: string; hint?: string }

interface Props {
  /** LLM-compose an editable prompt from the host's context, optionally steered by author direction and
   *  by a chosen STYLE (the art-direction text the composer must honour for the prompt's STYLE line). */
  compose: (instruction?: string, style?: string) => Promise<string>;
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
  /** When given, a STYLE selector is shown by compose/recompose. The picked theme IS the book look (the
   *  host persists it) and steers the next compose's STYLE line — so switching + recompose sweeps styles. */
  styleThemes?: StyleTheme[];
  /** Controlled selection — the book's current theme id (host-persisted). */
  styleId?: string;
  /** Persist a new book look + use it for the next compose. */
  onStyleChange?: (id: string) => void;
  /** When given, the primary button runs a DURABLE one-shot (compose+render server-side, survives leaving)
   *  instead of the client compose→render. Fire-and-forget: the result lands in the host's gallery. */
  oneShot?: (instruction?: string, style?: string) => Promise<void>;
  /** Load a saved prompt into the editor for revision (e.g. "revise" on a gallery image). The `nonce`
   *  makes repeat loads of the same text re-trigger. */
  loadPrompt?: { text: string; nonce: number };
  /** The page's most recent saved prompt — seeded into the editor ONCE on open (idle-guarded), so
   *  opening/refreshing a page restores the last prompt for revision instead of a blank field. */
  initialPrompt?: string;
}

type Phase = "idle" | "composing" | "ready" | "rendering";

// Swap ONLY the STYLE line of a structured prompt (SUBJECT/…/STYLE/EXCLUDE) — so changing style is an
// instant line edit, not an LLM recompose (the rest of the prompt is style-independent). Inserts a STYLE
// line (before EXCLUDE if present) when the prompt has none.
function replaceStyleLine(prompt: string, styleText: string): string {
  const lines = prompt.split("\n");
  const i = lines.findIndex((l) => /^\s*STYLE\s*:/i.test(l));
  if (i !== -1) {
    lines[i] = lines[i].replace(/^(\s*STYLE\s*:).*/i, `$1 ${styleText}`);
    return lines.join("\n");
  }
  const styleLine = `STYLE: ${styleText}`;
  const ei = lines.findIndex((l) => /^\s*EXCLUDE\s*:/i.test(l));
  return ei === -1 ? [...lines, styleLine].join("\n") : [...lines.slice(0, ei), styleLine, ...lines.slice(ei)].join("\n");
}

export function ImageGenStudio({ compose, render, uploadRef, onAdd, uploadDirect, onFullscreen, multiSelect, startLabel, generateLabel, styleThemes, styleId, onStyleChange, oneShot, loadPrompt, initialPrompt }: Props) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>("idle");
  const [direction, setDirection] = useState("");
  const [prompt, setPrompt] = useState("");
  const [refUrls, setRefUrls] = useState<string[]>([]);
  const [variants, setVariants] = useState<string[]>([]);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [rendered, setRendered] = useState(false); // a generation has happened this session
  const [uploadingRef, setUploadingRef] = useState(false);
  const [uploadingDirect, setUploadingDirect] = useState(false);
  const refInput = useRef<HTMLInputElement>(null);
  const directInput = useRef<HTMLInputElement>(null);

  const fail = (title: string, e: unknown) => toast({ variant: "destructive", title, description: String((e as Error)?.message ?? e) });
  const reset = () => { setPhase("idle"); setDirection(""); setPrompt(""); setRefUrls([]); setVariants([]); setAdded(new Set()); setRendered(false); };

  // The style text fed into the next compose — the picked theme's prompt (immediate, dodges the persist
  // round-trip); when nothing matches a preset the edge falls back to the book's stored house look.
  const styleText = () => styleThemes?.find((t) => t.id === styleId)?.prompt ?? "";

  const chipCls = (on: boolean) =>
    `pv-serif rounded-full border px-2.5 py-0.5 text-[12.5px] transition-colors ${
      on ? "border-[hsl(var(--pv-accent))] bg-[hsl(var(--pv-accent))]/[0.1] text-[hsl(var(--pv-accent))]"
        : "border-[hsl(var(--pv-border-soft))] text-[hsl(var(--pv-text-muted))] hover:border-foreground/30"
    }`;

  // Pick a style: persist it as the book look, and — if a prompt is already open — swap just its STYLE
  // line in place (no LLM recompose; the rest of the prompt is style-independent). With no prompt yet
  // (idle), it only sets the selection for the next compose.
  const pickStyle = (id: string) => {
    onStyleChange?.(id);
    const text = styleThemes?.find((t) => t.id === id)?.prompt ?? "";
    if (text && prompt.trim()) setPrompt((p) => replaceStyleLine(p, text));
  };

  // STYLE selector — only when the host supplies themes. The picked chip IS the book look (the host
  // persists it); with a prompt open it rewrites the STYLE line instantly so you can re-style without
  // recomposing — then just Regenerate.
  const styleChips = styleThemes && (
    <div className="mb-3">
      <Eyebrow tone="muted" className="mb-1.5 block">style — the book look; switch to re-style this prompt instantly</Eyebrow>
      <div className="flex flex-wrap gap-1.5">
        {styleThemes.map((t) => (
          <button key={t.id} type="button" title={t.hint} onClick={() => pickStyle(t.id)} className={chipCls(styleId === t.id)}>{t.label}</button>
        ))}
      </div>
    </div>
  );

  // Render from a prompt. Stays in "ready" (prompt retained) so the author can iterate — edit → generate
  // again. Single-select commits each render via onAdd (the scene host inserts a gallery row);
  // multiSelect collects variants to add from.
  const runRender = async (promptText: string) => {
    const p = promptText.trim();
    if (!p) return;
    setPhase("rendering");
    try {
      const urls = await render(p, refUrls);
      if (multiSelect) setVariants((v) => [...urls, ...v]);
      else if (urls[0]) await onAdd(urls[0]);
      setRendered(true);
      setPhase("ready");
    } catch (e) { fail("Couldn't generate the image", e); setPhase("ready"); }
  };

  // Load a saved prompt into the editor for revision (a "revise" click on a gallery image).
  useEffect(() => {
    if (!loadPrompt) return;
    setVariants([]); setAdded(new Set()); setRendered(false);
    setPrompt(loadPrompt.text);
    setPhase("ready");
  }, [loadPrompt?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore the page's last saved prompt on open — ONCE per mount, and only while the studio is still
  // idle & empty so it never clobbers a compose/edit already underway. (initialPrompt may arrive after
  // the page's scenes load, hence the effect rather than a useState initializer.)
  const didSeed = useRef(false);
  useEffect(() => {
    if (didSeed.current) return;
    if (!initialPrompt) return;
    if (phase !== "idle" || prompt.trim()) { didSeed.current = true; return; }
    didSeed.current = true;
    setPrompt(initialPrompt);
    setPhase("ready");
  }, [initialPrompt, phase, prompt]);

  // One-shot (the default). When the host provides a DURABLE one-shot (scenes), kick it off server-side
  // and return — it survives leaving and lands in the gallery. Otherwise fall back to the client
  // compose→render (portraits), landing on the editable prompt for refinement.
  const startOneShot = async () => {
    if (oneShot) {
      setPhase("composing"); setVariants([]); setAdded(new Set()); setRendered(false);
      try { await oneShot(direction.trim() || undefined, styleText() || undefined); reset(); }
      catch (e) { fail("Couldn't start the generation", e); setPhase("idle"); }
      return;
    }
    setPhase("composing"); setVariants([]); setAdded(new Set()); setRendered(false);
    let composed: string;
    try { composed = await compose(direction.trim() || undefined, styleText() || undefined); setPrompt(composed); }
    catch (e) { fail("Couldn't compose the prompt", e); setPhase("idle"); return; }
    await runRender(composed);
  };

  // Compose only — stop at the editable prompt before spending a generation (review-first).
  const startCompose = async () => {
    setPhase("composing"); setVariants([]); setAdded(new Set()); setRendered(false);
    try { setPrompt(await compose(direction.trim() || undefined, styleText() || undefined)); setPhase("ready"); }
    catch (e) { fail("Couldn't compose the prompt", e); setPhase("idle"); }
  };

  // Skip the LLM and write the prompt by hand. Seeds with any typed direction as a starting point.
  const startManual = () => { setVariants([]); setAdded(new Set()); setRendered(false); setPrompt(direction.trim()); setPhase("ready"); };

  const doRender = () => void runRender(prompt);

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
        {styleChips}
        <AutoTextarea
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          placeholder="Art direction (optional) — mood, framing, lighting, time of day, palette… steers the prompt."
          className="mb-3 pv-serif border-[hsl(var(--pv-border-soft))] bg-transparent text-[13.5px] leading-relaxed focus-visible:ring-0"
        />
        <div className="flex flex-wrap items-center gap-5">
          <button
            type="button"
            onClick={() => void startOneShot()}
            className="pv-serif inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[hsl(var(--pv-accent))]/[0.08] px-4 py-2 text-[14px] text-[hsl(var(--pv-accent))] transition-colors hover:bg-[hsl(var(--pv-accent))]/[0.14]"
          >
            <Sparkles className="h-3.5 w-3.5" /> {startLabel}
          </button>
          <ActionLink tone="muted" onClick={() => void startCompose()}>or compose &amp; edit first</ActionLink>
          <ActionLink tone="muted" onClick={startManual}>write the prompt myself</ActionLink>
          <ActionLink icon={<Upload className="h-3.5 w-3.5" />} tone="muted" busy={uploadingDirect} onClick={() => directInput.current?.click()}>
            {uploadingDirect ? "uploading…" : "upload an image"}
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
        <>
          {rendered && !multiSelect && (
            <p className="pv-serif mt-3 text-[13px] italic text-[hsl(var(--pv-text-muted))]">Generating in the gallery above — it finishes even if you leave. Edit the prompt and generate again to queue another.</p>
          )}
          <div className="mt-3.5">{styleChips}</div>
          <div className="mt-1 flex flex-wrap items-center gap-5">
            <button
              type="button"
              onClick={() => void doRender()}
              className="pv-serif inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[hsl(var(--pv-accent))]/[0.08] px-4 py-2 text-[14px] text-[hsl(var(--pv-accent))] transition-colors hover:bg-[hsl(var(--pv-accent))]/[0.14]"
            >
              <ImageIcon className="h-3.5 w-3.5" /> {rendered ? "Regenerate" : (generateLabel ?? (multiSelect ? "Generate variants" : "Generate image"))}
            </button>
            <ActionLink icon={<RefreshCw className="h-3.5 w-3.5" />} tone="muted" onClick={() => void startCompose()}>recompose</ActionLink>
            <ActionLink tone="faint" onClick={reset}>{multiSelect || rendered ? "done" : "cancel"}</ActionLink>
          </div>
        </>
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
