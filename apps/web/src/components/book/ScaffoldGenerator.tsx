import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AIActionRow } from "./AIActionRow";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const BRIDGE = import.meta.env.VITE_EVAL_BRIDGE_URL as string | undefined;

interface ScaffoldPage {
  pageType: "section" | "text";
  title: string;
  objective?: string;
}
// A planned thread the scaffold proposes, anchored to pages by their index in pages[].
interface ScaffoldThread {
  name: string;
  description: string;
  setupPageIndex: number | null;
  payoffPageIndex: number | null;
  targetDistance: number | null;
}
interface Scaffold {
  structure: string;
  pages: ScaffoldPage[];
  threads?: ScaffoldThread[];
}

interface ScaffoldGeneratorProps {
  bookId: number;
  /** Called after pages are created (so the host can refresh / enable the toggle in UI). */
  onCreated?: () => void;
}

/**
 * G2 — generate a book's objective tree from its brief. Proposes a chapter/page scaffold
 * (titles + objectives, no prose), lets the author review it, then creates the pages with
 * their objectives set. Honors the thesis: the author reviews the plan before committing.
 */
export function ScaffoldGenerator({ bookId, onCreated }: ScaffoldGeneratorProps) {
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [proposal, setProposal] = useState<Scaffold | null>(null);
  const [open, setOpen] = useState(false);

  const generate = async () => {
    try {
      setGenerating(true);
      let data: Scaffold;
      if (BRIDGE) {
        const r = await fetch(`${BRIDGE}/scaffold/${bookId}`, { method: "POST" });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        if (!d.pages?.length) throw new Error("No scaffold returned");
        data = d as Scaffold;
      } else {
        const { data: fnData, error } = await supabase.functions.invoke("generate-scaffold", {
          body: { bookId },
        });
        if (error) throw error;
        if (!fnData?.pages?.length) throw new Error(fnData?.error || "No scaffold returned");
        data = fnData as Scaffold;
      }
      setProposal(data);
      setOpen(true);
    } catch (e) {
      toast({ title: "Couldn't generate scaffold", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const create = async () => {
    if (!proposal) return;
    try {
      setCreating(true);
      // Create each page via the canonical RPC (handles page_index + valid defaults),
      // then set its title / type / objective. Track the created id at each page index so the
      // planned threads can be anchored to real page ids afterward.
      const createdIds: number[] = [];
      for (const page of proposal.pages) {
        const { data: newPage, error } = await supabase
          .rpc("create_next_page", { p_book_id: bookId })
          .select()
          .single();
        if (error) throw error;
        const newId = (newPage as { id: number }).id;
        createdIds.push(newId);
        const update: Record<string, unknown> = {
          title: page.title,
          page_type: page.pageType,
        };
        if (page.objective) update.metadata = { objective: page.objective };
        const { error: upErr } = await supabase
          .from("pages")
          .update(update)
          .eq("id", newId);
        if (upErr) throw upErr;
      }
      // Scaffolding sets objectives, so turn the objective UI on for this book.
      await supabase.from("books").update({ objectives_enabled: true }).eq("id", bookId);

      // Persist the planned threads, mapping each page-index anchor to its created page id.
      const threadRows = (proposal.threads ?? [])
        .filter((t) => t.name.trim())
        .map((t) => ({
          book_id: bookId,
          name: t.name.trim(),
          description: t.description || null,
          status: "planned",
          source: "ai",
          setup_page_id: t.setupPageIndex != null ? createdIds[t.setupPageIndex] ?? null : null,
          payoff_page_id: t.payoffPageIndex != null ? createdIds[t.payoffPageIndex] ?? null : null,
          target_distance: t.targetDistance,
        }));
      if (threadRows.length) {
        const { error: thErr } = await supabase.from("book_threads").insert(threadRows);
        if (thErr) throw thErr;
      }

      const threadNote = threadRows.length ? ` and ${threadRows.length} planned threads` : "";
      toast({ title: "Scaffold created", description: `${proposal.pages.length} pages added with objectives${threadNote}.` });
      setOpen(false);
      setProposal(null);
      onCreated?.();
    } catch (e) {
      toast({ title: "Couldn't create pages", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <AIActionRow
        icon={<Sparkles className="h-4 w-4" />}
        title={generating ? "Designing…" : "Generate scaffold from brief"}
        description="Propose the book's chapters and pages as objectives (no prose) — review, then create."
        onClick={generate}
        loading={generating}
      />

      <Dialog open={open} onOpenChange={(v) => !creating && setOpen(v)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Review the proposed scaffold</DialogTitle>
            <DialogDescription>
              {proposal?.structure ? `Structure: ${proposal.structure}. ` : ""}
              {proposal?.pages.length ?? 0} pages. Creating them sets each page's objective and turns on
              the objectives UI. You can edit anything afterward.
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 -mx-2 px-2 space-y-1">
            {proposal?.pages.map((p, i) => (
              <div key={i} className={p.pageType === "section" ? "pt-3" : "pl-4"}>
                {p.pageType === "section" ? (
                  <div className="text-sm font-semibold">{p.title}</div>
                ) : (
                  <div className="py-1">
                    <div className="text-sm">{p.title}</div>
                    {p.objective && <div className="text-xs italic text-muted-foreground">◎ {p.objective}</div>}
                  </div>
                )}
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={create} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {creating ? "Creating…" : `Create ${proposal?.pages.length ?? 0} pages`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
