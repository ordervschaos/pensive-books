// DnaVisuals — the standalone "Visuals" control room for picture-book mode in the DNA Build studio.
// Collects every picture-generation concern (house look, cast reference portraits, scene illustrations)
// out of Foundations and Draft into one non-gating rail section. Only the LOOK/References/Illustrations
// panels render in picture mode; prose mode shows the output toggle + a "switch to picture book" hint.
import { useState, useRef, useEffect } from "react";
import { Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ActionLink, Eyebrow, Panel, RunningInline, StageHead } from "@/components/book/studio/studioUi";
import { DnaLookPanel } from "@/components/book/dna/DnaLookPanel";
import { DnaCharacterLook } from "@/components/book/dna/DnaCharacterLook";
import { ImagePromptPreview } from "@/components/book/dna/ImagePromptPreview";
import { SceneIllustrationDialog } from "@/components/book/dna/SceneIllustrationDialog";
import { composeSceneIllustration, renderSceneIllustration, type ComposedSceneImage } from "@/lib/dnaExpand";
import { isIllusStale, type CharacterContent, type DnaNode, type SceneContent } from "@/lib/novelDna";
import { supabase } from "@/integrations/supabase/client";
import type { DnaSettings } from "@/components/book/dna/DnaStudio";

// ── DnaVisuals ────────────────────────────────────────────────────────────────
export function DnaVisuals({ bookId, nodes, settings, onChanged }: {
  bookId: number;
  nodes: DnaNode[];
  settings: DnaSettings;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const picture = settings.mode === "picture";

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try { await fn(); onChanged(); }
    catch (e) { toast({ title: `Couldn't ${label}`, description: String((e as Error)?.message ?? e), variant: "destructive" }); }
    finally { setBusy(null); }
  };

  // Output mode toggle — prose vs picture book (docs/picture-book-mode.md). Lives here rather than the
  // rail footer so it sits alongside the controls it unlocks (look, cast, illustrations).
  const setMode = (mode: "prose" | "picture") =>
    run("mode", async () => { const { error } = await supabase.from("books").update({ mode }).eq("id", bookId); if (error) throw error; });

  const characters = nodes.filter((n) => n.kind === "character");
  const scenes = nodes.filter((n) => n.kind === "scene");

  // Per-scene operable UI: clicking a tile opens the scene's dialog (view full screen / revise prompt /
  // delete). Held by id so it re-resolves to the FRESH node after onChanged refetches.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedScene = selectedId ? scenes.find((s) => s.id === selectedId) ?? null : null;

  // Hoisted preview surface for the bulk "illustrate all" STEPPER only (per-scene revise lives in the
  // dialog above). nodeId identifies the scene being stepped; data is the composed prompt from Phase 1.
  const [preview, setPreview] = useState<{ nodeId: string; data: ComposedSceneImage } | null>(null);

  // Bulk stepper state: a queue of scenes to step through, with the current index.
  const [queue, setQueue] = useState<{ scenes: DnaNode[]; i: number } | null>(null);

  // The preview opens at the top of the grid, away from the tile that was clicked — pull it into view so
  // the editable prompt is never missed (the whole point of the gate). Re-runs whenever the scene changes.
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (preview) previewRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [preview?.nodeId]);

  // Bulk "illustrate all" stepper: compute todo, start the queue, compose scene 0.
  const startIllustrateAll = async () => {
    const todo = scenes.filter((s) =>
      !(s.content as SceneContent).image_url ||
      (s.content as SceneContent).caption?.text == null ||
      isIllusStale(s)
    );
    if (!todo.length) { toast({ title: "All scenes already illustrated" }); return; }
    setBusy("allillus");
    try {
      const composed = await composeSceneIllustration(bookId, todo[0]);
      setQueue({ scenes: todo, i: 0 });
      setPreview({ nodeId: todo[0].id, data: composed });
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't compose first illustration", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  // Advance the stepper: render the current (possibly edited) prompt (durable — don't await the image),
  // then compose the next scene in the queue. On Generate/Skip, i increments.
  const stepIllustrate = async (finalPrompt: string | null) => {
    if (!queue || !preview) return;
    const { scenes: q, i } = queue;
    // Render (unless Skip — finalPrompt null means skip).
    if (finalPrompt !== null) {
      try {
        await renderSceneIllustration(bookId, preview.nodeId, { ...preview.data, prompt: finalPrompt });
      } catch (e) {
        toast({ title: "Couldn't kick render", description: String((e as Error)?.message ?? e), variant: "destructive" });
      }
    }
    // Advance to next scene.
    const nextI = i + 1;
    if (nextI >= q.length) {
      // Done — close queue + preview.
      setQueue(null);
      setPreview(null);
      toast({ title: "Illustrate all", description: `${q.length} scene(s) queued for rendering.` });
      return;
    }
    // Compose next scene's prompt.
    setBusy("allillus");
    try {
      const composed = await composeSceneIllustration(bookId, q[nextI]);
      setQueue({ scenes: q, i: nextI });
      setPreview({ nodeId: q[nextI].id, data: composed });
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't compose next illustration", description: String((e as Error)?.message ?? e), variant: "destructive" });
      setQueue(null);
      setPreview(null);
    } finally {
      setBusy(null);
    }
  };

  // How many scenes have a non-stale pinned image.
  const illustratedCount = scenes.filter((s) =>
    (s.content as SceneContent).image_url && !isIllusStale(s)
  ).length;
  const allIllustrated = scenes.length > 0 && illustratedCount === scenes.length;

  return (
    <div className="space-y-6">
      <StageHead
        eyebrow="Visuals"
        title="The book's look, cast references, and illustrations"
        caption="Set the house style, pin character likenesses, and manage scene illustrations — all in one place."
      />

      {/* ── Output mode — prose or picture book ─────────────────────────────── */}
      <Panel variant="soft" className="px-4 py-3">
        <Eyebrow tone="muted">output mode</Eyebrow>
        <p className="pv-serif mt-1 mb-2.5 text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
          Prose produces a written novel; picture book illustrates each scene instead.
        </p>
        <div className="flex items-center gap-3" title="Output: a prose novel, or an illustrated picture book">
          {(["prose", "picture"] as const).map((m) => (
            <button
              key={m}
              disabled={busy === "mode"}
              onClick={() => { if (m !== (picture ? "picture" : "prose")) void setMode(m); }}
              className={`pv-mono rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.1em] transition-colors ${
                (picture ? "picture" : "prose") === m
                  ? "bg-[hsl(var(--pv-accent))]/10 text-[hsl(var(--pv-accent))] ring-1 ring-[hsl(var(--pv-accent))]/30"
                  : "text-[hsl(var(--pv-text-faint))] hover:text-foreground"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </Panel>

      {!picture ? (
        /* Prose mode — Visuals is reachable but shows only the toggle and a hint. */
        <p className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-faint))]">
          Switch to <button
            onClick={() => void setMode("picture")}
            className="text-[hsl(var(--pv-accent))] underline"
          >picture book</button>{" "}
          to design the look, set character references, and illustrate scenes.
        </p>
      ) : (
        <>
          {/* ── THE LOOK — book-wide visual style inherited by every illustration ── */}
          <DnaLookPanel bookId={bookId} />

          {/* ── References · cast — one panel per character ─────────────────── */}
          <div className="space-y-3">
            <Eyebrow tone="muted">references · cast</Eyebrow>
            {characters.length === 0 ? (
              <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">
                No cast yet — generate characters in Foundations first.
              </p>
            ) : (
              characters.map((ch) => (
                <div key={ch.id} className="space-y-0.5">
                  <span className="pv-mono text-[10px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">
                    {(ch.content as CharacterContent).name?.trim() || ch.id}
                  </span>
                  <DnaCharacterLook node={ch} bookId={bookId} onChanged={onChanged} />
                </div>
              ))
            )}
          </div>

          {/* ── Illustrations — thumbnail grid + illustrate-all stepper ───────── */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Eyebrow tone="muted">illustrations</Eyebrow>
              {scenes.length > 0 && (
                <span className="pv-mono text-[9px] text-[hsl(var(--pv-text-faint))]">
                  {illustratedCount}/{scenes.length} illustrated
                </span>
              )}
              {/* Bulk stepper: composing label while stepping, or the trigger link. */}
              {scenes.length > 0 && !allIllustrated && (
                busy === "allillus"
                  ? <RunningInline label={queue ? `composing scene ${(queue.i + 1)} of ${queue.scenes.length}…` : "composing…"} />
                  : !queue && (
                      <ActionLink icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => void startIllustrateAll()}>
                        illustrate all scenes
                      </ActionLink>
                    )
              )}
            </div>

            {/* Bulk stepper preview — one scene at a time; Generate renders + advances, Cancel skips.
                (Per-scene revise has its own dialog.) Scrolled into view so the edit box is never missed. */}
            {preview && queue && (
              <div ref={previewRef} className="space-y-1">
                <p className="pv-mono text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">
                  scene {queue.i + 1} of {queue.scenes.length}
                </p>
                <ImagePromptPreview
                  prompt={preview.data.prompt}
                  refImages={preview.data.refImages}
                  model={preview.data.model}
                  context={preview.data.context}
                  busy={busy === "allillus"}
                  generateLabel={`generate · ${queue.i + 1}/${queue.scenes.length}`}
                  onGenerate={(finalPrompt) => void stepIllustrate(finalPrompt)}
                  onCancel={() => void stepIllustrate(null)}
                />
              </div>
            )}

            {scenes.length === 0 ? (
              <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">
                No scenes yet — generate scenes in Scenes first.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-3 lg:grid-cols-4">
                {scenes.map((s) => {
                  const sc = s.content as SceneContent;
                  const img = sc.image_url;
                  const stale = isIllusStale(s);
                  const isStepping = preview?.nodeId === s.id;
                  return (
                    <div key={s.id} className={`group relative ${isStepping ? "ring-2 ring-[hsl(var(--pv-accent))]/40 rounded-md" : ""}`}>
                      {img ? (
                        // Illustrated: click the tile to open the scene's operable dialog (view / revise /
                        // delete); a hover hint makes the affordance obvious.
                        <button
                          type="button"
                          onClick={() => setSelectedId(s.id)}
                          title="open · view, revise prompt, or delete"
                          className="relative block w-full"
                        >
                          <img
                            src={img}
                            alt={sc.goal || "scene illustration"}
                            className={`aspect-square w-full rounded-md border object-cover transition-opacity ${
                              stale ? "border-amber-400/60 opacity-60" : "border-[hsl(var(--pv-border-soft))]"
                            }`}
                          />
                          <span className="pv-mono absolute inset-0 hidden items-center justify-center rounded-md bg-black/40 text-[8px] uppercase tracking-[0.1em] text-white group-hover:flex">
                            open
                          </span>
                        </button>
                      ) : (
                        // Unillustrated: the whole tile is an always-visible trigger — opens the operable
                        // dialog where the prompt is composed + edited before generating.
                        <button
                          onClick={() => setSelectedId(s.id)}
                          title="illustrate this scene — compose & edit the prompt"
                          className="flex aspect-square w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-[hsl(var(--pv-border-soft))]/60 bg-[hsl(var(--pv-surface-2))]/30 transition-colors hover:border-[hsl(var(--pv-accent))]/50 hover:bg-[hsl(var(--pv-accent))]/[0.04]"
                        >
                          <Sparkles className="h-4 w-4 text-[hsl(var(--pv-text-faint))]" />
                          <span className="pv-mono text-[8px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">
                            illustrate
                          </span>
                        </button>
                      )}
                      {/* stale badge */}
                      {img && stale && (
                        <span className="absolute left-1 top-1 rounded bg-amber-500/80 px-1 py-0.5 pv-mono text-[7px] uppercase tracking-[0.1em] text-white">
                          stale
                        </span>
                      )}
                      {/* Caption preview */}
                      {sc.caption?.text && (
                        <p className="mt-1 pv-serif line-clamp-2 text-[10px] leading-snug text-[hsl(var(--pv-text-faint))]">
                          {sc.caption.text}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Per-scene operable dialog — view full screen, revise the prompt, or delete the image. */}
          <SceneIllustrationDialog
            node={selectedScene}
            bookId={bookId}
            open={!!selectedScene}
            onOpenChange={(o) => { if (!o) setSelectedId(null); }}
            onChanged={onChanged}
          />
        </>
      )}
    </div>
  );
}
