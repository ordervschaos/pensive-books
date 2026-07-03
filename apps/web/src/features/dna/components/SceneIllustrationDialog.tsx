// SceneIllustrationDialog — the per-scene operable UI for picture-book mode (docs/picture-book-mode.md).
// Opens from the Visuals illustrations grid and gives one scene a view/delete control surface: VIEW the
// illustration full screen, or DELETE it. Deleting clears the pinned content.image_url AND the scene's
// candidate gallery rows (node_scene_images). Generation is not available from the UI.
import { useState } from "react";
import { Maximize2, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ActionLink, ImageLightbox } from "@/components/book/shared/studioUi";
import { readNodeSceneImages, deleteNodeSceneImage } from "@/features/dna/lib/nodeSceneImages";
import { saveNode } from "@/features/dna/lib/bookNodes";
import { editContent, type DnaNode, type SceneContent } from "@/features/dna/lib/novelDna";

export function SceneIllustrationDialog({ node, open, onOpenChange, onChanged }: {
  node: DnaNode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<"delete" | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const sc = (node?.content ?? {}) as SceneContent;
  const img = sc.image_url ?? null;
  const title = sc.goal || sc.caption?.text || "Scene";

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

  const reset = () => { setFullscreen(false); };

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

            {/* Persistent action row — full screen / delete, always reachable. */}
            {img && (
              <div className="flex flex-wrap items-center gap-4 border-t border-[hsl(var(--pv-border-soft))]/60 pt-3">
                <ActionLink icon={<Maximize2 className="h-3.5 w-3.5" />} tone="muted" onClick={() => setFullscreen(true)}>full screen</ActionLink>
                <ActionLink icon={<Trash2 className="h-3.5 w-3.5" />} tone="faint" busy={busy === "delete"} onClick={() => void deleteImage()}>delete image</ActionLink>
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
