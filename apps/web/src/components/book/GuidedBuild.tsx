import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Lock, Check, ChevronRight } from "lucide-react";
import { ScaffoldGenerator } from "./ScaffoldGenerator";
import { VoiceGenerator } from "./VoiceGenerator";
import { SpineGenerator } from "./SpineGenerator";
import { PlanBeats } from "./PlanBeats";
import { DraftProse } from "./DraftProse";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { EditorJSON } from "@/types/editor";

interface BuildPage {
  page_type?: "text" | "section";
  content?: EditorJSON | null;
  metadata?: { objective?: string; beat?: string } | null;
}

// The approval ledger lives on books.journey: each key is an ISO timestamp set when the author
// cleared that level. Absent = not yet approved.
type StepKey = "brief" | "spine" | "outline" | "voice" | "beats" | "draft";
type Journey = Partial<Record<StepKey, string>>;

interface GuidedBuildProps {
  bookId: number;
  briefSet: boolean;
  pages: BuildPage[];
  journey: Journey;
  /** Open the brief editor (lives in its own tab). */
  onEditBrief: () => void;
  /** Refresh the host after pages/spine/voice change. */
  onChanged: () => void;
  /** Leave the guided flow for the full tabbed workspace (always available — guided-only lock). */
  onExit: () => void;
}

function bodyText(content: unknown): string {
  if (!content || typeof content !== "object") return typeof content === "string" ? content : "";
  const doc = content as { content?: Array<Record<string, unknown>> };
  if (!Array.isArray(doc.content)) return "";
  const nodes = doc.content[0]?.type === "heading" ? doc.content.slice(1) : doc.content;
  const walk = (n: Record<string, unknown>): string =>
    n.type === "text" ? String(n.text ?? "") : ((n.content as Array<Record<string, unknown>>) ?? []).map(walk).join("");
  return nodes.map(walk).join("").trim();
}

type StepState = "locked" | "active" | "awaiting" | "done";

/**
 * The guided, game-like build ladder: brief → spine → outline → voice → beats → draft prose. Each
 * level must be VERIFIED — the author clicks "Approve & continue" — before the next unlocks. Approvals
 * are persisted to books.journey, so a cleared level stays cleared across refreshes. The lock is
 * guided-only: the author can leave for the full workspace (and hand-edit) at any time.
 *
 * Per step: locked (a prior level isn't cleared) · active (do the work) · awaiting (work is ready,
 * approve to advance) · done (approved). "Ready to approve" is computed from real artifacts — you
 * can't approve a spine that doesn't exist.
 */
