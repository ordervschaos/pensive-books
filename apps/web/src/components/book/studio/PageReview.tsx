// PageReview — the Stage in "open a page" mode: that page's full resolution ladder
// (objective · beat · prose), each level readable, editable, and regenerable in place without leaving
// the studio. Reuses the ladder client for the short nodes and ProseNodePanel for the prose body, so a
// page reviewed here writes through the exact same persistence the map's node sheet used.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDown, ExternalLink, Loader2, Lock, Sparkles } from "lucide-react";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { useToast } from "@/hooks/use-toast";
import { readNode, readProse, saveBeat, saveObjective, transforms } from "@/lib/ladder";
import type { CellState } from "@/lib/planGraph";
import { DurableOptions } from "../DurableOptions";
import { DurableReviser } from "../DurableReviser";
import { ProseNodePanel } from "../ProseNodePanel";
import type { StudioModel } from "./studioModel";
import { Pip } from "./studioUi";
import { CharacterLedgerGraph } from "./CharacterLedgerGraph";

interface PageReviewProps {
  bookId: number;
  model: StudioModel;
  pageId: number;
  onChanged: () => void;
  onSelectPage: (pageId: number) => void;
}

export function PageReview({ bookId, model, pageId, onChanged, onSelectPage }: PageReviewProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const page = model.pageById(pageId);
  const idx = model.textIndexOf(pageId);
  const movement = model.movements.find((m) => m.pages.some((p) => p.id === pageId));

  // Live node text, loaded for this page (the model carries presence; we need the editable strings).
  const [objective, setObjective] = useState("");
  const [beat, setBeat] = useState("");
  const [prose, setProse] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"objective" | "beat" | null>(null);
  const [showLedger, setShowLedger] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    const req = ++reqRef.current;
    setLoading(true);
    Promise.all([
      readNode(bookId, "objective", pageId),
      readNode(bookId, "beat", pageId),
      readProse(pageId),
    ]).then(([o, b, p]) => {
      if (req !== reqRef.current) return;
      setObjective(o); setBeat(b); setProse(p);
    }).finally(() => { if (req === reqRef.current) setLoading(false); });
  }, [bookId, pageId]);

  if (!page) return null;

  const fail = (title: string, e: unknown) => toast({ variant: "destructive", title, description: String((e as Error)?.message ?? e) });

  const saveObjectiveText = async () => {
    setBusy("objective");
    try { await saveObjective(bookId, pageId, objective.trim()); onChanged(); }
    catch (e) { fail("Couldn't save the objective", e); }
    finally { setBusy(null); }
  };

  const planBeat = async () => {
    setBusy("beat");
    try {
      const obj = objective.trim() || (await readNode(bookId, "objective", pageId));
      if (!obj) throw new Error("Set an objective first.");
      const text = await transforms.objectiveToBeat(bookId, pageId, obj);
      setBeat(text);
      await saveBeat(bookId, pageId, text);
      onChanged();
    } catch (e) { fail("Couldn't plan the beat", e); }
    finally { setBusy(null); }
  };

  const saveBeatText = async () => {
    setBusy("beat");
    try { await saveBeat(bookId, pageId, beat.trim()); onChanged(); }
    catch (e) { fail("Couldn't save the beat", e); }
    finally { setBusy(null); }
  };

  return (
    <div>
      <div className="flex items-center gap-2.5 pv-serif text-[13px] text-[hsl(var(--pv-text-muted))]">
        <span className="pv-mono text-[9.5px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">
          {movement?.num ? `${movement.num} · ` : ""}{movement?.title ?? "Pages"}
        </span>
        <span className="text-[hsl(var(--pv-text-faint))]">▸</span>
        <span className="italic">page {idx + 1}</span>
        <button
          type="button"
          onClick={() => navigate(`/books/${bookId}/pages/${pageId}`)}
          className="ml-auto inline-flex items-center gap-1.5 italic text-[hsl(var(--pv-accent))] hover:opacity-75"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Open in Manuscript
        </button>
      </div>
      <h1 className="pv-serif mt-3 text-[36px] leading-[1.14] tracking-[-0.015em] text-foreground">{page.title || "(untitled)"}</h1>
      <p className="pv-serif mt-2 text-[15px] leading-[1.5] text-[hsl(var(--pv-text-muted))]">
        The page's resolution ladder — read, edit, or regenerate any level without leaving your place.
      </p>

      {/* Muted disclosure: the character ledger (the state axis) and how it moves across the book. */}
      <button
        type="button"
        onClick={() => setShowLedger((v) => !v)}
        className="mt-1.5 pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))] underline decoration-dotted underline-offset-2 hover:text-[hsl(var(--pv-text-muted))]"
      >
        {showLedger ? "hide character ledger" : "character ledger — how it changes across pages"}
      </button>
      {showLedger && (
        <div className="mt-3 rounded-2xl border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 px-4 py-3">
          <CharacterLedgerGraph bookId={bookId} currentPageId={pageId} onSelectPage={onSelectPage} />
        </div>
      )}
      <div className="mb-6" />

      {loading ? (
        <p className="pv-serif inline-flex items-center gap-2 text-[14px] italic text-[hsl(var(--pv-text-muted))]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the ladder…
        </p>
      ) : (
        <>
          <LevelCard label="Objective" sub="the plan's contract" state={objective.trim() ? "synced" : "gap"}>
            <AutoTextarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              onBlur={() => objective.trim() && void saveObjectiveText()}
              className="pv-serif border-none bg-transparent px-0 text-[15.5px] leading-[1.55] focus-visible:ring-0"
              placeholder="What this page must achieve…"
            />
            <div className="mt-3 flex items-center gap-4 border-t border-[hsl(var(--pv-border-soft))] pt-3">
              <DurableReviser
                bookId={bookId}
                layer="objective"
                targetKey={`revise:objective:${pageId}`}
                targetPageId={pageId}
                current={objective.trim()}
                busy={busy !== null}
                onApply={async (proposed) => {
                  setObjective(proposed);
                  await saveObjective(bookId, pageId, proposed);
                  onChanged();
                }}
              />
              <DurableOptions
                bookId={bookId}
                kind="objective_options"
                targetPageId={pageId}
                busy={busy !== null}
                getParams={() => ({ pageId })}
                onApply={async (proposed) => {
                  setObjective(proposed);
                  await saveObjective(bookId, pageId, proposed);
                  onChanged();
                }}
              />
            </div>
          </LevelCard>

          <DownArrow />

          <LevelCard label="Beat" sub="what happens, in order" state={beat.trim() ? "synced" : "gap"}>
            {beat.trim() ? (
              <>
                <AutoTextarea
                  value={beat}
                  onChange={(e) => setBeat(e.target.value)}
                  onBlur={() => void saveBeatText()}
                  className="pv-serif border-none bg-transparent px-0 text-[15.5px] leading-[1.6] focus-visible:ring-0"
                />
                <RegenRow busy={busy === "beat"} onRegen={planBeat} />
              </>
            ) : (
              <EmptyRow
                label="No beat yet — plan it before the prose."
                cta="Plan this beat"
                busy={busy === "beat"}
                onClick={planBeat}
              />
            )}
          </LevelCard>

          <DownArrow />

          <LevelCard label="Prose" sub="the written page" state={prose.trim() ? "synced" : beat.trim() ? "gap" : "locked"}>
            {beat.trim() ? (
              <ProseNodePanel
                bookId={bookId}
                pageId={pageId}
                pageTitle={page.title}
                objective={objective}
                beat={beat}
                prose={prose}
                onSaved={() => { void readProse(pageId).then(setProse); onChanged(); }}
                onOpenPage={() => navigate(`/books/${bookId}/pages/${pageId}`)}
              />
            ) : (
              <p className="pv-serif flex items-center gap-2 text-[14.5px] italic text-[hsl(var(--pv-text-faint))]">
                <Lock className="h-3.5 w-3.5" /> Plan the beat first — prose is written from it.
              </p>
            )}
          </LevelCard>
        </>
      )}

      <div className="mt-6 flex items-center justify-between border-t border-[hsl(var(--pv-border-soft))] pt-5">
        {idx > 0 ? (
          <button type="button" onClick={() => onSelectPage(model.textPages[idx - 1].id)} className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">
            ← previous page
          </button>
        ) : <span />}
        {idx < model.textPages.length - 1 ? (
          <button type="button" onClick={() => onSelectPage(model.textPages[idx + 1].id)} className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">
            next page →
          </button>
        ) : <span />}
      </div>
    </div>
  );
}

