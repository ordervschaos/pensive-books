// DnaOverview — the studio's home/dashboard, the first thing you see. It answers three questions at a
// glance: (1) what's the SHAPE of the book right now (the parent→child tree, collapsed to a map); (2) what's
// the NEXT MOVE (the live "now" stage + its first open sub-step, with quick jumps into the optional branches
// that are also available); (3) what's WRONG (the conformance lints + render blockers, each a click away from
// the stage that owns it). Pure projection of the tree + journey — no generation happens here; every action
// navigates into the stage that holds the real verb. Reuses the engine (validate/renderBlockers) and the
// journey (stageSubsteps) so this never drifts from what the stages themselves compute.
import { useRef, type ReactNode } from "react";
import { ArrowRight, Activity, BookOpen, Check, GitBranch, Network, Sparkles, TriangleAlert, Waypoints } from "lucide-react";
import { ActionLink, Eyebrow, Hero, Panel, StageHead } from "@/components/book/shared/studioUi";
import { DnaFullDiagram } from "@/features/dna/components/DnaStageDiagram";
import { DnaStoryMap } from "@/features/dna/components/DnaStoryMap";
import { DnaAnalysis } from "@/features/dna/components/DnaAnalysis";
import { STAGE_KINDS, stageSubsteps, type JourneyStage, type StageKey } from "@/features/dna/lib/dnaJourney";
import { byId, childrenOf, isProseStale, isStale, validate, type BookSettings, type DnaNode, type NodeKind, type SceneContent } from "@/features/dna/lib/novelDna";

// Which stage owns a node kind (so an issue on a node jumps to the right stage). game lives in Foundations
// (a contest is a species of world rule); thread is edited here on the Overview, so thread-issue clicks are
// special-cased to scroll to the Threads panel rather than routed by this map (the value is just a fallback).
const KIND_STAGE: Record<NodeKind, StageKey> = {
  seed: "premise", premise: "premise",
  pillar: "foundations", character: "foundations", relationship: "foundations", tentpole: "foundations", world_fact: "foundations", location: "foundations", voice_profile: "foundations", game: "foundations",
  act: "structure", beat: "structure", thread: "structure",
  meter: "foundations",
  scene: "scenes",
};

const FAINT = "text-[hsl(var(--pv-text-faint))]";
const MUTED = "text-[hsl(var(--pv-text-muted))]";

// A node's lifecycle as one dot: accepted = filled accent (amber if drifted stale), else a hollow ring.
function NodePip({ node, index }: { node: DnaNode; index: Map<string, DnaNode> }) {
  const stale = isStale(node, index) || (node.kind === "scene" && isProseStale(node));
  const cls = node.authoring.status === "accepted"
    ? (stale ? "bg-amber-500" : "bg-[hsl(var(--pv-accent))]")
    : "border-[1.5px] border-[hsl(var(--pv-text-faint))]/60 bg-transparent";
  return <span className={`h-2 w-2 shrink-0 rounded-full ${cls}`} title={stale ? "approved · drifted" : node.authoring.status} />;
}

// One clickable row in the shape map: pip · kind · title · meta · jump arrow. Indented by depth.
function TreeRow({ node, index, label, title, meta, depth, onOpen }: {
  node?: DnaNode; index: Map<string, DnaNode>; label: string; title?: string; meta?: string; depth: number; onOpen: () => void;
}) {
  return (
    <button type="button" onClick={onOpen}
      className="group flex w-full items-center gap-2.5 rounded-md py-1 pr-2 text-left transition-colors hover:bg-[hsl(var(--pv-surface-2))]/50"
      style={{ paddingLeft: depth * 18 + 6 }}>
      {node ? <NodePip node={node} index={index} /> : <span className={`h-2 w-2 shrink-0 rounded-full border-[1.5px] border-dashed ${FAINT} border-current/60`} />}
      <Eyebrow tone="accent" className="shrink-0">{label}</Eyebrow>
      {title && <span className={`pv-serif min-w-0 flex-1 truncate text-[13px] text-foreground`}>{title}</span>}
      {!title && <span className="flex-1" />}
      {meta && <span className={`pv-mono shrink-0 text-[9px] uppercase tracking-[0.1em] ${FAINT}`}>{meta}</span>}
      <ArrowRight className={`h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 ${FAINT}`} />
    </button>
  );
}