export function GuidedBuild({ bookId, briefSet, pages, journey, onEditBrief, onChanged, onExit }: GuidedBuildProps) {
  const { toast } = useToast();
  const [approving, setApproving] = useState<StepKey | null>(null);

  // Live "is the artifact ready to approve?" signals, computed from pages + child-reported state.
  const counts = useMemo(() => {
    let objective = 0, written = 0, beats = 0, textPages = 0;
    for (const p of pages) {
      if (p.page_type === "section") continue;
      textPages += 1;
      if (bodyText(p.content)) written += 1;
      else if (p.metadata?.objective) objective += 1;
      if ((p.metadata?.beat ?? "").trim()) beats += 1;
    }
    return { objective, written, beats, textPages };
  }, [pages]);
  const hasScaffold = counts.objective > 0 || counts.written > 0;
  const beatsRemaining = Math.max(0, counts.objective + counts.written - counts.beats); // objective-bearing pages without a beat
  const proseRemaining = counts.objective; // empty objective-bearing pages

  const [hasSpine, setHasSpine] = useState(false);
  const [hasVoice, setHasVoice] = useState(false);

  // ── Readiness: can this step be approved right now? ──
  const ready: Record<StepKey, boolean> = {
    brief: briefSet,
    spine: hasSpine,
    outline: hasScaffold,
    voice: hasVoice,
    beats: hasScaffold && beatsRemaining === 0 && counts.beats > 0,
    draft: counts.written > 0 && proseRemaining === 0,
  };

  const approved = (k: StepKey) => !!journey[k];

  // A step is done when approved; active when the prior step is done and it isn't; locked otherwise.
  // "awaiting" is an active step whose artifact is ready (so the Approve button lights up).
  const ORDER: StepKey[] = ["brief", "spine", "outline", "voice", "beats", "draft"];
  function stateOf(k: StepKey): StepState {
    if (approved(k)) return "done";
    const idx = ORDER.indexOf(k);
    const priorDone = idx === 0 || approved(ORDER[idx - 1]);
    if (!priorDone) return "locked";
    return ready[k] ? "awaiting" : "active";
  }

  const approve = async (k: StepKey) => {
    if (approving) return;
    setApproving(k);
    try {
      const { data } = await supabase.from("books").select("journey").eq("id", bookId).maybeSingle();
      const next = { ...((data?.journey as Journey | null) ?? {}), [k]: new Date().toISOString() };
      const { error } = await supabase.from("books").update({ journey: next }).eq("id", bookId);
      if (error) throw error;
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't save your approval", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setApproving(null);
    }
  };

  const allDone = ORDER.every(approved);

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--pv-border-soft))] px-5 py-4">
        <span className="pv-eyebrow">Build with AI · the guided path</span>
        <button type="button" onClick={onExit} className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">
          {allDone ? "Open the full workspace →" : "Skip to the full workspace →"}
        </button>
      </div>

      <ol className="px-5 py-6">
        <Step n={1} total={6} state={stateOf("brief")} title="Set the brief" caption="Tell the AI what the book is — every step below is drawn from it.">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={onEditBrief}>{briefSet ? "Edit the brief" : "Set the brief"}</Button>
            <ApproveButton show={stateOf("brief") === "awaiting"} label="Approve & continue" onClick={() => void approve("brief")} busy={approving === "brief"} />
          </div>
        </Step>

        <Step n={2} total={6} state={stateOf("spine")} title="Find the spine" caption="The one-paragraph throughline the whole book realizes.">
          <div className="space-y-3">
            <SpineGenerator bookId={bookId} onStatusChange={setHasSpine} onChanged={onChanged} />
            <ApproveButton show={stateOf("spine") === "awaiting"} label="Approve the spine & continue" onClick={() => void approve("spine")} busy={approving === "spine"} />
          </div>
        </Step>

        <Step n={3} total={6} state={stateOf("outline")} title="Generate the outline" caption="The chapters and pages as objectives — review, edit, create. No prose yet.">
          <div className="space-y-3">
            {hasScaffold
              ? <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">Outline in place — {counts.objective + counts.written} pages. Edit pages in the workspace if needed.</p>
              : <ScaffoldGenerator bookId={bookId} onCreated={onChanged} />}
            <ApproveButton show={stateOf("outline") === "awaiting"} label="Approve the outline & continue" onClick={() => void approve("outline")} busy={approving === "outline"} />
          </div>
        </Step>

        <Step n={4} total={6} state={stateOf("voice")} title="Pick the voice" caption="Choose how the book sounds — it anchors every page the AI writes.">
          <div className="space-y-3">
            <VoiceGenerator bookId={bookId} onStatusChange={setHasVoice} onChosen={onChanged} />
            <ApproveButton show={stateOf("voice") === "awaiting"} label="Approve the voice & continue" onClick={() => void approve("voice")} busy={approving === "voice"} />
          </div>
        </Step>

        <Step n={5} total={6} state={stateOf("beats")} title="Plan the beats" caption="Plan what each page does — causal order, value flips, concrete images — before any prose.">
          <div className="space-y-3">
            <PlanBeats bookId={bookId} remaining={beatsRemaining} onChanged={onChanged} />
            {counts.beats > 0 && (
              <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">
                {counts.beats} beat{counts.beats === 1 ? "" : "s"} planned{beatsRemaining > 0 ? `, ${beatsRemaining} to go` : ""}. Read them on each page in the workspace.
              </p>
            )}
            <ApproveButton show={stateOf("beats") === "awaiting"} label="Approve the beats & continue" onClick={() => void approve("beats")} busy={approving === "beats"} />
          </div>
        </Step>

        <Step n={6} total={6} state={stateOf("draft")} title="Write the draft" caption="Render the prose from the approved beats, in the book's voice." last>
          <div className="space-y-3">
            <DraftProse bookId={bookId} remaining={proseRemaining} onChanged={onChanged} />
            <ApproveButton show={stateOf("draft") === "awaiting"} label="Finish — open the full workspace" onClick={async () => { await approve("draft"); onExit(); }} busy={approving === "draft"} />
          </div>
        </Step>
      </ol>

      {allDone && (
        <div className="border-t border-[hsl(var(--pv-border-soft))] px-5 py-4">
          <p className="pv-serif text-[14px] text-foreground">The draft is built. The editor's read, auto-revise, and publishing live in the full workspace.</p>
          <Button size="sm" className="mt-2" onClick={onExit}>Open the full workspace</Button>
        </div>
      )}
    </section>
  );
}

