// BuildStudio — the AI-tools build surface, as one studio. Replaces the old "step rail bolted above a
// dense graph" (JourneyStudio + ResolutionMap) with a single two-pane workbench: a Navigator (the
// 9-step ladder + the whole-book map) beside a Stage (the open step's tool, or a page's resolution
// ladder). It owns the selection, the derived model, and the one non-derivable write — approve().
//
// State is still derived from real artifacts (see studioModel): the host passes brief/pages/journey;
// this component additionally reads the three flags that can't be cheaply derived from `pages`
// (spine text + staleness, a saved voice, a completed editor's read) so the Navigator's dots are
// correct without having to open each step first.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { briefToPromptContext, type Brief } from "@/lib/brief";
import { seedGenreThreads, type Foundations } from "@/lib/foundations";
import type { LintThread } from "@/lib/lints";
import { metaHash } from "@/lib/planProvenance";
import {
  buildStudioModel, rootFingerprints, type Journey, type StepKey, type StudioPageRow,
} from "./studioModel";
import { StudioNavigator } from "./StudioNavigator";
import { StudioStage } from "./StudioStage";
import { StudioEditorRail } from "./StudioEditorRail";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { useActiveStep } from "./useActiveStep";

export type Selection = { kind: "step"; step: StepKey } | { kind: "page"; pageId: number };

interface BuildStudioProps {
  bookId: number;
  briefSet: boolean;
  brief: Brief | null;
  pages: StudioPageRow[];
  journey: Journey;
  isPublic: boolean;
  onBriefChange: (brief: Brief) => void;
  onChanged: () => void;
  onPublish: () => void;
}

