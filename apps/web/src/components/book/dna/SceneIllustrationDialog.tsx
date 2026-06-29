// SceneIllustrationDialog — the per-scene operable UI for picture-book mode (docs/picture-book-mode.md).
// Opens from the Visuals illustrations grid and gives one scene a full control surface: VIEW the
// illustration full screen, see the WHOLE CONTEXT the image is drawn from + the editable image PROMPT,
// REGENERATE, or DELETE. Opening auto-composes the prompt (one call) so the context + editable prompt are
// shown immediately; Generate keeps the prompt on screen (the new image lands over Realtime). Deleting
// clears the pinned content.image_url AND the scene's candidate gallery rows (node_scene_images).
import { useState, useEffect } from "react";
import { Maximize2, Trash2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ActionLink, ImageLightbox, RunningInline } from "@/components/book/shared/studioUi";
import { ImagePromptPreview } from "@/components/book/dna/ImagePromptPreview";
import { composeSceneIllustration, renderSceneIllustration, type ComposedSceneImage } from "@/lib/dnaExpand";
import { composeSceneImage, readNodeSceneImages, deleteNodeSceneImage } from "@/lib/nodeSceneImages";
import { saveNode } from "@/lib/bookNodes";
import { editContent, type DnaNode, type SceneContent } from "@/lib/novelDna";

export function SceneIllustrationDialog({ node, bookId, open, onOpenChange, onChanged }: {
  node: DnaNode | null;
  bookId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [composed, setComposed] = useState<ComposedSceneImage | null>(null);
  const [composedFor, setComposedFor] = useState<string | null>(null); // which scene `composed` is for
  const [busy, setBusy] = useState<"compose" | "render" | "delete" | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [kicked, setKicked] = useState(false); // a render was just kicked; the new image lands over Realtime

  const nodeId = node?.id ?? null;
  const sc = (node?.content ?? {}) as SceneContent;
  const img = sc.image_url ?? null;
  const title = sc.goal || sc.caption?.text || "Scene";

  // Compose the prompt + context for THIS scene. An already-captioned scene re-composes only the IMAGE
  // prompt (keeps the page caption); a never-illustrated scene runs the full compose (also writes the
  // caption — the picture-mode page text). One LLM call.
  const doCompose = async (n: DnaNode) => {
    setBusy("compose"); setKicked(false);
    try {
      const artNote = (n.content as SceneContent).art_note?.trim() || undefined;
      const result = (n.content as SceneContent).caption?.text
        ? await composeSceneImage(bookId, n.id, { instruction: artNote })
        : await composeSceneIllustration(bookId, n);
      setComposed(result);
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't compose prompt", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setBusy(null); }
  };

  // Auto-compose once when the dialog opens on a scene (so context + editable prompt show immediately);
  // recompose when switching to a different scene. Closing resets composedFor so reopening composes fresh.
  useEffect(() => {
    if (!open || !node) return;
    if (composedFor === node.id) return;
    setComposedFor(node.id);
    setComposed(null);
    void doCompose(node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nodeId]);

  // Render the (possibly edited) prompt; pins the new image_url on the node (lands over Realtime). Keep the
  // prompt on screen afterwards so it never vanishes — the author can tweak + regenerate again.
  const generate = async (finalPrompt: string) => {
    if (!composed || !node) return;
    setBusy("render");
    try {
      await renderSceneIllustration(bookId, node.id, { ...composed, prompt: finalPrompt });
      setComposed({ ...composed, prompt: finalPrompt }); // keep the edited prompt visible
      setKicked(true);
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't generate image", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setBusy(null); }
  };

  // Delete: clear the pinned illustration AND drop the scene's candidate gallery rows.
  const deleteImage = async () => {
    if (!node || !window.confirm("Delete this scene's illustration?")) return;
    setBusy("delete");
    try {
      await saveNode(editContent(node, { image_url: null }));
      const rows = await readNodeSceneImages(node.id);
      await Promise.all(rows.map((r) => deleteNodeSceneImage(r.id)));
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't delete image", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setBusy(null); }
  };

  const reset = () => { setComposed(null); setComposedFor(null); setFullscreen(false); setKicked(false); };

  if (!node) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
        <DialogContent className="flex max-h-[88vh] max-w-lg flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="pv-serif text-[16px] font-normal leading-snug">{title}</DialogTitle>
          </DialogHeader>

          {/* The body scrolls — context + prompt can be long. */}
          <div className="-mr-2 space-y-4 overflow-y-auto pr-2">
            {/* The illustration — click to view full screen — or an unillustrated placeholder. */}
            {img ? (
              <button type="button" onClick={() => setFullscreen(true)} title="view full screen"
                className="group relative block w-full overflow-hidden rounded-md border border-[hsl(var(--pv-border-soft))]">
                <img src={img} alt={title} className="max-h-[48vh] w-full object-contain" />
                <span className="absolute right-2 top-2 hidden rounded-full bg-black/50 p-1.5 text-white group-hover:block">
                  <Maximize2 className="h-3.5 w-3.5" />
                </span>
              </button>
            ) : (
              <div className="flex aspect-video w-full items-center justify-center rounded-md border border-dashed border-[hsl(var(--pv-border-soft))]/60 bg-[hsl(var(--pv-surface-2))]/30">
                <span className="pv-mono text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">unillustrated</span>
              </div>
            )}

            {/* The page caption (picture-mode page text). */}
            {sc.caption?.text && (
              <p className="pv-serif text-[13px] leading-relaxed text-[hsl(var(--pv-text-muted))]">{sc.caption.text}</p>
            )}

            {/* Persistent action row — recompose / full screen / delete, always reachable. */}
            <div className="flex flex-wrap items-center gap-4 border-t border-[hsl(var(--pv-border-soft))]/60 pt-3">
              <ActionLink icon={<RefreshCw className="h-3.5 w-3.5" />} busy={busy === "compose"} onClick={() => void doCompose(node)}>
                recompose prompt
              </ActionLink>
              {img && (
                <ActionLink icon={<Maximize2 className="h-3.5 w-3.5" />} tone="muted" onClick={() => setFullscreen(true)}>full screen</ActionLink>
              )}
              {img && (
                <ActionLink icon={<Trash2 className="h-3.5 w-3.5" />} tone="faint" busy={busy === "delete"} onClick={() => void deleteImage()}>delete image</ActionLink>
              )}
            </div>

            {/* Context + editable prompt. Shows a composing indicator on first open. */}
            {busy === "compose" && !composed ? (
              <RunningInline label="composing prompt…" />
            ) : composed ? (
              <>
                {kicked && (
                  <p className="pv-mono text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-accent))]">
                    new image rendering — it'll appear above when ready
                  </p>
                )}
                <ImagePromptPreview
                  prompt={composed.prompt} refImages={composed.refImages} model={composed.model} context={composed.context}
                  busy={busy === "render"} generateLabel={img ? "regenerate image" : "generate image"}
                  onGenerate={generate} onCancel={() => onOpenChange(false)}
                />
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      {/* Full-screen viewer (z-[100], above the dialog). */}
      <ImageLightbox src={fullscreen && img ? img : null} onClose={() => setFullscreen(false)} />
    </>
  );
}
