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
import { metaHash } from "@/lib/planProvenance";
import type { RevisionPrefill } from "../ReviseWithAI";
import {
  BUILD_STEPS, buildStudioModel, type Journey, type StepKey, type StudioPageRow,
} from "./studioModel";
import { StudioNavigator } from "./StudioNavigator";
import { StudioStage } from "./StudioStage";

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
  const [selected, setSelected] = useState<Selection | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [approving, setApproving] = useState<StepKey | null>(null);
  const [revisionPrefill, setRevisionPrefill] = useState<RevisionPrefill | null>(null);

  // The three non-page-derived flags. Seeded from a fetch, then kept live by the leaf tools' callbacks.
  const [spine, setSpine] = useState<{ text: string; stale: boolean }>({ text: "", stale: false });
  const [hasVoice, setHasVoice] = useState(false);
  const [hasRead, setHasRead] = useState(false);
  const [infoKey, setInfoKey] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [{ data: book }, { data: ev }] = await Promise.all([
        supabase.from("books").select("spine, bible").eq("id", bookId).maybeSingle(),
        supabase.from("book_evaluations").select("id").eq("book_id", bookId).eq("status", "done").limit(1),
      ]);
      if (!alive) return;
      const sp = (book?.spine as { text?: string; brief_hash?: string } | null) ?? null;
      const text = (sp?.text ?? "").trim();
      const stale = !!sp?.brief_hash && sp.brief_hash !== metaHash(briefToPromptContext(brief) ?? "");
      setSpine({ text, stale });
      setHasVoice(!!((book?.bible as { voice_sample?: string } | null)?.voice_sample ?? "").trim());
      setHasRead((ev?.length ?? 0) > 0);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, infoKey]);

  // Wrap the host refresh so a change anywhere also re-reads spine/voice/read.
  const refresh = useCallback(() => { onChanged(); setInfoKey((k) => k + 1); }, [onChanged]);

  const model = useMemo(
    () => buildStudioModel({ briefSet, spineText: spine.text, spineStale: spine.stale, pages, journey, hasVoice, hasRead, isPublic }),
    [briefSet, spine.text, spine.stale, pages, journey, hasVoice, hasRead, isPublic]
  );

  const selection: Selection = selected ?? { kind: "step", step: model.current };

  const approve = async (k: StepKey) => {
    if (approving) return;
    setApproving(k);
    try {
      const { data } = await supabase.from("books").select("journey").eq("id", bookId).maybeSingle();
      const next = { ...((data?.journey as Journey | null) ?? {}), [k]: new Date().toISOString() };
      const { error } = await supabase.from("books").update({ journey: next }).eq("id", bookId);
      if (error) throw error;
      const idx = BUILD_STEPS.indexOf(k);
      const nextStep: StepKey = idx >= 0 && idx < BUILD_STEPS.length - 1 ? BUILD_STEPS[idx + 1] : "read";
      setSelected({ kind: "step", step: nextStep });
      refresh();
    } catch (e) {
      toast({ title: "Couldn't save your approval", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setApproving(null);
    }
  };

  return (
    <section className="grid h-[78vh] min-h-[620px] max-h-[940px] grid-rows-[minmax(0,38%)_1fr] overflow-hidden rounded-2xl border border-border bg-background md:grid-cols-[320px_1fr] md:grid-rows-1">
      <StudioNavigator
        model={model}
        selection={selection}
        collapsed={collapsed}
        onSelectStep={(k) => setSelected({ kind: "step", step: k })}
        onSelectPage={(pageId) => setSelected({ kind: "page", pageId })}
        onToggleMovement={(key) => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}
      />
      <StudioStage
        model={model}
        bookId={bookId}
        selection={selection}
        brief={brief}
        isPublic={isPublic}
        revisionPrefill={revisionPrefill}
        approving={approving}
        onApprove={approve}
        onChanged={refresh}
        onBriefChange={onBriefChange}
        onSpineStatus={() => setInfoKey((k) => k + 1)}
        onVoiceStatus={setHasVoice}
        onReadStatus={setHasRead}
        onRevisePrefill={setRevisionPrefill}
        onPublish={onPublish}
        onSelectPage={(pageId) => setSelected({ kind: "page", pageId })}
      />
    </section>
  );
}
