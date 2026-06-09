import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { CellState } from "@/lib/planGraph";
import { readNode, readProse, saveBeat, saveObjective, saveSpine, transforms, type NodeLayer } from "@/lib/ladder";
import { NodeLabel, NodeReviser, RecreateButton } from "./ladder-ui";
import { ProseNodePanel } from "./ProseNodePanel";

// A node target the sheet can open. prose is supported too (rendered by ProseNodePanel); brief lives
// in its own tab and isn't editable here.
export type SheetLayer = NodeLayer | "prose";

export interface NodeTarget {
  layer: SheetLayer;
  pageId?: number;        // for objective/beat/prose
  pageTitle?: string | null;
  state: CellState;
}

const LABEL: Record<SheetLayer, string> = { spine: "Book spine", objective: "Objective", beat: "Beat", prose: "Prose" };
const PLACEHOLDER: Record<NodeLayer, string> = {
  spine: "What the whole book is doing — its central objective and arc.",
  objective: "What this page must achieve — its job in the book.",
  beat: "One paragraph: what this page does, in order, to fulfil its objective.",
};
// Per layer: the parent it RE-CREATES from (down) and the child it re-creates from (up). Objective has
// no per-page down — its parent edge (spine→objectives) is the whole-book scaffold, not a single node.
const PARENT: Partial<Record<NodeLayer, string>> = { spine: "brief", beat: "objective" };
const CHILD: Partial<Record<NodeLayer, string>> = { spine: "outline", objective: "beat", beat: "prose" };

const STATE_LABEL: Record<CellState, string> = { gap: "empty", drift: "out of sync", synced: "in sync" };
const STATE_TONE: Record<CellState, string> = {
  gap: "text-[hsl(var(--pv-text-faint))]",
  drift: "text-amber-600 dark:text-amber-500",
  synced: "text-[hsl(var(--pv-accent))]",
};

/**
 * NodeEditor — the resolution-map node workbench (a side sheet, so the map stays visible behind it).
 * One grammar everywhere, matching the page workshop:
 *   RE-CREATE (↓ from parent / ↑ from child) — regenerate the node. REPLACES.
 *   REVISE    (✎)                            — nudge with an instruction. PRESERVES, shows a diff.
 * Short plan nodes (spine/objective/beat) edit inline here; prose is delegated to ProseNodePanel
 * (durable generation, writes the page body without opening the editor).
 */