export function BuildStudio({ bookId, briefSet, brief, pages, journey, isPublic, onBriefChange, onChanged, onPublish }: BuildStudioProps) {
  const { toast } = useToast();

  // Explicit selection (null = follow the derived current step). Set on any click; advanced on approve.
  // Persisted per book so a refresh keeps you on the step/page you were viewing (refresh = no-op).
  const selKey = `studio-sel:${bookId}`;
  const [selected, setSelected] = useState<Selection | null>(() => {
    try {
      const raw = localStorage.getItem(selKey);
      return raw ? (JSON.parse(raw) as Selection) : null;
    } catch {
      return null;
    }
  });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [approving, setApproving] = useState<StepKey | null>(null);

  // The non-page-derived flags. Seeded from a fetch, then kept live by the leaf tools' callbacks.
  const [spine, setSpine] = useState<{ text: string; stale: boolean }>({ text: "", stale: false });
  const [hasRead, setHasRead] = useState(false);
  const [foundations, setFoundations] = useState<Foundations | null | undefined>(undefined);
  const [canonParent, setCanonParent] = useState<string | null>(null);
  const [threads, setThreads] = useState<LintThread[]>([]);
  const [infoKey, setInfoKey] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [{ data: book }, { data: ev }, { data: th }] = await Promise.all([
        supabase.from("books").select("spine, foundations, canon").eq("id", bookId).maybeSingle(),
        supabase.from("book_evaluations").select("id").eq("book_id", bookId).eq("status", "done").limit(1),
        supabase.from("book_threads").select("id, name, status, book_thread_anchors(role)").eq("book_id", bookId),
      ]);
      if (!alive) return;
      const sp = (book?.spine as { text?: string; brief_hash?: string } | null) ?? null;
      const text = (sp?.text ?? "").trim();
      const stale = !!sp?.brief_hash && sp.brief_hash !== metaHash(briefToPromptContext(brief) ?? "");
      setSpine({ text, stale });
      setHasRead((ev?.length ?? 0) > 0);
      setFoundations((book?.foundations as Foundations | null) ?? null);
      setCanonParent(((book?.canon as { parent_title?: string } | null)?.parent_title ?? "").trim() || null);
      setThreads(((th as Array<{ id: number; name: string; status: string; book_thread_anchors: Array<{ role: string }> }> | null) ?? [])
        .map((t) => ({ id: t.id, name: t.name, status: t.status, resolutionCount: (t.book_thread_anchors ?? []).filter((a) => a.role === "resolution").length })));
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, infoKey]);

  // Wrap the host refresh so a change anywhere also re-reads spine/voice/read.
  const refresh = useCallback(() => { onChanged(); setInfoKey((k) => k + 1); }, [onChanged]);

  const briefContext = useMemo(() => briefToPromptContext(brief), [brief]);

  const model = useMemo(
    () => buildStudioModel({ briefSet, briefContext, spineText: spine.text, spineStale: spine.stale, pages, journey, hasRead, isPublic, foundations: foundations ?? null, threads }),
    [briefSet, briefContext, spine.text, spine.stale, pages, journey, hasRead, isPublic, foundations, threads]
  );

  const selection: Selection = useMemo(() => selected ?? { kind: "step", step: model.current }, [selected, model]);

  // When a change comes FROM the editor rail (e.g. applying a revision), pin the current selection
  // before refreshing — otherwise the recomputed derived `current` (which jumps to the first stale
  // step after, say, a spine edit) would swap the rail to another layer's chat under the author.
  const railOnChanged = useCallback(() => { setSelected(selection); refresh(); }, [selection, refresh]);

  // Persist the explicit selection so a reload reopens it; clearing it (back to derived current)
  // wipes the key.
  useEffect(() => {
    try {
      if (selected) localStorage.setItem(selKey, JSON.stringify(selected));
      else localStorage.removeItem(selKey);
    } catch { /* storage unavailable — selection just won't persist */ }
  }, [selected, selKey]);

  // Drop a stale persisted selection: a page a later build archived, or a step that's now locked.
  // Without this a reload could reopen something the manuscript no longer has. Guard on readiness —
  // `foundations === undefined` means the studio's own data hasn't loaded; `pages.length === 0` means
  // the host hasn't delivered the manuscript yet — so we don't wipe a valid selection mid-load.
  useEffect(() => {
    if (!selected || foundations === undefined) return;
    if (selected.kind === "page") {
      if (pages.length > 0 && !model.pageById(selected.pageId)) setSelected(null);
    } else if (model.statusOf(selected.step) === "locked") {
      setSelected(null);
    }
  }, [selected, model, foundations, pages.length]);

  // Which step has a live AI run — the Navigator marks it "● running" (a badge, not auto-navigation).
  const runningStep = useActiveStep(bookId);

  // The editor RAIL: the current step's editor, docked on the right. Foundations/spine/beats get the
  // conversational ReviseChat; the Draft step gets the durable ProseEditor. The rail shows whenever
  // one of the editor steps is selected — the empty-center + live-chat is the intended first-run state.
  const railStep: StepKey | null =
    selection.kind === "step" && (selection.step === "foundations" || selection.step === "spine" || selection.step === "outline" || selection.step === "beats" || selection.step === "draft")
      ? selection.step : null;
  // A selected page gets its own prose chat in the rail (page-scoped revise-agent).
  const railPageId: number | null = selection.kind === "page" ? selection.pageId : null;
  const showRail = !!railStep || railPageId != null;

  const approve = async (k: StepKey) => {
    if (approving) return;
    setApproving(k);
    try {
      const { data } = await supabase.from("books").select("journey").eq("id", bookId).maybeSingle();
      // Stamp the upstream-root fingerprints alongside the timestamp, so we can later tell when a layer
      // above this step has drifted (studioModel.staleOf). Re-approving a stale step re-stamps and clears.
      const roots = rootFingerprints(briefContext, foundations ?? null, spine.text);
      const next = { ...((data?.journey as Journey | null) ?? {}), [k]: { at: new Date().toISOString(), ...roots } };
      const { error } = await supabase.from("books").update({ journey: next }).eq("id", bookId);
      if (error) throw error;
      const idx = model.buildSteps.indexOf(k);
      const nextStep: StepKey = idx >= 0 && idx < model.buildSteps.length - 1 ? model.buildSteps[idx + 1] : "read";
      setSelected({ kind: "step", step: nextStep });
      refresh();
    } catch (e) {
      toast({ title: "Couldn't save your approval", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setApproving(null);
    }
  };

  // Brief saves also seed the genre's promise-ledger threads in the new flow (§3.1) — idempotent.
  const handleBriefChange = useCallback((b: Brief) => {
    onBriefChange(b);
    if (foundations != null) void seedGenreThreads(bookId, b.genre).catch(() => {});
  }, [onBriefChange, foundations, bookId]);

  // Hold rendering until the flow flag is known, so the rail doesn't flash old→new.
  if (foundations === undefined) {
    return <section className="min-h-[60vh]" />;
  }

  const nav = (
    <StudioNavigator
      model={model}
      selection={selection}
      collapsed={collapsed}
      runningStep={runningStep}
      onSelectStep={(k) => setSelected({ kind: "step", step: k })}
      onSelectPage={(pageId) => setSelected({ kind: "page", pageId })}
      onToggleMovement={(key) => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}
    />
  );
  const stage = (
    <StudioStage
      model={model}
      bookId={bookId}
      selection={selection}
      brief={brief}
      foundations={foundations}
      isPublic={isPublic}
      approving={approving}
      editorEpoch={infoKey}
      onApprove={approve}
      onChanged={refresh}
      onBriefChange={handleBriefChange}
      onSpineStatus={() => setInfoKey((k) => k + 1)}
      onReadStatus={setHasRead}
      onSelectStep={(k) => setSelected({ kind: "step", step: k })}
      onPublish={onPublish}
      onSelectPage={(pageId) => setSelected({ kind: "page", pageId })}
    />
  );
  const rail = showRail ? (
    <StudioEditorRail
      bookId={bookId}
      step={railStep ?? undefined}
      pageId={railPageId ?? undefined}
      model={model}
      foundations={foundations ?? null}
      spineText={spine.text}
      onChanged={railOnChanged}
    />
  ) : null;

  return (
    <div className="flex h-full flex-col">
      {canonParent && (
        <p className="pv-serif shrink-0 px-6 pt-3 text-[13px] italic text-[hsl(var(--pv-text-muted))] md:px-8">
          Sequel — continuing <em>“{canonParent}”</em>. Its canon (final state, cast, open threads) constrains every generation here.
        </p>
      )}

      {/* Desktop: draggable columns. Widths persist per pane-count (autoSaveId), so the author's
          chosen split survives reloads and the rail appearing/disappearing keeps its own layout. */}
      <ResizablePanelGroup
        key={rail ? "panes-3" : "panes-2"}
        autoSaveId={rail ? "studio-panes-3" : "studio-panes-2"}
        direction="horizontal"
        className="hidden min-h-0 flex-1 md:flex"
      >
        <ResizablePanel defaultSize={rail ? 20 : 22} minSize={14} maxSize={36}>
          {nav}
        </ResizablePanel>
        <ResizableHandle className="w-1.5 bg-transparent transition-colors hover:bg-[hsl(var(--pv-accent))]/30 data-[resize-handle-state=drag]:bg-[hsl(var(--pv-accent))]/50" />
        <ResizablePanel defaultSize={rail ? 52 : 78} minSize={32}>
          {stage}
        </ResizablePanel>
        {rail && (
          <>
            <ResizableHandle className="w-1.5 bg-transparent transition-colors hover:bg-[hsl(var(--pv-accent))]/30 data-[resize-handle-state=drag]:bg-[hsl(var(--pv-accent))]/50" />
            <ResizablePanel defaultSize={28} minSize={18} maxSize={44}>
              {rail}
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      {/* Mobile: the same panes, stacked. Fixed-height wrappers give each pane's internal scroll a
          definite height to fill. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:hidden">
        <div className="h-[45vh] shrink-0 overflow-hidden">{nav}</div>
        <div className="h-[70vh] shrink-0 overflow-hidden">{stage}</div>
        {rail && <div className="h-[70vh] shrink-0 overflow-hidden">{rail}</div>}
      </div>
    </div>
  );
}
