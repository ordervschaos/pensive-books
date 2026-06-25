// SceneIllustrationDialog — the per-scene operable UI for picture-book mode (docs/picture-book-mode.md).
// Opens from the Visuals illustrations grid and gives one scene a full control surface: VIEW the
// illustration full screen, REVISE the (editable) image prompt and regenerate, or DELETE the image.
// Compose → editable preview → render mirrors the rest of the picture pipeline (ImagePromptPreview);
// deleting clears the pinned content.image_url AND the scene's candidate gallery rows (node_scene_images).
import { useState } from "react";
import { Maximize2, Trash2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ActionLink, ImageLightbox, RunningInline } from "@/components/book/studio/studioUi";
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
  const [busy, setBusy] = useState<"compose" | "render" | "delete" | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  if (!node) return null;
  const sc = node.content as SceneContent;
  const img = sc.image_url ?? null;
  const title = sc.goal || sc.caption?.text || "Scene";

  // Compose the image prompt for the editable preview. An already-captioned scene only re-composes the
  // IMAGE prompt (keep the existing page caption); a never-illustrated scene runs the full compose, which
  // also writes the caption (the picture-mode page text).
  const startCompose = async () => {
    setBusy("compose");
    try {
      const artNote = sc.art_note?.trim() || undefined;
      const result = sc.caption?.text
        ? await composeSceneImage(bookId, node.id, { instruction: artNote })
        : await composeSceneIllustration(bookId, node);
      setComposed(result);
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't compose prompt", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setBusy(null); }
  };

  // Render the (possibly edited) prompt; pins the new image_url on the node (lands over Realtime).
  const generate = async (finalPrompt: string) => {
    if (!composed) return;
    setBusy("render");
    try {
      await renderSceneIllustration(bookId, node.id, { ...composed, prompt: finalPrompt });
      setComposed(null);
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't generate image", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setBusy(null); }
  };

  // Delete: clear the pinned illustration AND drop the scene's candidate gallery rows.
  const deleteImage = async () => {
    if (!window.confirm("Delete this scene's illustration?")) return;
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

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) { setComposed(null); setFullscreen(false); } onOpenChange(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="pv-serif text-[16px] font-normal">{title}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* The illustration — click to view full screen — or an unillustrated placeholder. */}
            {img ? (
              <button type="button" onClick={() => setFullscreen(true)} title="view full screen"
                className="group relative block w-full overflow-hidden rounded-md border border-[hsl(var(--pv-border-soft))]">
                <img src={img} alt={title} className="max-h-[55vh] w-full object-contain" />
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

            {/* Operable surface: the editable prompt preview while composing, else the action bar. */}
            {composed ? (
              <ImagePromptPreview
                prompt={composed.prompt} refImages={composed.refImages} model={composed.model}
                busy={busy === "render"} generateLabel={img ? "regenerate image" : "generate image"}
                onGenerate={generate} onCancel={() => setComposed(null)}
              />
            ) : busy === "compose" ? (
              <RunningInline label="composing prompt…" />
            ) : (
              <div className="flex flex-wrap items-center gap-4 border-t border-[hsl(var(--pv-border-soft))]/60 pt-3">
                <ActionLink icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => void startCompose()}>
                  {img ? "revise prompt" : "compose & illustrate"}
                </ActionLink>
                {img && (
                  <ActionLink icon={<Maximize2 className="h-3.5 w-3.5" />} tone="muted" onClick={() => setFullscreen(true)}>
                    full screen
                  </ActionLink>
                )}
                {img && (
                  <ActionLink icon={<Trash2 className="h-3.5 w-3.5" />} tone="faint" busy={busy === "delete"} onClick={() => void deleteImage()}>
                    delete image
                  </ActionLink>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {/* Full-screen viewer (z-[100], above the dialog). */}
      <ImageLightbox src={fullscreen && img ? img : null} onClose={() => setFullscreen(false)} />
    </>
  );
}