export function NodeEditor({
  bookId, target, onClose, onSaved, onOpenPage,
}: {
  bookId: number;
  target: NodeTarget | null;
  onClose: () => void;
  onSaved: () => void;
  onOpenPage: (pageId: number) => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"expand" | "distill" | "save" | null>(null);
  // Prose needs its neighbours (objective = stamp source, beat = re-create parent) + current prose.
  const [prose, setProse] = useState<{ objective: string; beat: string; text: string } | null>(null);

  const layer = target?.layer ?? "spine";
  const pageId = target?.pageId;
  const isProse = layer === "prose";

  useEffect(() => {
    if (!target) return;
    if (target.layer === "prose") {
      setLoading(true);
      Promise.all([
        readNode(bookId, "objective", target.pageId),
        readNode(bookId, "beat", target.pageId),
        readProse(target.pageId!),
      ]).then(([objective, beat, text]) => setProse({ objective, beat, text }))
        .finally(() => setLoading(false));
      return;
    }
    setLoading(true);
    void readNode(bookId, target.layer, target.pageId)
      .then((t) => setDraft(t))
      .finally(() => setLoading(false));
  }, [bookId, target]);

  if (!target) return null;

  const fail = (title: string, e: unknown) =>
    toast({ variant: "destructive", title, description: String((e as Error)?.message ?? e) });

  // Persist whatever text is current for this short layer (hand-edit save, revise-accept, or re-create).
  const persist = async (text: string, extra?: { proseText?: string; reconcileBeat?: boolean }) => {
    if (layer === "spine") await saveSpine(bookId, text);
    else if (layer === "objective") await saveObjective(bookId, pageId!, text, { reconcileBeat: extra?.reconcileBeat });
    else if (layer === "beat") await saveBeat(bookId, pageId!, text, { proseText: extra?.proseText });
  };

  const save = async () => {
    setBusy("save");
    try { await persist(draft.trim()); onSaved(); }
    catch (e) { fail("Couldn't save", e); }
    finally { setBusy(null); }
  };

  // RE-CREATE ↓: regenerate this node from its parent (replaces it).
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
    } catch (e) { fail("Couldn't re-create", e); }
    finally { setBusy(null); }
  };

  // RE-CREATE ↑: regenerate this node from its child (reverse-outline; replaces it).
  const distill = async () => {
    setBusy("distill");
    try {
      let text = "";
      if (layer === "spine") { text = await transforms.objectivesToSpine(bookId); if (text) { setDraft(text); await persist(text); } }
      else if (layer === "objective") {
        const beat = await readNode(bookId, "beat", pageId);
        if (!beat) throw new Error("No beat to re-create from.");
        text = await transforms.beatToObjective(bookId, pageId!, beat);
        if (text) { setDraft(text); await persist(text, { reconcileBeat: true }); }
      } else { // beat ← prose
        const proseText = await readProse(pageId!);
        if (!proseText) throw new Error("No prose to re-create from.");
        text = await transforms.proseToBeat(bookId, pageId!, proseText);
        if (text) { setDraft(text); await persist(text, { proseText }); }
      }
      if (text) onSaved();
    } catch (e) { fail("Couldn't re-create", e); }
    finally { setBusy(null); }
  };

  // Accept a revised short node (preserve path). saveObjective/saveBeat carry the right reconcile
  // semantics: a revised objective leaves the beat to go stale; a revised beat stays in sync with its
  // objective (and leaves the prose to go stale).
  const acceptRevision = async (proposed: string) => {
    setDraft(proposed);
    await persist(proposed);
    onSaved();
  };

  const parent = layer === "prose" ? undefined : PARENT[layer];
  const child = layer === "prose" ? undefined : CHILD[layer];
  const heading = layer === "spine" ? "Book spine" : `${target.pageTitle || "Untitled"} · ${LABEL[layer]}`;

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
          {isProse ? (
            loading || !prose ? (
              <p className="pv-serif inline-flex items-center gap-2 text-[13.5px] italic text-[hsl(var(--pv-text-muted))]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </p>
            ) : (
              <ProseNodePanel
                bookId={bookId}
                pageId={pageId!}
                pageTitle={target.pageTitle ?? null}
                objective={prose.objective}
                beat={prose.beat}
                prose={prose.text}
                onSaved={onSaved}
                onOpenPage={() => onOpenPage(pageId!)}
              />
            )
          ) : (
            <>
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={loading ? "Loading…" : PLACEHOLDER[layer as NodeLayer]}
                disabled={loading || busy !== null}
                className={`pv-serif text-[14.5px] leading-relaxed ${layer === "beat" || layer === "spine" ? "min-h-[200px]" : "min-h-[96px]"}`}
              />

              {/* RE-CREATE (replaces). ↓ from the parent, ↑ from the child — same affordance as the page workshop. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {parent && <RecreateButton dir="down" action={{ label: `re-create from ${parent}`, onClick: () => void expand(), disabled: busy !== null, busy: busy === "expand" }} />}
                {child && <RecreateButton dir="up" action={{ label: `re-create from ${child}`, onClick: () => void distill(), disabled: busy !== null, busy: busy === "distill" }} />}
              </div>

              {/* REVISE (preserves). Available once the node has content. */}
              {draft.trim() && (
                <div className="flex items-center justify-between gap-3">
                  <NodeLabel>Revise · keeps what's here</NodeLabel>
                  <NodeReviser
                    current={draft.trim()}
                    busy={busy !== null}
                    onRevise={(instr) => transforms.reviseNode(bookId, layer as NodeLayer, draft.trim(), instr, pageId)}
                    onAccept={acceptRevision}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {!isProse && (
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-[hsl(var(--pv-border-soft))] pt-3">
            <Button variant="ghost" onClick={onClose} disabled={busy !== null}>Close</Button>
            <Button onClick={() => void save()} disabled={loading || busy !== null}>
              {busy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
