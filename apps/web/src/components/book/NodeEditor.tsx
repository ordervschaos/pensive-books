import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { CellState } from "@/lib/planGraph";
import { readNode, readProse, saveBeat, saveObjective, saveSpine, transforms, type NodeLayer } from "@/lib/ladder";

export interface NodeTarget {
  layer: NodeLayer;       // spine | objective | beat (prose/brief open elsewhere)
  pageId?: number;        // for objective/beat
  pageTitle?: string | null;
  state: CellState;
}

const LABEL: Record<NodeLayer, string> = { spine: "Book spine", objective: "Objective", beat: "Beat" };
const PLACEHOLDER: Record<NodeLayer, string> = {
  spine: "What the whole book is doing — its central objective and arc.",
  objective: "What this page must achieve — its job in the book.",
  beat: "One paragraph: what this page does, in order, to fulfil its objective.",
};
// Per layer: the parent it expands from (down) and the child it distills from (up). Objective has no
// per-page expand — its parent edge (spine→objectives) is the whole-book scaffold, not a single node.
const PARENT: Partial<Record<NodeLayer, string>> = { spine: "brief", beat: "objective" };
const CHILD: Partial<Record<NodeLayer, string>> = { spine: "outline", objective: "beat", beat: "prose" };

const STATE_LABEL: Record<CellState, string> = { gap: "empty", drift: "out of sync", synced: "in sync" };
const STATE_TONE: Record<CellState, string> = {
  gap: "text-[hsl(var(--pv-text-faint))]",
  drift: "text-amber-600 dark:text-amber-500",
  synced: "text-[hsl(var(--pv-accent))]",
};

/**
 * NodeEditor — the resolution-map node workbench. Opens in a side sheet for a clicked spine /
 * objective / beat cell. One consistent contract per node: type it by hand, EXPAND from the layer
 * above (down), or DISTILL from the layer below (up); every path persists + stamps the right edges
 * (via lib/ladder), then tells the map to refresh. Down is the default (accent); up is deliberate (↑).
 */
export function NodeEditor({
  bookId, target, onClose, onSaved,
}: {
  bookId: number;
  target: NodeTarget | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"expand" | "distill" | "save" | null>(null);

  const layer = target?.layer ?? "spine";
  const pageId = target?.pageId;

  useEffect(() => {
    if (!target) return;
    setLoading(true);
    void readNode(bookId, target.layer, target.pageId)
      .then((t) => setDraft(t))
      .finally(() => setLoading(false));
  }, [bookId, target]);

  if (!target) return null;

  const fail = (title: string, e: unknown) =>
    toast({ variant: "destructive", title, description: String((e as Error)?.message ?? e) });

  // Persist whatever text is current for this layer (hand-edit save, or after a transform).
  const persist = async (text: string, extra?: { proseText?: string; reconcileBeat?: boolean }) => {
    if (layer === "spine") await saveSpine(bookId, text);
    else if (layer === "objective") await saveObjective(bookId, pageId!, text, { reconcileBeat: extra?.reconcileBeat });
    else await saveBeat(bookId, pageId!, text, { proseText: extra?.proseText });
  };

  const save = async () => {
    setBusy("save");
    try { await persist(draft.trim()); onSaved(); }
    catch (e) { fail("Couldn't save", e); }
    finally { setBusy(null); }
  };

  // Down: generate this node from its parent.
  const expand = async () => {
    setBusy("expand");
    try {
      let text = "";
      if (layer === "spine") text = await transforms.briefToSpine(bookId);
      else if (layer === "beat") {
        const objective = await readNode(bookId, "objective", pageId);
        if (!objective) throw new Error("Set an objective first.");
        text = await transforms.objectiveToBeat(bookId, pageId!, objective);
      }
      if (text) { setDraft(text); await persist(text); onSaved(); }
    } catch (e) { fail("Couldn't generate", e); }
    finally { setBusy(null); }
  };

  // Up: distill this node from its child.
  const distill = async () => {
    setBusy("distill");
    try {
      let text = "";
      if (layer === "spine") { text = await transforms.objectivesToSpine(bookId); if (text) { setDraft(text); await persist(text); } }
      else if (layer === "objective") {
        const beat = await readNode(bookId, "beat", pageId);
        if (!beat) throw new Error("No beat to distill from.");
        text = await transforms.beatToObjective(bookId, pageId!, beat);
        if (text) { setDraft(text); await persist(text, { reconcileBeat: true }); }
      } else { // beat ← prose
        const prose = await readProse(pageId!);
        if (!prose) throw new Error("No prose to distill from.");
        text = await transforms.proseToBeat(bookId, pageId!, prose);
        if (text) { setDraft(text); await persist(text, { proseText: prose }); }
      }
      if (text) onSaved();
    } catch (e) { fail("Couldn't distill", e); }
    finally { setBusy(null); }
  };

  const parent = PARENT[layer];
  const child = CHILD[layer];
  const heading = layer === "spine" ? "Book spine"
    : `${target.pageTitle || "Untitled"} · ${LABEL[layer]}`;

  return (
    <Sheet open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="pv-serif">{heading}</SheetTitle>
          <SheetDescription className="flex items-center gap-2">
            <span className={`pv-mono text-[10px] uppercase tracking-[0.14em] ${STATE_TONE[target.state]}`}>{STATE_LABEL[target.state]}</span>
            <span className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">· author only</span>
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex flex-1 flex-col gap-3 overflow-y-auto">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={loading ? "Loading…" : PLACEHOLDER[layer]}
            disabled={loading || busy !== null}
            className={`pv-serif text-[14.5px] leading-relaxed ${layer === "beat" || layer === "spine" ? "min-h-[200px]" : "min-h-[96px]"}`}
          />

          {/* Transforms: down (expand from parent) is the default motion; up (distill) is deliberate. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {parent && (
              <button
                type="button" onClick={() => void expand()} disabled={busy !== null}
                className="pv-serif inline-flex items-center gap-1.5 text-[13.5px] italic text-[hsl(var(--pv-accent))] transition-colors hover:text-foreground disabled:opacity-50"
                title={`Generate this from the ${parent} (top-down)`}
              >
                {busy === "expand" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {busy === "expand" ? "Working…" : `Generate from ${parent} →`}
              </button>
            )}
            {child && (
              <button
                type="button" onClick={() => void distill()} disabled={busy !== null}
                className="pv-serif inline-flex items-center gap-1.5 text-[13.5px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground disabled:opacity-50"
                title={`Reverse-outline: derive this from the ${child} (bottom-up)`}
              >
                {busy === "distill" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                ↑ Distill from {child}
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-[hsl(var(--pv-border-soft))] pt-3">
          <Button variant="ghost" onClick={onClose} disabled={busy !== null}>Close</Button>
          <Button onClick={() => void save()} disabled={loading || busy !== null}>
            {busy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