function LevelCard({ label, sub, state, children }: { label: string; sub: string; state: CellState | "locked"; children: ReactNode }) {
  const dim = state === "gap" || state === "locked";
  return (
    <div className={`rounded-2xl border px-5 py-4 ${dim ? "border-dashed border-[hsl(var(--pv-border-soft))] bg-transparent" : "border-border bg-[hsl(var(--pv-surface-2))]/50"} ${state === "locked" ? "opacity-65" : ""}`}>
      <div className={`flex items-center gap-2.5 ${dim ? "" : "mb-3"}`}>
        <Pip state={state === "locked" ? "gap" : state} />
        <span className="pv-mono text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">{label}</span>
        <span className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">· {sub}</span>
        {state === "synced" && <span className="ml-auto pv-mono text-[9px] uppercase tracking-[0.12em] text-[hsl(var(--pv-accent))]">in sync</span>}
        {state === "locked" && <Lock className="ml-auto h-3.5 w-3.5 text-[hsl(var(--pv-text-faint))]" />}
      </div>
      {children}
    </div>
  );
}

function DownArrow() {
  return <div className="flex justify-center py-0.5 text-[hsl(var(--pv-text-faint))]"><ArrowDown className="h-4 w-4" /></div>;
}

function RegenRow({ busy, onRegen }: { busy: boolean; onRegen: () => void }) {
  return (
    <div className="mt-3 flex gap-5 text-[13.5px]">
      <button type="button" onClick={onRegen} disabled={busy} className="inline-flex items-center gap-1.5 italic text-[hsl(var(--pv-accent))] hover:opacity-75 disabled:opacity-50">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} regenerate from the objective
      </button>
    </div>
  );
}

function EmptyRow({ label, cta, busy, onClick }: { label: string; cta: string; busy: boolean; onClick: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 pt-1">
      <span className="pv-serif text-[14.5px] italic text-[hsl(var(--pv-text-muted))]">{label}</span>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="pv-serif inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[hsl(var(--pv-accent))]/[0.08] px-4 py-2 text-[14px] text-[hsl(var(--pv-accent))] transition-colors hover:bg-[hsl(var(--pv-accent))]/[0.14] disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {cta}
      </button>
    </div>
  );
}