export function DnaOverview({ bookId, nodes, settings, stages, nowKey, onOpen, onChanged, renderCard }: {
  bookId: number; nodes: DnaNode[]; settings: BookSettings; stages: JourneyStage[]; nowKey: StageKey; onOpen: (k: StageKey, focusId?: string) => void; onChanged: () => void;
  // Threads are edited in place on the dashboard (a cross-cutting whole-book registry); the studio passes its
  // own card renderer down so we reuse the exact node-card UI without lifting it out.
  renderCard: (n: DnaNode, accent?: boolean) => ReactNode;
}) {
  const threadsRef = useRef<HTMLDivElement>(null);
  const index = byId(nodes);
  const of = (k: NodeKind) => nodes.filter((n) => n.kind === k);
  const first = (k: NodeKind) => of(k)[0];
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

  const [seed, premise, pillar] = [first("seed"), first("premise"), first("pillar")];
  const acts = of("act");
  const picture = settings.mode === "picture";
  const beats = of("beat"), scenes = of("scene"), threads = of("thread");
  const drafted = scenes.filter((s) => str(picture ? (s.content as SceneContent).image_url : (s.content as SceneContent).prose?.text)).length;

  // ── Next move: the live now-stage + its first open sub-step, plus the optional branches also available now.
  const nowStage = stages.find((s) => s.key === nowKey)!;
  const allDone = stages.every((s) => s.status === "done");
  const subs = stageSubsteps(nowKey, nodes, picture ? "picture" : "prose");
  const nowSub = subs.find((s) => s.status === "now");
  const alsoAvailable = subs.filter((s) => s.status === "available");

  // ── Issues: the engine's lints + the render blockers, each routed to its owning stage.
  const issues = validate(nodes);
  const errors = issues.filter((i) => i.severity === "error").length;
  const issueStage = (nodeId?: string): StageKey => {
    const k = nodeId ? index.get(nodeId)?.kind : undefined;
    return k ? KIND_STAGE[k] : nowKey;
  };

  // ── The shape: counts for the entity branches + the cross-cutting registries.
  const counts: [NodeKind, string][] = [
    ["character", "cast"], ["world_fact", "world"], ["relationship", "relationships"], ["tentpole", "tent-poles"],
  ];
  const sceneCountOf = (m: DnaNode) =>
    childrenOf(nodes, m.id).filter((b) => b.kind === "beat").reduce((a, b) => a + childrenOf(nodes, b.id).filter((s) => s.kind === "scene").length, 0);

  const stat = (label: string, n: number, total?: number) => (
    <span className={`pv-mono text-[10px] uppercase tracking-[0.1em] ${n === 0 ? FAINT : MUTED}`}>
      <b className={`font-semibold ${n === 0 ? FAINT : "text-foreground"}`}>{total != null ? `${n}/${total}` : n}</b> {label}
    </span>
  );

  return (
    <>
      <StageHead eyebrow="Overview" title={settings.title || "Untitled"}
        caption="The shape of your book's DNA — what's built, what's next, and what needs a look." />

      {/* NEXT MOVE — the obvious thing to do, loud. */}
      {allDone ? (
        <Hero icon={<BookOpen className="h-5 w-5" />} title={picture ? "Picture book complete" : "Draft complete"} sub={picture ? "Every scene is illustrated — open the reader." : "Every scene is drafted — open the reader."} onClick={() => onOpen("draft")} />
      ) : (
        <Hero icon={<Sparkles className="h-5 w-5" />}
          title={`${nowStage.label}${nowSub ? ` · ${nowSub.label}` : ""}`}
          sub={nowStage.caption}
          onClick={() => onOpen(nowKey)} />
      )}
      

      {alsoAvailable.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <Eyebrow tone="muted">also ready</Eyebrow>
          {alsoAvailable.map((s) => (
            <ActionLink key={s.key} tone="faint" onClick={() => onOpen(nowKey)}>{s.label}{s.optional ? " (optional)" : ""} →</ActionLink>
          ))}
        </div>
      )}

      {/* THE SHAPE (visual) — the whole DNA as one connected pipeline, live; each band jumps to its stage. */}
      <Panel variant="soft" className="px-4 py-3.5">
        <div className="mb-2.5 flex items-center gap-2">
          <Network className={`h-3.5 w-3.5 ${FAINT}`} />
          <Eyebrow tone="muted">The shape — root → web → spine → scenes → pages</Eyebrow>
        </div>
        <DnaFullDiagram nodes={nodes} onOpen={onOpen} />
      </Panel>

      {/* STORY MAP — the detailed spine: the emotional contour over every beat (∴/↯ connectors, ↗/↘ turns)
          and its scenes; click any row to drill straight to that node. */}
      {acts.length > 0 && (
        <Panel variant="soft" className="px-4 py-3.5">
          <div className="mb-2.5 flex items-center gap-2">
            <Activity className={`h-3.5 w-3.5 ${FAINT}`} />
            <Eyebrow tone="muted">Story map — the shape of the telling, beat by beat</Eyebrow>
          </div>
          <DnaStoryMap nodes={nodes} picture={picture} onOpen={onOpen} />
        </Panel>
      )}

      {/* AT A GLANCE — the census. */}
      <Panel variant="soft" className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
        {stat("acts", acts.length)}
        {stat("beats", beats.length)}
        {stat("scenes", scenes.length)}
        {scenes.length > 0 && stat(picture ? "illustrated" : "drafted", drafted, scenes.length)}
        {of("character").length > 0 && stat("cast", of("character").length)}
        {of("thread").length > 0 && stat("threads", of("thread").length)}
        {of("game").length > 0 && stat("games", of("game").length)}
      </Panel>

      {/* STORY ANALYSIS — the analytic axes (pacing/promises/topography/causality), consolidated here so the
          stages stay actionable. Each row jumps to the node it's about; lints are hidden because the issues
          panel below already lists them with stage links. */}
      {acts.length > 0 && <DnaAnalysis nodes={nodes} settings={settings} onOpen={onOpen} hideLints defaultOpen={false} />}

      {/* THREADS — the promise registry (setup → payoff). A cross-cutting whole-book concern, so it's edited
          here on the dashboard rather than nested in the sequential spine. Uses the studio's own node card. */}
      <div ref={threadsRef}>
        <Panel variant="soft" className="px-4 py-3.5">
          <div className="mb-2.5 flex items-center gap-2">
            <Waypoints className={`h-3.5 w-3.5 ${FAINT}`} />
            <Eyebrow tone="muted">Threads — the promises this book makes, set up → paid off</Eyebrow>
          </div>
          {threads.length > 0 && <div className="mt-3 space-y-2">{threads.map((t) => renderCard(t))}</div>}
          {threads.length === 0 && <p className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">No threads yet.</p>}
        </Panel>
      </div>

      {/* ISSUES — conformance lints + render blockers, routed to their stage. */}
      <Panel variant={issues.length === 0 ? "soft" : "solid"} className="px-4 py-3.5">
        <div className="flex items-center gap-2">
          {issues.length === 0
            ? <><Check className="h-3.5 w-3.5 text-emerald-500" /><Eyebrow tone="muted">No issues — the structure is clean</Eyebrow></>
            : <><TriangleAlert className="h-3.5 w-3.5 text-amber-500" /><Eyebrow tone="muted">{errors ? `${errors} to fix · ` : ""}{issues.length - errors} to review</Eyebrow></>}
        </div>
        {issues.length > 0 && (
          <div className="mt-2.5 space-y-1.5">
            {issues.slice(0, 6).map((i, k) => (
              <button key={k} type="button"
                onClick={() => {
                  // thread issues are edited right here on the dashboard — scroll to the panel instead of routing.
                  if ((i.nodeId ? index.get(i.nodeId)?.kind : undefined) === "thread") { threadsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
                  onOpen(issueStage(i.nodeId), i.nodeId);
                }}
                className="group flex w-full items-start gap-2 text-left">
                <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${i.severity === "error" ? "bg-rose-500" : "bg-amber-500"}`} />
                <p className="pv-serif text-[12px] leading-snug">
                  <span className={`pv-mono mr-1.5 text-[9px] ${FAINT}`}>{i.rule}</span>
                  <span className={MUTED}>{i.message}</span>
                  <ArrowRight className={`ml-1 inline h-2.5 w-2.5 opacity-0 transition-opacity group-hover:opacity-100 ${FAINT}`} />
                </p>
              </button>
            ))}
            {issues.length > 6 && <p className={`pv-mono pl-3.5 text-[9px] ${FAINT}`}>+{issues.length - 6} more</p>}
          </div>
        )}
      </Panel>

      {/* THE SHAPE — the parent→child tree, collapsed to a navigable map. */}
      <Panel variant="soft" className="px-3 py-3">
        <div className="mb-1 flex items-center gap-2 px-2">
          <GitBranch className={`h-3.5 w-3.5 ${FAINT}`} />
          <Eyebrow tone="muted">The tree</Eyebrow>
        </div>
        <div className="space-y-px">
          {seed && <TreeRow node={seed} index={index} label="seed" title={str((seed.content as { logline?: string }).logline)} depth={0} onOpen={() => onOpen("premise")} />}
          {premise && <TreeRow node={premise} index={index} label="premise" title={str((premise.content as { dramatic_question?: string }).dramatic_question)} depth={1} onOpen={() => onOpen("premise")} />}
          {pillar && <TreeRow node={pillar} index={index} label="pillar" title={str((pillar.content as { controlling_idea?: string }).controlling_idea)} depth={2} onOpen={() => onOpen("foundations")} />}

          {/* entity branches off the pillar — grouped as count chips (the interlinked context) */}
          {pillar && counts.some(([k]) => of(k).length > 0) && (
            <button type="button" onClick={() => onOpen("foundations")}
              className="group flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-md py-1 pr-2 transition-colors hover:bg-[hsl(var(--pv-surface-2))]/50" style={{ paddingLeft: 3 * 18 + 6 }}>
              {counts.filter(([k]) => of(k).length > 0).map(([k, label]) => (
                <span key={k} className={`pv-mono text-[9px] uppercase tracking-[0.1em] ${MUTED}`}><b className="font-semibold text-foreground">{of(k).length}</b> {label}</span>
              ))}
              <ArrowRight className={`h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100 ${FAINT}`} />
            </button>
          )}

          {/* the spine: each act with its nested beat/scene tally */}
          {acts.map((m, i) => {
            const b = childrenOf(nodes, m.id).filter((c) => c.kind === "beat").length;
            const sc = sceneCountOf(m);
            return (
              <TreeRow key={m.id} node={m} index={index} label={`act ${i + 1}`}
                title={str((m.content as { title?: string }).title) ?? str((m.content as { goal?: string }).goal)}
                meta={`${b} beat${b === 1 ? "" : "s"}${sc ? ` · ${sc} scene${sc === 1 ? "" : "s"}` : ""}`}
                depth={3} onOpen={() => onOpen("structure")} />
            );
          })}

          {/* cross-cutting registries: games are a Foundations entity now; threads are edited on this page. */}
          {(threads.length > 0 || of("game").length > 0) && (
            <div className="mt-1 flex items-center gap-3 border-t border-[hsl(var(--pv-border-soft))]/50 py-1.5 pr-2 pt-2" style={{ paddingLeft: 6 }}>
              <Eyebrow tone="muted">spanning</Eyebrow>
              {of("game").length > 0 && (
                <button type="button" onClick={() => onOpen("foundations")} className="group flex items-center gap-1.5">
                  <span className={`pv-mono text-[9px] uppercase tracking-[0.1em] ${MUTED}`}><b className="font-semibold text-foreground">{of("game").length}</b> games</span>
                  <ArrowRight className={`h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100 ${FAINT}`} />
                </button>
              )}
              {threads.length > 0 && (
                <button type="button" onClick={() => threadsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} className="group flex items-center gap-1.5">
                  <span className={`pv-mono text-[9px] uppercase tracking-[0.1em] ${MUTED}`}><b className="font-semibold text-foreground">{threads.length}</b> threads</span>
                  <ArrowRight className={`h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100 ${FAINT}`} />
                </button>
              )}
            </div>
          )}
        </div>
      </Panel>
    </>
  );
}