function ApproveButton({ show, label, onClick, busy }: { show: boolean; label: string; onClick: () => void; busy: boolean }) {
  if (!show) return null;
  return (
    <Button size="sm" onClick={onClick} disabled={busy}>
      <Check className="mr-2 h-4 w-4" /> {busy ? "Saving…" : label}
    </Button>
  );
}

// One rung of the ladder: a status node on the rail + the step's content (hidden when locked).
function Step({ n, total, state, title, caption, children, last }: {
  n: number; total: number; state: StepState; title: string; caption: string; children: ReactNode; last?: boolean;
}) {
  const done = state === "done";
  const locked = state === "locked";
  return (
    <li className="relative flex gap-4 pb-7 last:pb-0">
      {!last && <span aria-hidden className="absolute left-[15px] top-8 bottom-0 w-px bg-[hsl(var(--pv-border-soft))]" />}
      <span
        className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums"
        style={
          done
            ? { background: "hsl(var(--pv-accent))", color: "white" }
            : locked
              ? { boxShadow: "inset 0 0 0 1.5px hsl(var(--pv-text-faint))", color: "hsl(var(--pv-text-faint))" }
              : { boxShadow: "inset 0 0 0 1.5px hsl(var(--pv-accent))", color: "hsl(var(--pv-accent))" }
        }
      >
        {done ? <Check className="h-4 w-4" /> : locked ? <Lock className="h-3.5 w-3.5" /> : n}
      </span>
      <div className={`min-w-0 flex-1 pt-0.5 ${locked ? "opacity-60" : ""}`}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className="pv-serif text-[17px] leading-snug text-foreground">{title}</h3>
          {done && <span className="pv-mono text-[10px] uppercase tracking-[0.1em] text-[hsl(var(--pv-accent))]">done</span>}
          {state === "awaiting" && <span className="pv-mono inline-flex items-center gap-0.5 text-[10px] uppercase tracking-[0.1em] text-[#5b6db8]"><ChevronRight className="h-3 w-3" />ready</span>}
        </div>
        <p className="pv-serif mt-0.5 text-[13.5px] italic leading-snug text-[hsl(var(--pv-text-faint))]">{caption}</p>
        {!locked && <div className="mt-3">{children}</div>}
        {locked && (
          <p className="mt-2 pv-serif flex items-center gap-2 text-[13px] italic text-[hsl(var(--pv-text-faint))]">
            <Lock className="h-3.5 w-3.5" /> Clear the previous step to unlock.
          </p>
        )}
      </div>
    </li>
  );
}
